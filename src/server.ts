import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { ProcessingCoordinator } from './coordinator';
import { StateManager } from './stateManager';
import { Run } from './database';
import { join } from 'path';
import { getScanConfig } from './config';
import cronstrue from 'cronstrue';
import parseExpression from 'cron-parser';

export class SubsyncarrPlusServer {
  private app = express();
  private httpServer = createServer(this.app);
  private wss = new WebSocketServer({ server: this.httpServer, path: '/ws' });
  private clients: Set<WebSocket> = new Set();

  constructor(
    private coordinator: ProcessingCoordinator,
    private stateManager: StateManager,
  ) {
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  private setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.static(join(__dirname, '../public')));
  }

  private setupRoutes() {
    // Get configuration status
    this.app.get('/api/config', (req, res) => {
      console.log(`[${new Date().toISOString()}] GET /api/config`);
      const config = getScanConfig();
      const isDefaultPath = config.includePaths.length === 1 && config.includePaths[0] === '/scan_dir';

      // Get cron schedule info
      const cronSchedule = process.env.CRON_SCHEDULE || '0 0 * * *';
      let scheduleDescription = '';
      let nextRun = null;

      if (cronSchedule !== 'disabled') {
        try {
          scheduleDescription = cronstrue.toString(cronSchedule);
          const interval = parseExpression.parse(cronSchedule);
          nextRun = interval.next().toDate().getTime();
        } catch (error) {
          console.error('Error parsing cron schedule:', error);
          scheduleDescription = cronSchedule;
        }
      }

      res.json({
        paths: config.includePaths,
        excludePaths: config.excludePaths,
        isConfigured: !isDefaultPath,
        schedule: {
          enabled: cronSchedule !== 'disabled',
          cron: cronSchedule,
          description: scheduleDescription,
          nextRun: nextRun,
        },
      });
    });

    // Get current status
    this.app.get('/api/status', (req, res) => {
      console.log(`[${new Date().toISOString()}] GET /api/status`);
      const currentRun = this.stateManager.getCurrentRun();
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 500, 5000);
      const result = currentRun ? this.stateManager.getFileResultsPaginated(currentRun.id, limit, 0) : null;
      res.json({
        currentRun,
        files: result?.files || [],
        totalFiles: result?.total || 0,
        isRunning: this.coordinator.isRunning(),
      });
    });

    // Get run history
    this.app.get('/api/history', (req, res) => {
      const limit = parseInt(req.query.limit as string, 10) || 50;
      console.log(`[${new Date().toISOString()}] GET /api/history (limit: ${limit})`);
      res.json(this.stateManager.getRunHistory(limit));
    });

    // Get specific run details (latest files only — use paginated endpoint for full list)
    this.app.get('/api/runs/:id', (req, res) => {
      console.log(`[${new Date().toISOString()}] GET /api/runs/${req.params.id}`);
      const currentRun = this.stateManager.getCurrentRun();
      const requestedId = req.params.id;

      let run: Run | null = null;
      if (currentRun && currentRun.id === requestedId) {
        run = currentRun;
      } else {
        const history = this.stateManager.getRunHistory(1000);
        run = history.find((r) => r.id === requestedId) || null;
      }

      if (!run) {
        return res.status(404).json({ error: 'Run not found' });
      }

      const limit = Math.min(parseInt(req.query.limit as string, 10) || 500, 5000);
      const result = this.stateManager.getFileResultsPaginated(requestedId, limit, 0);
      res.json({
        run,
        files: result.files,
        totalFiles: result.total,
      });
    });

    // Get paginated file results for a run
    this.app.get('/api/runs/:id/files', (req, res) => {
      console.log(`[${new Date().toISOString()}] GET /api/runs/${req.params.id}/files`);
      const requestedId = req.params.id;
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 500, 5000);
      const offset = (page - 1) * limit;

      const currentRun = this.stateManager.getCurrentRun();
      const history = this.stateManager.getRunHistory(1000);
      const run = currentRun?.id === requestedId ? currentRun : history.find((r) => r.id === requestedId);

      if (!run) {
        return res.status(404).json({ error: 'Run not found' });
      }

      const result = this.stateManager.getFileResultsPaginated(requestedId, limit, offset);
      res.json({
        ...result,
        page,
        limit,
        totalPages: Math.ceil(result.total / limit),
      });
    });

    // Get logs for a specific run
    this.app.get('/api/runs/:id/logs', (req, res) => {
      console.log(`[${new Date().toISOString()}] GET /api/runs/${req.params.id}/logs`);
      const requestedId = req.params.id;

      // Check if run exists (current or historical)
      const currentRun = this.stateManager.getCurrentRun();
      const history = this.stateManager.getRunHistory(1000);
      const run = currentRun?.id === requestedId ? currentRun : history.find((r) => r.id === requestedId);

      if (!run) {
        return res.status(404).json({ error: 'Run not found' });
      }

      // Read logs from file
      const logs = this.stateManager.getRunLogs(requestedId);
      res.json({ logs });
    });

    // Start a new run
    this.app.post('/api/run/start', async (req, res) => {
      const { paths } = req.body;
      console.log(
        `[${new Date().toISOString()}] POST /api/run/start${paths ? ` (custom paths: ${paths.join(', ')})` : ' (default paths)'}`,
      );

      try {
        if (this.coordinator.isRunning()) {
          console.log(`[${new Date().toISOString()}] Request rejected: Run already in progress`);
          return res.status(409).json({ error: 'A run is already in progress' });
        }

        const config = paths ? { includePaths: paths, excludePaths: [] } : undefined;

        const runId = await this.coordinator.startRun(config);
        res.json({ runId });
      } catch (error) {
        console.log(
          `[${new Date().toISOString()}] Error starting run: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Stop current run
    this.app.post('/api/run/stop', (_req, res) => {
      console.log(`[${new Date().toISOString()}] POST /api/run/stop`);
      try {
        this.coordinator.stopRun();
        res.json({ success: true });
      } catch (error) {
        console.log(
          `[${new Date().toISOString()}] Error stopping run: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Skip a file
    this.app.post('/api/file/skip', (req, res) => {
      const { filePath } = req.body;

      if (!filePath) {
        console.log(`[${new Date().toISOString()}] POST /api/file/skip - Missing filePath`);
        return res.status(400).json({ error: 'filePath required' });
      }

      console.log(`[${new Date().toISOString()}] POST /api/file/skip - ${filePath.split('/').pop()}`);
      this.coordinator.skipFile(filePath);
      res.json({ success: true });
    });

    // Clear completed files
    this.app.post('/api/files/clear', (req, res) => {
      console.log(`[${new Date().toISOString()}] POST /api/files/clear`);
      this.stateManager.clearCompletedFiles();

      // Broadcast updated state to all clients
      const currentRun = this.stateManager.getCurrentRun();
      this.broadcast({
        type: 'files:cleared',
        data: {
          currentRun,
          files: [],
        },
      });

      res.json({ success: true });
    });

    // Get skip status statistics
    this.app.get('/api/skip-status', (_req, res) => {
      console.log(`[${new Date().toISOString()}] GET /api/skip-status`);
      const stats = this.stateManager.getFailureStats();
      res.json(stats);
    });

    // Get skip status for specific file
    this.app.get('/api/skip-status/:filePath(*)', (req, res) => {
      const filePath = decodeURIComponent(req.params.filePath);
      console.log(`[${new Date().toISOString()}] GET /api/skip-status/${filePath.split('/').pop()}`);

      const skippedEngines = this.stateManager.getSkippedEngines(filePath);
      res.json({ filePath, skippedEngines });
    });

    // Reset skip status for a file
    this.app.post('/api/skip-status/reset', (req, res) => {
      const { filePath, engine } = req.body;

      if (!filePath) {
        return res.status(400).json({ error: 'filePath required' });
      }

      console.log(
        `[${new Date().toISOString()}] POST /api/skip-status/reset - ${filePath.split('/').pop()}${engine ? ` (${engine})` : ' (all engines)'}`,
      );

      this.stateManager.resetSkipStatus(filePath, engine);
      res.json({ success: true });
    });
  }

  private setupWebSocket() {
    this.wss.on('connection', (ws) => {
      console.log(`[${new Date().toISOString()}] WebSocket client connected (total: ${this.clients.size + 1})`);
      this.clients.add(ws);

      // Send initial state (without file list to avoid OOM with large libraries)
      const currentRun = this.stateManager.getCurrentRun();
      ws.send(
        JSON.stringify({
          type: 'state',
          data: {
            currentRun,
            isRunning: this.coordinator.isRunning(),
          },
        }),
      );

      ws.on('close', () => {
        this.clients.delete(ws);
        console.log(`[${new Date().toISOString()}] WebSocket client disconnected (total: ${this.clients.size})`);
      });
    });

    // Broadcast state changes to all clients
    this.stateManager.on('run:started', (run) => {
      console.log(`[${new Date().toISOString()}] Broadcasting run:started to ${this.clients.size} clients`);
      this.broadcast({ type: 'run:started', data: run });
    });

    this.stateManager.on('run:completed', (run) => {
      console.log(`[${new Date().toISOString()}] Broadcasting run:completed to ${this.clients.size} clients`);
      this.broadcast({ type: 'run:completed', data: run });
    });

    this.stateManager.on('run:cancelled', (run) => {
      console.log(`[${new Date().toISOString()}] Broadcasting run:cancelled to ${this.clients.size} clients`);
      this.broadcast({ type: 'run:cancelled', data: run });
    });

    this.stateManager.on('file:updated', ({ file, run }) => {
      this.broadcast({ type: 'file:updated', data: { file, run } });
    });
  }

  private broadcast(message: unknown) {
    const data = JSON.stringify(message);
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  start(port: number = 3000, host: string = '0.0.0.0') {
    this.httpServer.listen(port, host, () => {
      console.log(`[${new Date().toISOString()}] Subsyncarr Plus UI available at http://${host}:${port}`);
    });
  }

  close() {
    this.httpServer.close();
    this.wss.close();
  }
}
