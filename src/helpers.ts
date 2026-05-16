import { exec } from 'child_process';
import { basename, dirname, join } from 'path';
import { writeFileSync } from 'fs';
import { open } from 'fs/promises';

export type SubtitleFormat = 'standard' | 'overwrite';

export function getSubtitleFormat(): SubtitleFormat {
  const format = process.env.SUBTITLE_FORMAT || 'standard';
  if (format === 'overwrite' || process.env.OVERWRITE_SUBTITLES === 'true') return 'overwrite';
  return 'standard';
}

export function getOutputPath(srtPath: string, engine: string): string {
  const directory = dirname(srtPath);
  const srtBaseName = basename(srtPath, '.srt');
  return join(directory, `${srtBaseName}.${engine}.srt`);
}

const SYNC_MARKER = '# synced:';

export async function isSyncedSrt(srtPath: string): Promise<boolean> {
  try {
    const fd = await open(srtPath, 'r');
    const buf = Buffer.alloc(100);
    await fd.read(buf, 0, 100, 0);
    await fd.close();
    return buf.toString('utf8').startsWith(SYNC_MARKER);
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
  /** Offset in ms between original and synced subtitles (if calculated) */
  offsetMs?: number;
  /** True when the subtitle doesn't fit the media (offset too large even after retry) */
  notFitting?: boolean;
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
