import { exec } from 'child_process';
import { basename, dirname, join } from 'path';
import { readFileSync, writeFileSync } from 'fs';

export type SubtitleFormat = 'standard' | 'overwrite';

export function getSubtitleFormat(): SubtitleFormat {
  const format = process.env.SUBTITLE_FORMAT || 'standard';
  if (format === 'overwrite') return 'overwrite';
  return 'standard';
}

export function getOutputPath(srtPath: string, engine: string): string {
  const directory = dirname(srtPath);
  const srtBaseName = basename(srtPath, '.srt');
  return join(directory, `${srtBaseName}.${engine}.srt`);
}

const SYNC_MARKER = '# synced:';

export function isSyncedSrt(srtPath: string): boolean {
  try {
    const content = readFileSync(srtPath, 'utf8');
    return content.startsWith(SYNC_MARKER);
  } catch {
    return false;
  }
}

export function markSrtAsSynced(srtPath: string, engine: string, content: string): void {
  const marker = `${SYNC_MARKER}${engine} ${Date.now()}\n`;
  writeFileSync(srtPath, marker + content, 'utf8');
}

export interface ProcessingResult {
  success: boolean;
  message: string;
  stdout?: string;
  stderr?: string;
  skipped?: boolean;
}

function getTimeoutMs(): number {
  // Support both SYNC_TIMEOUT (seconds) and SYNC_ENGINE_TIMEOUT_MS (milliseconds)
  const seconds = process.env.SYNC_TIMEOUT;
  if (seconds) {
    const val = parseInt(seconds, 10);
    if (!isNaN(val) && val > 0) return val * 1000;
  }
  const ms = process.env.SYNC_ENGINE_TIMEOUT_MS;
  if (ms) {
    const val = parseInt(ms, 10);
    if (!isNaN(val) && val > 0) return val;
  }
  return 1800000; // 30 minutes default
}

export function execPromise(command: string, timeoutMs?: number): Promise<{ stdout: string; stderr: string }> {
  const timeout = timeoutMs ?? getTimeoutMs();
  return new Promise((resolve, reject) => {
    exec(command, { timeout, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      if (error) {
        if (error.killed) {
          reject(new Error(`Timed out after ${timeout / 1000}s: ${command}`));
        } else {
          reject(error);
        }
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}
