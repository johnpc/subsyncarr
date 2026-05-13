import EventEmitter from 'events';
import { ScanConfig, getScanConfig } from './config';
import { findAllSrtFiles } from './findAllSrtFiles';
import { findMatchingVideoFile } from './findMatchingVideoFile';
import { generateFfsubsyncSubtitles } from './generateFfsubsyncSubtitles';
import { generateAutosubsyncSubtitles } from './generateAutosubsyncSubtitles';
import { generateAlassSubtitles } from './generateAlassSubtitles';
import { StateManager } from './stateManager';
import { copyFileSync, existsSync, renameSync, unlinkSync } from 'fs';
import { readdir } from 'fs/promises';
import { extname, join, basename as pathBasename } from 'path';
import { getSubtitleFormat, getOutputPath } from './helpers';

const ALL_KNOWN_ENGINES = ['ffsubsync', 'autosubsync', 'alass'];

export class ProcessingEngine extends EventEmitter {
  private cancelledFiles: Set<string> = new Set();
  private maxConcurrent: number;
  private enabledEngines: string[];
  private logBuffer: string[] = [];
  private maxLogBufferSize: number;
  public stateManager?: StateManager;

  constructor() {
    super();
    this.maxConcurrent = parseInt(process.env.MAX_CONCURRENT_SYNC_TASKS || '1', 10);
    this.enabledEngines = process.env.INCLUDE_ENGINES?.split(',') || ['ffsubsync', 'autosubsync', 'alass'];
    this.maxLogBufferSize = parseInt(process.env.LOG_BUFFER_SIZE || '1000', 10);
  }

  private get subtitleFormat(): string {
    return getSubtitleFormat();
  }

  private log(message: string): void {
    console.log(message);

    // Ring buffer - remove oldest if at capacity
    if (this.logBuffer.length >= this.maxLogBufferSize) {
      this.logBuffer.shift(); // Remove oldest
    }

    this.logBuffer.push(message);
    this.emit('log', message);
  }

  getLogs(): string[] {
    return [...this.logBuffer];
  }

  clearLogs(): void {
    this.logBuffer = [];
  }

  async processRun(config?: ScanConfig): Promise<void> {
    const scanConfig = config || getScanConfig();
    this.log(`[${new Date().toISOString()}] Scanning for subtitle files...`);
    this.log(`[${new Date().toISOString()}] Scan paths: ${JSON.stringify(scanConfig.includePaths)}`);

    if (this.subtitleFormat !== 'standard') {
      await this.normalizeEngineOutputs(scanConfig);
    }

    const srtFiles = await findAllSrtFiles(scanConfig);
    this.log(`[${new Date().toISOString()}] Found ${srtFiles.length} subtitle files`);

    if (this.subtitleFormat === 'overwrite' && this.stateManager) {
      const filtered = srtFiles.filter((f) => !this.stateManager!.isFileProcessed(f));
      const skipped = srtFiles.length - filtered.length;
      if (skipped > 0) {
        this.log(`[${new Date().toISOString()}] Skipped ${skipped} already-processed subtitle files`);
      }
      this.emit('run:files_found', filtered);
    } else {
      this.emit('run:files_found', srtFiles);
    }

    // Process in batches
    this.log(`[${new Date().toISOString()}] Processing with concurrency: ${this.maxConcurrent}`);
    this.log(`[${new Date().toISOString()}] Enabled engines: ${this.enabledEngines.join(', ')}`);

    for (let i = 0; i < srtFiles.length; i += this.maxConcurrent) {
      const batch = srtFiles.slice(i, i + this.maxConcurrent);
      this.log(
        `[${new Date().toISOString()}] Processing batch ${Math.floor(i / this.maxConcurrent) + 1}/${Math.ceil(srtFiles.length / this.maxConcurrent)} (${batch.length} files)`,
      );
      await Promise.all(batch.map((file) => this.processFile(file)));
    }

    this.log(`[${new Date().toISOString()}] All files processed`);
  }

  private async normalizeEngineOutputs(config: ScanConfig): Promise<void> {
    const renames: Array<{ current: string; target: string }> = [];

    async function scan(directory: string): Promise<void> {
      if (config.excludePaths.some((excludePath) => directory.startsWith(excludePath))) return;
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(directory, entry.name);
        if (entry.isDirectory()) {
          await scan(fullPath);
        } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.srt') {
          for (const engine of ALL_KNOWN_ENGINES) {
            const marker = `.${engine}.`;
            if (entry.name.includes(marker)) {
              const originalName = entry.name.replace(marker, '.');
              const originalPath = join(directory, originalName);
              if (existsSync(originalPath)) {
                const expectedPath = getOutputPath(originalPath, engine);
                if (fullPath !== expectedPath) {
                  renames.push({ current: fullPath, target: expectedPath });
                }
              }
              break;
            }
          }
        }
      }
    }

    for (const includePath of config.includePaths) {
      await scan(includePath);
    }

    if (renames.length > 0) {
      this.log(`[${new Date().toISOString()}] Normalizing ${renames.length} engine output filenames to match SUBTITLE_FORMAT`);
      for (const { current, target } of renames) {
        try {
          renameSync(current, target);
          this.log(`[${new Date().toISOString()}]   Renamed: ${pathBasename(current)} → ${pathBasename(target)}`);
        } catch (err) {
          this.log(`[${new Date().toISOString()}]   Failed to rename ${pathBasename(current)}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  private async processFile(srtPath: string): Promise<void> {
    const fileName = srtPath.split('/').pop();
    this.log(`[${new Date().toISOString()}] Processing: ${fileName}`);

    // Check if cancelled
    if (this.cancelledFiles.has(srtPath)) {
      this.log(`[${new Date().toISOString()}] Skipped (cancelled): ${fileName}`);
      this.emit('file:skipped', { srtPath, reason: 'cancelled' });
      return;
    }

    const videoPath = findMatchingVideoFile(srtPath);

    this.emit('file:started', { srtPath, videoPath });

    if (!videoPath) {
      this.log(`[${new Date().toISOString()}] No matching video found for: ${fileName}`);
      this.emit('file:no_video', { srtPath });
      return;
    }

    this.log(`[${new Date().toISOString()}] Found video: ${videoPath.split('/').pop()}`);

    // Process with each enabled engine
    let anyEngineSucceeded = false;
    let allEnginesSkipped = true;
    for (const engine of this.enabledEngines) {
      // Check cancellation before each engine
      if (this.cancelledFiles.has(srtPath)) {
        this.log(`[${new Date().toISOString()}] Skipped (cancelled): ${fileName}`);
        this.emit('file:skipped', { srtPath, reason: 'cancelled' });
        return;
      }

      // Check if engine should be skipped due to consecutive failures
      if (this.stateManager?.shouldSkipEngine(srtPath, engine)) {
        this.log(`[${new Date().toISOString()}] ⊘ Skipping ${engine} (3+ consecutive failures): ${fileName}`);
        this.emit('file:engine_completed', {
          srtPath,
          engine,
          result: {
            success: false,
            duration: 0,
            message: 'Skipped due to 3+ consecutive failures',
            skipped: true,
          },
        });
        continue; // Skip to next engine (allEnginesSkipped remains true)
      }

      this.log(`[${new Date().toISOString()}] Starting ${engine} for: ${fileName}`);
      this.emit('file:engine_started', { srtPath, engine });

      const startTime = Date.now();
      let result;

      try {
        switch (engine) {
          case 'ffsubsync':
            result = await generateFfsubsyncSubtitles(srtPath, videoPath);
            break;
          case 'autosubsync':
            result = await generateAutosubsyncSubtitles(srtPath, videoPath);
            break;
          case 'alass':
            result = await generateAlassSubtitles(srtPath, videoPath);
            break;
          default:
            continue;
        }

        const duration = Date.now() - startTime;

        // If this engine was skipped (already processed), log and continue
        if (result.skipped) {
          this.log(`[${new Date().toISOString()}] ⊘ ${engine} skipped (already processed): ${fileName}`);
          this.emit('file:engine_completed', {
            srtPath,
            engine,
            result: { ...result, duration },
          });
          continue; // allEnginesSkipped stays true
        }

        // An engine actually ran (not skipped), so not all are skipped
        allEnginesSkipped = false;

        const status = result.success ? '✓' : '✗';
        this.log(
          `[${new Date().toISOString()}] ${status} ${engine} completed (${(duration / 1000).toFixed(1)}s): ${fileName}`,
        );
        if (!result.success) {
          this.log(`[${new Date().toISOString()}]   Error: ${result.message}`);
          // Log stderr if available for debugging
          if (result.stderr) {
            this.log(`[${new Date().toISOString()}]   Stderr: ${result.stderr.substring(0, 500)}`);
          }
        }

        if (result.success) {
          anyEngineSucceeded = true;

          if (this.subtitleFormat === 'overwrite' && this.stateManager) {
            const engineOutputPath = getOutputPath(srtPath, engine);
            copyFileSync(engineOutputPath, srtPath);
            unlinkSync(engineOutputPath);
            this.stateManager.markFileProcessed(srtPath, engine);
            this.log(`[${new Date().toISOString()}] ✓ Overwritten original: ${fileName}`);
            this.emit('file:engine_completed', {
              srtPath,
              engine,
              result: { ...result, duration },
            });
            break;
          }
        }

        this.emit('file:engine_completed', {
          srtPath,
          engine,
          result: { ...result, duration },
        });
      } catch (error) {
        // Engine attempted to run (not skipped), so not all are skipped
        allEnginesSkipped = false;

        const duration = Date.now() - startTime;
        this.log(`[${new Date().toISOString()}] ✗ ${engine} failed (${(duration / 1000).toFixed(1)}s): ${fileName}`);
        this.log(`[${new Date().toISOString()}]   Error: ${error instanceof Error ? error.message : String(error)}`);

        this.emit('file:engine_completed', {
          srtPath,
          engine,
          result: {
            success: false,
            message: error instanceof Error ? error.message : String(error),
            duration,
          },
        });
      }
    }

    if (anyEngineSucceeded) {
      this.log(`[${new Date().toISOString()}] ✓ Completed successfully for: ${fileName}`);
      this.emit('file:completed', { srtPath });
    } else if (allEnginesSkipped) {
      this.log(`[${new Date().toISOString()}] ⊘ All engines skipped for: ${fileName}`);
      this.emit('file:skipped', { srtPath, reason: 'all_engines_skipped' });
    } else {
      this.log(`[${new Date().toISOString()}] ✗ All engines failed for: ${fileName}`);
      this.emit('file:failed', { srtPath });
    }
  }

  skipFile(filePath: string): void {
    this.cancelledFiles.add(filePath);
    this.emit('file:skip_requested', { filePath });
  }

  stopAllProcessing(allFiles: string[]): void {
    this.log(`[${new Date().toISOString()}] Stop requested - cancelling all remaining files`);
    allFiles.forEach((file) => this.cancelledFiles.add(file));
  }

  reset(): void {
    this.cancelledFiles.clear();
    this.clearLogs();
  }
}
