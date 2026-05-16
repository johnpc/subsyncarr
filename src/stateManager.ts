import EventEmitter from 'events';
import { SubsyncarrPlusDatabase, Run, FileResult } from './database';
import { randomUUID } from 'crypto';
import { LogFileManager } from './logFileManager';
import * as path from 'path';

export class StateManager extends EventEmitter {
  private db: SubsyncarrPlusDatabase;
  private currentRunId: string | null = null;
  private logFileManager: LogFileManager;

  constructor(dbPath: string) {
    super();
    this.db = new SubsyncarrPlusDatabase(dbPath);

    // Create log file manager in same directory as database
    const logDir = path.join(path.dirname(dbPath), 'logs');
    this.logFileManager = new LogFileManager(logDir);

    this.handleIncompleteRuns();
  }

  private handleIncompleteRuns(): void {
    // Find any runs that are still marked as 'running' from a previous session
    const history = this.db.getRunHistory(100);
    const incompleteRuns = history.filter((run) => run.status === 'running');

    incompleteRuns.forEach((run) => {
      console.log(`[${new Date().toISOString()}] Found incomplete run from previous session: ${run.id}`);
      this.db.updateRun(run.id, {
        status: 'cancelled',
        end_time: run.start_time, // Use start time since we don't know when it actually stopped
      });
      console.log(`[${new Date().toISOString()}] Marked run ${run.id} as cancelled`);
    });
  }

  // Run management
  startRun(totalFiles: number, enabledEngines: string[] = ['ffsubsync', 'autosubsync', 'alass']): string {
    const runId = randomUUID();
    this.db.createRun(runId, totalFiles);

    // Set the total number of engines that will run (total_files * enabled_engines)
    const totalEngines = totalFiles * enabledEngines.length;
    this.db.updateRun(runId, { total_engines: totalEngines });

    this.currentRunId = runId;

    // Start log file for this run
    this.logFileManager.startRun(runId);

    const run = this.db.getRun(runId)!;
    this.emit('run:started', run);
    return runId;
  }

  completeRun(runId: string): void {
    this.db.updateRun(runId, {
      end_time: Date.now(),
      status: 'completed',
    });

    // End log file for this run
    this.logFileManager.endRun(runId);

    if (this.currentRunId === runId) {
      this.currentRunId = null;
    }

    const run = this.db.getRun(runId)!;
    this.emit('run:completed', run);
  }

  cancelRun(runId: string): void {
    this.db.updateRun(runId, {
      end_time: Date.now(),
      status: 'cancelled',
    });

    // End log file for this run
    this.logFileManager.endRun(runId);

    if (this.currentRunId === runId) {
      this.currentRunId = null;
    }

    const run = this.db.getRun(runId)!;
    this.emit('run:cancelled', run);
  }

  incrementRunCounter(runId: string, field: 'completed' | 'skipped' | 'failed' | 'not_fitting'): void {
    const run = this.db.getRun(runId)!;
    this.db.updateRun(runId, {
      [field]: run[field] + 1,
    });
  }

  incrementCompletedEngines(runId: string): void {
    const run = this.db.getRun(runId)!;
    this.db.updateRun(runId, {
      completed_engines: run.completed_engines + 1,
    });
  }

  // File management
  addFile(runId: string, filePath: string, videoPath: string | null): void {
    this.db.createFileResult(runId, filePath, videoPath);
  }

  updateFileStatus(runId: string, filePath: string, status: FileResult['status'], currentEngine?: string | null, videoPath?: string | null): void {
    const updates: Partial<FileResult> = { status };
    if (currentEngine !== undefined) {
      updates.current_engine = currentEngine;
    }
    if (videoPath !== undefined) {
      updates.video_path = videoPath;
    }

    this.db.updateFileResult(runId, filePath, updates);
    this.emitFileUpdate(runId, filePath);
  }

  updateFileEngine(
    runId: string,
    filePath: string,
    engine: string,
    result: {
      success: boolean;
      duration: number;
      message: string;
      stdout?: string;
      stderr?: string;
      skipped?: boolean;
      offsetMs?: number;
      notFitting?: boolean;
    },
  ): void {
    const files = this.db.getFileResults(runId);
    const file = files.find((f) => f.file_path === filePath);

    if (file) {
      const engines = JSON.parse(file.engines);
      engines[engine] = result;

      this.db.updateFileResult(runId, filePath, {
        engines: JSON.stringify(engines),
      });

      // Update failure tracking
      if (result.skipped) {
        // Skipped engines don't affect failure count
      } else if (result.success) {
        this.db.recordEngineSuccess(filePath, engine);
      } else {
        this.db.recordEngineFailure(filePath, engine);
      }

      this.emitFileUpdate(runId, filePath);
    }
  }

  private emitFileUpdate(runId: string, filePath: string): void {
    const file = this.db.getFileResult(runId, filePath);
    if (file) {
      const run = this.db.getRun(runId);
      this.emit('file:updated', { file, run });
    }
  }

  clearCompletedFiles(): void {
    if (!this.currentRunId) {
      return;
    }

    const files = this.db.getFileResults(this.currentRunId);
    files.forEach((file) => {
      if (['completed', 'skipped', 'error', 'not_fitting'].includes(file.status)) {
        this.emit('file:cleared', file);
      }
    });
  }

  // Query methods
  getCurrentRun(): Run | null {
    return this.currentRunId ? this.db.getRun(this.currentRunId) : null;
  }

  getRunHistory(limit?: number): Run[] {
    return this.db.getRunHistory(limit);
  }

  getFileResults(runId: string): FileResult[] {
    return this.db.getFileResults(runId);
  }

  getFileResultsPaginated(
    runId: string,
    limit: number,
    offset: number,
  ): { files: FileResult[]; total: number } {
    return this.db.getFileResultsPaginated(runId, limit, offset);
  }

  appendLog(runId: string, logMessage: string): void {
    // Write to log file instead of database
    this.logFileManager.appendLog(runId, logMessage);
  }

  getRunLogs(runId: string): string {
    // Read logs from file
    return this.logFileManager.readLog(runId);
  }

  getDatabase(): SubsyncarrPlusDatabase {
    return this.db;
  }

  getLogFileManager(): LogFileManager {
    return this.logFileManager;
  }

  // Engine skip logic methods
  getSkippedEngines(filePath: string): string[] {
    return this.db.getAllSkippedEngines(filePath);
  }

  shouldSkipEngine(filePath: string, engine: string): boolean {
    const tracking = this.db.getEngineFailureTracking(filePath, engine);
    return tracking ? tracking.is_skipped : false;
  }

  resetSkipStatus(filePath: string, engine?: string): void {
    this.db.resetEngineSkipStatus(filePath, engine);
  }

  getFailureStats() {
    return this.db.getFailureTrackingStats();
  }

  close() {
    this.logFileManager.close();
    this.db.close();
  }
}
