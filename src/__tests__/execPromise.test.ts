import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CommandError, execPromise } from '../execPromise';

// Writes a fake sound.flac into $TMPDIR and prints that dir, like autosubsync does.
const WRITE_TEMP_FILE = 'mkdir -p "$TMPDIR/tmpabc" && echo data > "$TMPDIR/tmpabc/sound.flac" && echo "$TMPDIR"';

function expectJobDirRemoved(stdout: string | undefined): void {
  const jobDir = (stdout ?? '').trim();
  expect(jobDir.startsWith(join(tmpdir(), 'subsyncarr-'))).toBe(true);
  expect(existsSync(jobDir)).toBe(false);
}

function captureError(promise: Promise<unknown>): Promise<CommandError | undefined> {
  return promise.then(
    () => undefined,
    (e: CommandError) => e,
  );
}

describe('execPromise', () => {
  it('runs the command in a private TMPDIR and removes it on success', async () => {
    const { stdout } = await execPromise(WRITE_TEMP_FILE);
    expectJobDirRemoved(stdout);
  });

  it('removes the private TMPDIR when the command fails', async () => {
    const error = await captureError(execPromise(`${WRITE_TEMP_FILE} && echo oops >&2 && exit 3`));

    expect(error?.code).toBe(3);
    expect(error?.stderr).toBe('oops\n');
    expectJobDirRemoved(error?.stdout);
  });

  it('kills the whole process tree on timeout and removes the private TMPDIR', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'exec-test-'));
    const pidFile = join(scratch, 'grandchild.pid');
    // The backgrounded sleep mimics a long-running sync tool spawned by the shell.
    const command = `${WRITE_TEMP_FILE} && sleep 30 & echo $! > "${pidFile}"; wait`;

    try {
      const error = await captureError(execPromise(command, 300));

      expect(error?.message).toMatch(/^Timed out after 0.3s/);
      expectJobDirRemoved(error?.stdout);
      const grandchildPid = parseInt(readFileSync(pidFile, 'utf8'), 10);
      expect(() => process.kill(grandchildPid, 0)).toThrow();
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
