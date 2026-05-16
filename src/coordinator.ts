import { ProcessingEngine } from './processingEngine';
import { StateManager } from './stateManager';
import { ScanConfig } from './config';
import { Run } from './database';
import { once } from 'events';

export class ProcessingCoordinator {
  private processingPromise: Promise<void> | null = null;
  private enabledEngines: string[];
  private currentRunId: string | null = null;
  private stopRequested: boolean = false;

  constructor(
    private engine: ProcessingEngine,
    private stateManager: StateManager,
  ) {
    this.enabledEngines = process.env.INCLUDE_ENGINES?.split(',') || ['ffsubsync', 'autosubsync', 'alass'];

    // Inject stateManager into engine so it can check skip status
    this.engine.stateManager = this.stateManager;

    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.engine.on('log', (message: string) => {
      if (this.currentRunId) {
        this.stateManager.appendLog(this.currentRunId, message);
      }
    });

    this.engine.on('run:files_found', (files: string[]) => {
      this.currentRunId = this.stateManager.startRun(files.length, this.enabledEngines);

      // Add all files to database as pending (video matching happens during processing)
      for (const filePath of files) {
        this.stateManager.addFile(this.currentRunId!, filePath, null);
      }
    });

    this.engine.on('file:started', ({ srtPath, videoPath }: { srtPath: string; videoPath: string | null }) => {
      if (this.currentRunId) {
        this.stateManager.updateFileStatus(this.currentRunId, srtPath, 'processing', null, videoPath);
      }
    });

    this.engine.on('file:engine_started', ({ srtPath, engine }: { srtPath: string; engine: string }) => {
      if (this.currentRunId) {
        this.stateManager.updateFileStatus(this.currentRunId, srtPath, 'processing', engine);
      }
    });

    this.engine.on(
      'file:engine_completed',
      ({
        srtPath,
        engine,
        result,
      }: {
        srtPath: string;
        engine: string;
        result: {
          success: boolean;
          duration: number;
          message: string;
          stdout?: string;
          stderr?: string;
          skipped?: boolean;
          offsetMs?: number;
          notFitting?: boolean;
        };
      }) => {
        if (this.currentRunId) {
          this.stateManager.updateFileEngine(this.currentRunId, srtPath, engine, result);
          this.stateManager.incrementCompletedEngines(this.currentRunId);
        }
      },
    );

    this.engine.on('file:completed', ({ srtPath }: { srtPath: string }) => {
      if (this.currentRunId) {
        this.stateManager.updateFileStatus(this.currentRunId, srtPath, 'completed', null);
        this.stateManager.incrementRunCounter(this.currentRunId, 'completed');
      }
    });

    this.engine.on('file:skipped', ({ srtPath }: { srtPath: string }) => {
      if (this.currentRunId) {
        this.stateManager.updateFileStatus(this.currentRunId, srtPath, 'skipped', null);
        this.stateManager.incrementRunCounter(this.currentRunId, 'skipped');
      }
    });

    this.engine.on('file:no_video', ({ srtPath }: { srtPath: string }) => {
      if (this.currentRunId) {
        this.stateManager.updateFileStatus(this.currentRunId, srtPath, 'error', null);
        this.stateManager.incrementRunCounter(this.currentRunId, 'failed');
      }
    });

    this.engine.on('file:failed', ({ srtPath }: { srtPath: string }) => {
      if (this.currentRunId) {
        this.stateManager.updateFileStatus(this.currentRunId, srtPath, 'error', null);
        this.stateManager.incrementRunCounter(this.currentRunId, 'failed');
      }
    });

    this.engine.on(
      'file:not_fitting',
      ({ srtPath }: { srtPath: string; engine: string; offsetMs: number }) => {
        if (this.currentRunId) {
          this.stateManager.updateFileStatus(this.currentRunId, srtPath, 'not_fitting', null);
          this.stateManager.incrementRunCounter(this.currentRunId, 'not_fitting');
        }
      },
    );
  }

  async startRun(config?: ScanConfig): Promise<string> {
    if (this.processingPromise) {
      console.log(`[${new Date().toISOString()}] Cannot start run: Another run is already in progress`);
      throw new Error('A run is already in progress');
    }

    console.log(`[${new Date().toISOString()}] Starting new processing run...`);
    this.engine.reset();
    this.currentRunId = null;
    this.stopRequested = false;

    const ac = new AbortController();
    // Use events.once for cleaner listener handling with AbortSignal support
    const runStartedPromise = once(this.stateManager, 'run:started', { signal: ac.signal }).then(
      ([run]) => (run as Run).id,
    );

    // Suppress unhandled rejection when we abort this promise
    runStartedPromise.catch(() => {});

    const processPromise = this.engine.processRun(config);

    this.processingPromise = processPromise.finally(() => {
      this.processingPromise = null;
      const run = this.stateManager.getCurrentRun();
      if (run) {
        console.log(
          `[${new Date().toISOString()}] Run completed - Total: ${run.total_files}, Completed: ${run.completed}, Skipped: ${run.skipped}, Failed: ${run.failed}`,
        );
        this.stateManager.completeRun(run.id);
      }
      this.currentRunId = null;
    });
    // Prevent unhandled rejection on the background promise property,
    // as the error is handled by the main startRun awaiter.
    this.processingPromise.catch(() => {});

    try {
      // Wait for run to be created or process to fail/finish
      const runId = await Promise.race([
        runStartedPromise,
        processPromise.then(() => {
          // Process finished. If run started, we should have the ID.
          const run = this.stateManager.getCurrentRun();
          if (!run) {
            throw new Error('Process completed without starting a run');
          }
          return run.id;
        }),
      ]);

      if (this.stopRequested) {
        console.log(`[${new Date().toISOString()}] Stop was requested during scan. Cancelling run: ${runId}`);
        this.stopRun();
        throw new Error('Run was stopped during initialization');
      }

      console.log(`[${new Date().toISOString()}] Run created with ID: ${runId}`);
      return runId;
    } finally {
      // Clean up the event listener if it hasn't fired yet
      ac.abort();
    }
  }

  skipFile(filePath: string): void {
    const fileName = filePath.split('/').pop();
    console.log(`[${new Date().toISOString()}] Skip requested for: ${fileName}`);
    this.engine.skipFile(filePath);
  }

  stopRun(): void {
    console.log(`[${new Date().toISOString()}] Stop run requested`);
    const run = this.stateManager.getCurrentRun();
    if (!run) {
      if (this.isRunning()) {
        console.log(`[${new Date().toISOString()}] No run active yet (still scanning). Queuing stop...`);
        this.stopRequested = true;
        return;
      }
      throw new Error('No run is currently in progress');
    }

    // Get all files and cancel them
    const files = this.stateManager.getFileResults(run.id);
    const allFilePaths = files.map((f) => f.file_path);
    this.engine.stopAllProcessing(allFilePaths);

    // Mark run as cancelled
    this.stateManager.cancelRun(run.id);
  }

  isRunning(): boolean {
    return this.processingPromise !== null;
  }
}
