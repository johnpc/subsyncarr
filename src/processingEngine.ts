import EventEmitter from 'events';
import { ScanConfig, getScanConfig, getSyncRetryConfig } from './config';
import { findAllSrtFiles } from './findAllSrtFiles';
import { findMatchingVideoFile } from './findMatchingVideoFile';
import { generateFfsubsyncSubtitles } from './generateFfsubsyncSubtitles';
import { generateAutosubsyncSubtitles } from './generateAutosubsyncSubtitles';
import { generateAlassSubtitles } from './generateAlassSubtitles';
import { StateManager } from './stateManager';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { getSubtitleFormat, getOutputPath, markSrtAsSynced, isSyncedSrt } from './helpers';
import { calculateSubtitleOffset } from './subtitleOffsetCalculator';
import { basename, dirname, join } from 'path';

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
      this.logBuffer.shift();
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

    const srtFiles = await findAllSrtFiles(scanConfig);
    this.log(`[${new Date().toISOString()}] Found ${srtFiles.length} subtitle files`);
    this.emit('run:files_found', srtFiles);

    // Process in batches
    this.log(`[${new Date().toISOString()}] Processing with concurrency: ${this.maxConcurrent}`);
    this.log(`[${new Date().toISOString()}] Enabled engines: ${this.enabledEngines.join(', ')}`);

    const retryConfig = getSyncRetryConfig();
    this.log(
      `[${new Date().toISOString()}] Sync retry: threshold=${retryConfig.thresholdMs}ms, maxRetries=${retryConfig.maxRetries}`,
    );

    for (let i = 0; i < srtFiles.length; i += this.maxConcurrent) {
      const batch = srtFiles.slice(i, i + this.maxConcurrent);
      this.log(
        `[${new Date().toISOString()}] Processing batch ${Math.floor(i / this.maxConcurrent) + 1}/${Math.ceil(srtFiles.length / this.maxConcurrent)} (${batch.length} files)`,
      );
      await Promise.all(batch.map((file) => this.processFile(file)));
    }

    this.log(`[${new Date().toISOString()}] All files processed`);
  }

  private async runEngine(engine: string, srtPath: string, videoPath: string): Promise<{
    success: boolean;
    message: string;
    stdout?: string;
    stderr?: string;
    skipped?: boolean;
    duration: number;
  }> {
    const startTime = Date.now();
    try {
      let result;
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
          return { success: false, message: `Unknown engine: ${engine}`, duration: 0 };
      }
      const duration = Date.now() - startTime;
      return { ...result, duration };
    } catch (error) {
      const duration = Date.now() - startTime;
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
        duration,
      };
    }
  }

  /**
   * Create a temporary SRT file for retry attempts.
   * Returns the path to the temp file, or null on failure.
   */
  private createTempSrtFile(srtPath: string, content: string): string | null {
    const directory = dirname(srtPath);
    const srtBaseName = basename(srtPath, '.srt');
    const tempPath = join(directory, `${srtBaseName}.subsyncarr_retry.srt`);
    try {
      writeFileSync(tempPath, content, 'utf8');
      return tempPath;
    } catch (error) {
      this.log(`[${new Date().toISOString()}] Failed to create temp file: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Clean up temporary retry files.
   */
  private cleanupTempFiles(tempSrtPath: string | null, engine: string): void {
    if (tempSrtPath && existsSync(tempSrtPath)) {
      try {
        unlinkSync(tempSrtPath);
      } catch {
        // Ignore cleanup errors
      }
    }
    // Also clean up the engine output for the temp file
    if (tempSrtPath) {
      const tempOutputPath = getOutputPath(tempSrtPath, engine);
      if (existsSync(tempOutputPath)) {
        try {
          unlinkSync(tempOutputPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  private async processFile(srtPath: string): Promise<void> {
    const fileName = srtPath.split('/').pop()!;

    // Skip already-synced files (overwrite mode)
    if (this.subtitleFormat === 'overwrite' && (await isSyncedSrt(srtPath))) {
      this.log(`[${new Date().toISOString()}] ⊘ Already synced (header): ${fileName}`);
      this.emit('file:skipped', { srtPath, reason: 'already_synced' });
      return;
    }

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

    // Read original subtitle content for offset calculation
    let originalContent: string | null = null;
    try {
      originalContent = readFileSync(srtPath, 'utf8');
    } catch {
      this.log(`[${new Date().toISOString()}] Warning: Could not read original subtitle for offset calculation`);
    }

    const retryConfig = getSyncRetryConfig();

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

      const result = await this.runEngine(engine, srtPath, videoPath);

      // If this engine was skipped (already processed), log and continue
      if (result.skipped) {
        this.log(`[${new Date().toISOString()}] ⊘ ${engine} skipped (already processed): ${fileName}`);
        this.emit('file:engine_completed', {
          srtPath,
          engine,
          result: { ...result },
        });
        continue; // allEnginesSkipped stays true
      }

      // An engine actually ran (not skipped), so not all are skipped
      allEnginesSkipped = false;

      const status = result.success ? '✓' : '✗';
      this.log(
        `[${new Date().toISOString()}] ${status} ${engine} completed (${(result.duration / 1000).toFixed(1)}s): ${fileName}`,
      );
      if (!result.success) {
        this.log(`[${new Date().toISOString()}]   Error: ${result.message}`);
        if (result.stderr) {
          this.log(`[${new Date().toISOString()}]   Stderr: ${result.stderr.substring(0, 500)}`);
        }
      }

      if (result.success) {
        const engineOutputPath = getOutputPath(srtPath, engine);

        // --- Offset check and retry logic ---
        let finalContent: string | null = null;
        let offsetMs: number | null = null;
        let notFitting = false;

        if (originalContent && retryConfig.thresholdMs > 0) {
          // Read the synced output
          try {
            const syncedContent = readFileSync(engineOutputPath, 'utf8');
            offsetMs = calculateSubtitleOffset(originalContent, syncedContent);

            this.log(
              `[${new Date().toISOString()}]   Offset: ${offsetMs}ms (threshold: ${retryConfig.thresholdMs}ms)`,
            );

            if (Math.abs(offsetMs) > retryConfig.thresholdMs) {
              // Offset too large — retry with the synced subtitle as input
              this.log(
                `[${new Date().toISOString()}]   ⚠ Offset exceeds threshold, retrying ${engine} (attempt 2/${retryConfig.maxRetries + 1})...`,
              );
              this.emit('file:retry_needed', { srtPath, engine, offsetMs, attempt: 1 });

              // Create temp file with the first-synced content for retry
              const tempSrtPath = this.createTempSrtFile(srtPath, syncedContent);
              if (tempSrtPath) {
                try {
                  const retryResult = await this.runEngine(engine, tempSrtPath, videoPath);

                  if (retryResult.success) {
                    const retryOutputPath = getOutputPath(tempSrtPath, engine);
                    try {
                      const retryContent = readFileSync(retryOutputPath, 'utf8');
                      const retryOffsetMs = calculateSubtitleOffset(syncedContent, retryContent);

                      this.log(
                        `[${new Date().toISOString()}]   Retry offset: ${retryOffsetMs}ms (threshold: ${retryConfig.thresholdMs}ms)`,
                      );

                      if (Math.abs(retryOffsetMs) > retryConfig.thresholdMs) {
                        // Second attempt also off by too much — subtitle doesn't fit
                        this.log(
                          `[${new Date().toISOString()}]   ✗ Retry also off by ${retryOffsetMs}ms — subtitle likely doesn't fit this media`,
                        );
                        notFitting = true;
                      } else {
                        // Retry produced acceptable result — use it
                        this.log(
                          `[${new Date().toISOString()}]   ✓ Retry acceptable (offset ${retryOffsetMs}ms) — using retry result`,
                        );
                        finalContent = retryContent;
                        offsetMs = retryOffsetMs;
                      }
                    } catch {
                      this.log(`[${new Date().toISOString()}]   Could not read retry output, using first sync result`);
                      finalContent = syncedContent;
                    }
                  } else {
                    this.log(
                      `[${new Date().toISOString()}]   Retry failed: ${retryResult.message}`,
                    );
                    // Use first sync result since retry failed
                    finalContent = syncedContent;
                  }
                } finally {
                  this.cleanupTempFiles(tempSrtPath, engine);
                }
              } else {
                // Could not create temp file — use first sync result
                this.log(`[${new Date().toISOString()}]   Could not create temp file for retry, using first sync result`);
                finalContent = syncedContent;
              }
            } else {
              // Offset within threshold — first sync is good
              finalContent = syncedContent;
            }
          } catch {
            this.log(`[${new Date().toISOString()}]   Could not read synced output for offset calculation`);
            // Continue without offset check — use the result as-is
          }
        } else {
          // No original content or threshold disabled — skip offset check
          try {
            finalContent = readFileSync(engineOutputPath, 'utf8');
          } catch {
            finalContent = null;
          }
        }

        // Handle not_fitting case — subtitle doesn't match the media
        if (notFitting) {
          // Clean up the engine output file
          if (existsSync(engineOutputPath)) {
            try {
              unlinkSync(engineOutputPath);
            } catch {
              // Ignore cleanup errors
            }
          }
          this.emit('file:engine_completed', {
            srtPath,
            engine,
            result: {
              success: false,
              duration: result.duration,
              message: `Subtitle doesn't fit media (offset: ${offsetMs ?? 'unknown'}ms)`,
              offsetMs: offsetMs ?? undefined,
              notFitting: true,
            },
          });
          // Don't try other engines — subtitle doesn't fit regardless of engine
          this.log(`[${new Date().toISOString()}] ✗ Subtitle doesn't fit media: ${fileName}`);
          this.emit('file:not_fitting', { srtPath, engine, offsetMs: offsetMs ?? 0 });
          return;
        }

        // Use the final content
        anyEngineSucceeded = true;

        if (this.subtitleFormat === 'overwrite') {
          if (finalContent) {
            markSrtAsSynced(srtPath, engine, finalContent);
          } else {
            // Fallback: read from engine output if we don't have finalContent
            const content = readFileSync(engineOutputPath, 'utf8');
            markSrtAsSynced(srtPath, engine, content);
          }
          // Clean up engine output file
          if (existsSync(engineOutputPath)) {
            try {
              unlinkSync(engineOutputPath);
            } catch {
              // Ignore cleanup errors
            }
          }
          this.log(`[${new Date().toISOString()}] ✓ Synced (header-marked): ${fileName}`);
          this.emit('file:engine_completed', {
            srtPath,
            engine,
            result: { ...result, offsetMs: offsetMs ?? undefined },
          });
          break;
        } else {
          // Standard mode — keep the output file as-is
          this.emit('file:engine_completed', {
            srtPath,
            engine,
            result: { ...result, offsetMs: offsetMs ?? undefined },
          });
        }
      } else {
        this.emit('file:engine_completed', {
          srtPath,
          engine,
          result: { ...result },
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