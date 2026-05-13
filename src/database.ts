import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

export interface Run {
  id: string;
  start_time: number;
  end_time: number | null;
  total_files: number;
  completed: number;
  skipped: number;
  failed: number;
  not_fitting: number;
  total_engines: number;
  completed_engines: number;
  status: 'running' | 'completed' | 'cancelled';
  logs: string;
}

export interface FileResult {
  id: number;
  run_id: string;
  file_path: string;
  video_path: string | null;
  status: 'pending' | 'processing' | 'completed' | 'skipped' | 'error' | 'not_fitting';
  current_engine: string | null;
  engines: string; // JSON stringified { ffsubsync?: {...}, autosubsync?: {...}, alass?: {...} }
  created_at: number;
  updated_at: number;
}

export interface EngineFailureTracking {
  id: number;
  file_path: string;
  engine: string;
  consecutive_failures: number;
  last_failure_time: number | null;
  last_success_time: number | null;
  is_skipped: boolean;
  created_at: number;
  updated_at: number;
}

export class SubsyncarrPlusDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // ignore — will fail on db open if truly inaccessible
    }
    try {
      this.db = new Database(dbPath);
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && err.code === 'SQLITE_CANTOPEN') {
        throw new Error(
          `Cannot open database at ${dbPath} — ensure the data directory exists and is writable. ` +
            `If using Docker, check that your volume mount target exists and has correct permissions (PUID/PGID).`,
        );
      }
      throw err;
    }
    this.initSchema();
  }

  private initSchema() {
    // Optimize SQLite for low memory usage
    this.db.pragma('cache_size = -1000'); // 1MB cache (negative means KB)
    this.db.pragma('mmap_size = 0'); // Disable memory-mapping
    this.db.pragma('journal_mode = WAL'); // Better concurrency
    this.db.pragma('temp_store = MEMORY'); // Keep temp data in memory
    this.db.pragma('auto_vacuum = INCREMENTAL'); // Reclaim space gradually

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        total_files INTEGER NOT NULL,
        completed INTEGER DEFAULT 0,
        skipped INTEGER DEFAULT 0,
        failed INTEGER DEFAULT 0,
        not_fitting INTEGER DEFAULT 0,
        total_engines INTEGER DEFAULT 0,
        completed_engines INTEGER DEFAULT 0,
        status TEXT NOT NULL,
        logs TEXT DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS file_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        video_path TEXT,
        status TEXT NOT NULL,
        current_engine TEXT,
        engines TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(run_id) REFERENCES runs(id)
      );

      CREATE INDEX IF NOT EXISTS idx_file_results_run
        ON file_results(run_id);
      CREATE INDEX IF NOT EXISTS idx_file_results_status
        ON file_results(status);
    `);

    // Migration: Add logs column if it doesn't exist
    const columns = this.db.pragma('table_info(runs)') as Array<{ name: string }>;
    const hasLogsColumn = columns.some((col) => col.name === 'logs');
    if (!hasLogsColumn) {
      this.db.exec(`ALTER TABLE runs ADD COLUMN logs TEXT DEFAULT ''`);
    }

    // Migration: Add total_engines and completed_engines columns if they don't exist
    const hasTotalEnginesColumn = columns.some((col) => col.name === 'total_engines');
    if (!hasTotalEnginesColumn) {
      this.db.exec(`ALTER TABLE runs ADD COLUMN total_engines INTEGER DEFAULT 0`);
    }
    const hasCompletedEnginesColumn = columns.some((col) => col.name === 'completed_engines');
    if (!hasCompletedEnginesColumn) {
      this.db.exec(`ALTER TABLE runs ADD COLUMN completed_engines INTEGER DEFAULT 0`);
    }

    // Migration: Add not_fitting column if it doesn't exist
    const hasNotFittingColumn = columns.some((col) => col.name === 'not_fitting');
    if (!hasNotFittingColumn) {
      this.db.exec(`ALTER TABLE runs ADD COLUMN not_fitting INTEGER DEFAULT 0`);
    }

    // Migration: Create engine_failure_tracking table
    const tables = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='engine_failure_tracking'")
      .all();
    if (tables.length === 0) {
      this.db.exec(`
        CREATE TABLE engine_failure_tracking (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          file_path TEXT NOT NULL,
          engine TEXT NOT NULL,
          consecutive_failures INTEGER DEFAULT 0,
          last_failure_time INTEGER,
          last_success_time INTEGER,
          is_skipped BOOLEAN DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(file_path, engine)
        );

        CREATE INDEX idx_failure_tracking_file ON engine_failure_tracking(file_path);
        CREATE INDEX idx_failure_tracking_skipped ON engine_failure_tracking(is_skipped);
      `);
    }
  }

  // Run methods
  createRun(id: string, totalFiles: number): void {
    const stmt = this.db.prepare(`
      INSERT INTO runs (id, start_time, total_files, status)
      VALUES (?, ?, ?, 'running')
    `);
    stmt.run(id, Date.now(), totalFiles);
  }

  updateRun(id: string, updates: Partial<Run>): void {
    const fields = Object.keys(updates)
      .map((k) => `${k} = ?`)
      .join(', ');
    const values = Object.values(updates);
    this.db.prepare(`UPDATE runs SET ${fields} WHERE id = ?`).run(...values, id);
  }

  getRun(id: string): Run | null {
    const result = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
    return result ? (result as Run) : null;
  }

  getRunHistory(limit: number = 50): Run[] {
    return this.db
      .prepare(
        `
      SELECT * FROM runs
      ORDER BY start_time DESC
      LIMIT ?
    `,
      )
      .all(limit) as Run[];
  }

  /**
   * Delete old runs and their associated file results
   */
  deleteOldRuns(olderThanDays: number): number {
    const cutoffTime = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

    // Use transaction for atomicity
    const deleteFiles = this.db.prepare(
      'DELETE FROM file_results WHERE run_id IN (SELECT id FROM runs WHERE start_time < ?)',
    );
    const deleteRuns = this.db.prepare('DELETE FROM runs WHERE start_time < ?');

    const transaction = this.db.transaction(() => {
      deleteFiles.run(cutoffTime);
      const result = deleteRuns.run(cutoffTime);
      return result.changes;
    });

    return transaction();
  }

  /**
   * Trim logs for runs older than specified days, keeping only summary
   */
  trimOldLogs(olderThanDays: number, maxLogLength: number = 1000): number {
    const cutoffTime = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

    const stmt = this.db.prepare(`
      UPDATE runs
      SET logs = SUBSTR(logs, 1, ?) || '\n... (log trimmed to save space)'
      WHERE start_time < ? AND LENGTH(logs) > ?
    `);

    const result = stmt.run(maxLogLength, cutoffTime, maxLogLength);
    return result.changes;
  }

  /**
   * Vacuum database to reclaim space after deletions
   */
  vacuum(): void {
    this.db.pragma('incremental_vacuum');
  }

  /**
   * Get database file size statistics
   */
  getDatabaseStats(): { sizeBytes: number; pageCount: number; pageSize: number } {
    const pageCount = this.db.pragma('page_count', { simple: true }) as number;
    const pageSize = this.db.pragma('page_size', { simple: true }) as number;

    return {
      pageCount,
      pageSize,
      sizeBytes: pageCount * pageSize,
    };
  }

  // File methods
  createFileResult(runId: string, filePath: string, videoPath: string | null): void {
    const stmt = this.db.prepare(`
      INSERT INTO file_results
        (run_id, file_path, video_path, status, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `);
    const now = Date.now();
    stmt.run(runId, filePath, videoPath, now, now);
  }

  updateFileResult(runId: string, filePath: string, updates: Partial<FileResult>): void {
    const updatesWithTimestamp = { ...updates, updated_at: Date.now() };
    const fields = Object.keys(updatesWithTimestamp)
      .map((k) => `${k} = ?`)
      .join(', ');
    const values = Object.values(updatesWithTimestamp);
    this.db
      .prepare(
        `
      UPDATE file_results
      SET ${fields}
      WHERE run_id = ? AND file_path = ?
    `,
      )
      .run(...values, runId, filePath);
  }

  getFileResults(runId: string): FileResult[] {
    return this.db
      .prepare(
        `
      SELECT * FROM file_results
      WHERE run_id = ?
      ORDER BY created_at ASC
    `,
      )
      .all(runId) as FileResult[];
  }

  getFileResult(runId: string, filePath: string): FileResult | null {
    return this.db
      .prepare('SELECT * FROM file_results WHERE run_id = ? AND file_path = ?')
      .get(runId, filePath) as FileResult | null;
  }

  getFileResultsPaginated(runId: string, limit: number, offset: number): { files: FileResult[]; total: number } {
    const total = (
      this.db.prepare('SELECT COUNT(*) as count FROM file_results WHERE run_id = ?').get(runId) as { count: number }
    ).count;
    const files = this.db
      .prepare('SELECT * FROM file_results WHERE run_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?')
      .all(runId, limit, offset) as FileResult[];
    return { files, total };
  }

  // Engine failure tracking methods
  getEngineFailureTracking(filePath: string, engine: string): EngineFailureTracking | null {
    return this.db
      .prepare(
        `SELECT * FROM engine_failure_tracking
         WHERE file_path = ? AND engine = ?`,
      )
      .get(filePath, engine) as EngineFailureTracking | null;
  }

  getAllSkippedEngines(filePath: string): string[] {
    const results = this.db
      .prepare(
        `SELECT engine FROM engine_failure_tracking
         WHERE file_path = ? AND is_skipped = 1`,
      )
      .all(filePath) as Array<{ engine: string }>;
    return results.map((r) => r.engine);
  }

  recordEngineFailure(filePath: string, engine: string): void {
    const existing = this.getEngineFailureTracking(filePath, engine);
    const now = Date.now();

    if (existing) {
      const newFailureCount = existing.consecutive_failures + 1;
      const isSkipped = newFailureCount >= 3;

      this.db
        .prepare(
          `
        UPDATE engine_failure_tracking
        SET consecutive_failures = ?,
            last_failure_time = ?,
            is_skipped = ?,
            updated_at = ?
        WHERE file_path = ? AND engine = ?
      `,
        )
        .run(newFailureCount, now, isSkipped ? 1 : 0, now, filePath, engine);
    } else {
      this.db
        .prepare(
          `
        INSERT INTO engine_failure_tracking
          (file_path, engine, consecutive_failures, last_failure_time,
           is_skipped, created_at, updated_at)
        VALUES (?, ?, 1, ?, 0, ?, ?)
      `,
        )
        .run(filePath, engine, now, now, now);
    }
  }

  recordEngineSuccess(filePath: string, engine: string): void {
    const existing = this.getEngineFailureTracking(filePath, engine);
    const now = Date.now();

    if (existing) {
      this.db
        .prepare(
          `
        UPDATE engine_failure_tracking
        SET consecutive_failures = 0,
            last_success_time = ?,
            is_skipped = 0,
            updated_at = ?
        WHERE file_path = ? AND engine = ?
      `,
        )
        .run(now, now, filePath, engine);
    } else {
      this.db
        .prepare(
          `
        INSERT INTO engine_failure_tracking
          (file_path, engine, consecutive_failures, last_success_time,
           is_skipped, created_at, updated_at)
        VALUES (?, ?, 0, ?, 0, ?, ?)
      `,
        )
        .run(filePath, engine, now, now, now);
    }
  }

  resetEngineSkipStatus(filePath: string, engine?: string): void {
    const now = Date.now();

    if (engine) {
      // Reset specific engine for specific file
      this.db
        .prepare(
          `
        UPDATE engine_failure_tracking
        SET consecutive_failures = 0,
            is_skipped = 0,
            updated_at = ?
        WHERE file_path = ? AND engine = ?
      `,
        )
        .run(now, filePath, engine);
    } else {
      // Reset all engines for specific file
      this.db
        .prepare(
          `
        UPDATE engine_failure_tracking
        SET consecutive_failures = 0,
            is_skipped = 0,
            updated_at = ?
        WHERE file_path = ?
      `,
        )
        .run(now, filePath);
    }
  }

  getFailureTrackingStats(): {
    totalSkipped: number;
    skippedByEngine: Record<string, number>;
  } {
    const totalSkipped = this.db
      .prepare('SELECT COUNT(DISTINCT file_path) as count FROM engine_failure_tracking WHERE is_skipped = 1')
      .get() as { count: number };

    const byEngine = this.db
      .prepare('SELECT engine, COUNT(*) as count FROM engine_failure_tracking WHERE is_skipped = 1 GROUP BY engine')
      .all() as Array<{ engine: string; count: number }>;

    const skippedByEngine: Record<string, number> = {};
    byEngine.forEach((row) => {
      skippedByEngine[row.engine] = row.count;
    });

    return { totalSkipped: totalSkipped.count, skippedByEngine };
  }

  close() {
    this.db.close();
  }
}
