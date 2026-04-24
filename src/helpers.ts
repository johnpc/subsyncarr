import { exec } from 'child_process';

export interface ProcessingResult {
  success: boolean;
  message: string;
}

const DEFAULT_TIMEOUT_MS = 0; // 0 = no timeout

function getTimeoutMs(): number {
  const val = process.env.SYNC_TIMEOUT;
  if (!val) return DEFAULT_TIMEOUT_MS;
  const seconds = parseInt(val, 10);
  return isNaN(seconds) || seconds <= 0 ? DEFAULT_TIMEOUT_MS : seconds * 1000;
}

export function execPromise(command: string): Promise<{ stdout: string; stderr: string }> {
  const timeoutMs = getTimeoutMs();
  return new Promise((resolve, reject) => {
    const child = exec(command, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        if (error.killed) {
          reject(new Error(`Timed out after ${timeoutMs / 1000}s: ${command}`));
        } else {
          reject(error);
        }
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}
