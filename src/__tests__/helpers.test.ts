import { execPromise } from '../helpers';

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const posixOnly = process.platform === 'win32' ? describe.skip : describe;

posixOnly('execPromise', () => {
  it('resolves with stdout and stderr on success', async () => {
    const { stdout, stderr } = await execPromise('echo out; echo err >&2', 5000);
    expect(stdout.trim()).toBe('out');
    expect(stderr.trim()).toBe('err');
  });

  it('rejects with the exit code when the command fails', async () => {
    await expect(execPromise('exit 3', 5000)).rejects.toMatchObject({ code: 3, killed: false });
  });

  it('kills the whole process tree on timeout, not just the shell', async () => {
    // Shell starts a long-running grandchild, prints its pid and then waits.
    // With exec()-style timeouts only the shell died and `sleep` kept running.
    const command = 'sleep 30 & echo $!; wait';

    const start = Date.now();
    let caught: unknown;
    try {
      await execPromise(command, 300);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const error = caught as Error & { stdout: string; killed: boolean };
    expect(error.message).toContain('timed out');
    expect(error.killed).toBe(true);
    // Must not have waited for the 30s grandchild to finish on its own.
    expect(Date.now() - start).toBeLessThan(10000);

    const grandchildPid = parseInt(error.stdout.trim(), 10);
    expect(grandchildPid).toBeGreaterThan(0);
    expect(isAlive(grandchildPid)).toBe(false);
  }, 15000);
});
