import { spawn } from 'child_process';
import { basename, dirname, join } from 'path';

export function buildOutputPath(srtPath: string, suffix: string): string {
  const directory = dirname(srtPath);
  let srtBaseName = basename(srtPath, '.srt');
  if (srtBaseName.endsWith(`.${suffix}`)) {
    srtBaseName = srtBaseName.slice(0, -(suffix.length + 1));
  }
  return join(directory, `${srtBaseName}.${suffix}.srt`);
}

export interface ProcessingResult {
  success: boolean;
  message: string;
  stdout?: string;
  stderr?: string;
  skipped?: boolean;
}

export interface ExecError extends Error {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  killed: boolean;
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

// Grace period between SIGTERM and SIGKILL when a sync engine times out.
export const KILL_GRACE_MS = 5000;
// Cap on captured stdout/stderr, matching the old exec() maxBuffer.
const MAX_OUTPUT_BYTES = 1024 * 1024 * 10;

/**
 * Run a shell command with a timeout.
 *
 * The command is started in its own process group (`detached: true`). The sync
 * engines spawn their own children (ffsubsync/alass -> ffmpeg), and killing only
 * the shell on timeout - which is what child_process.exec's `timeout` does - left
 * those grandchildren running to completion. Because node is PID 1 inside the
 * container they were then re-parented to node, which never reaps processes it
 * did not spawn, so every timed-out sync leaked a set of <defunct> zombies.
 * Killing the whole process group with kill(-pid) terminates the entire tree.
 */
export function execPromise(command: string, timeoutMs?: number): Promise<{ stdout: string; stderr: string }> {
  const timeout = timeoutMs ?? getTimeoutMs();
  const useProcessGroup = process.platform !== 'win32';

  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      detached: useProcessGroup,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;

    const killTree = (signal: NodeJS.Signals): void => {
      if (!child.pid) return;
      try {
        if (useProcessGroup) {
          process.kill(-child.pid, signal);
        } else {
          child.kill(signal);
        }
      } catch {
        // Process (group) is already gone.
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree('SIGTERM');
      killTimer = setTimeout(() => killTree('SIGKILL'), KILL_GRACE_MS);
    }, timeout);

    const capture = (current: string, chunk: Buffer): string =>
      current.length >= MAX_OUTPUT_BYTES ? current : current + chunk.toString();
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = capture(stdout, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = capture(stderr, chunk);
    });

    const cleanup = (): void => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
    };

    child.on('error', (error) => {
      cleanup();
      reject(error);
    });

    // 'close' fires once the process has exited AND all stdio pipes are closed,
    // i.e. once every descendant holding the pipes is gone as well.
    child.on('close', (code, signal) => {
      cleanup();
      if (timedOut) {
        const error = new Error(
          `Process timed out after ${timeout / 1000}s and was killed (${signal ?? `exit ${code}`}): ${command}`,
        ) as ExecError;
        Object.assign(error, { stdout, stderr, code, signal, killed: true });
        reject(error);
        return;
      }
      if (code !== 0) {
        const detail = signal ? `signal ${signal}` : `exit code ${code}`;
        const error = new Error(`Command failed (${detail}): ${command}\n${stderr}`) as ExecError;
        Object.assign(error, { stdout, stderr, code, signal, killed: false });
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
