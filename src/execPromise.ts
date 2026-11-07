import { spawn } from 'child_process';
import { createJobTempDir, removeTempDir } from './tempDir';

const MAX_OUTPUT_BYTES = 1024 * 1024 * 10;

export interface CommandError extends Error {
  stdout: string;
  stderr: string;
  code?: number | null;
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

function killProcessGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    // Negative pid targets the whole group: the shell, the sync tool, and its ffmpeg children.
    process.kill(-pid, 'SIGKILL');
  } catch {
    // Group already exited
  }
}

function appendCapped(current: string, chunk: Buffer): string {
  return current.length >= MAX_OUTPUT_BYTES ? current : (current + chunk.toString()).slice(0, MAX_OUTPUT_BYTES);
}

function commandError(message: string, stdout: string, stderr: string, code?: number | null): CommandError {
  return Object.assign(new Error(message), { stdout, stderr, code });
}

function run(command: string, timeout: number, tempDir: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn(command, {
      shell: true,
      // Own process group, so a timeout kills the tool itself, not just the wrapping shell
      detached: true,
      env: { ...process.env, TMPDIR: tempDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessGroup(child.pid);
    }, timeout);

    child.stdout.on('data', (chunk: Buffer) => (stdout = appendCapped(stdout, chunk)));
    child.stderr.on('data', (chunk: Buffer) => (stderr = appendCapped(stderr, chunk)));

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(commandError(error.message, stdout, stderr));
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(commandError(`Timed out after ${timeout / 1000}s: ${command}`, stdout, stderr, code));
      } else if (code !== 0) {
        const reason = signal ? `killed by ${signal}` : `exit code ${code}`;
        reject(commandError(`Command failed (${reason}): ${command}\n${stderr}`, stdout, stderr, code));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// Each command gets a private TMPDIR that is deleted afterwards, so intermediate
// files (e.g. autosubsync's ~500MB sound.flac) can't pile up when a tool is killed.
export async function execPromise(command: string, timeoutMs?: number): Promise<{ stdout: string; stderr: string }> {
  const tempDir = createJobTempDir();
  try {
    return await run(command, timeoutMs ?? getTimeoutMs(), tempDir);
  } finally {
    removeTempDir(tempDir);
  }
}
