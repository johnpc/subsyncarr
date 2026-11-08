import { mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const JOB_DIR_PREFIX = 'subsyncarr-';

// Sync tools (autosubsync, ffsubsync) write large intermediate audio files
// (e.g. sound.flac, often 500MB+) to TMPDIR and only remove them on a clean
// Python exit. If the tool is killed (timeout, OOM), the file is orphaned.
// Giving each job its own directory lets us always remove it ourselves.
export function createJobTempDir(baseDir: string = tmpdir()): string {
  return mkdtempSync(join(baseDir, JOB_DIR_PREFIX));
}

export function removeTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    console.error(`${new Date().toLocaleString()} Failed to remove temp dir ${dir}:`, error);
  }
}

function isLeftoverDir(baseDir: string, name: string): boolean {
  if (name.startsWith(JOB_DIR_PREFIX)) return true;
  // Directories orphaned by versions before per-job TMPDIR: Python's
  // tempfile.mkdtemp() names them tmpXXXXXXXX and autosubsync puts sound.flac inside.
  if (!name.startsWith('tmp')) return false;
  try {
    return readdirSync(join(baseDir, name)).includes('sound.flac');
  } catch {
    return false;
  }
}

// Call once at startup, before any sync jobs run.
export function sweepLeftoverTempDirs(baseDir: string = tmpdir()): number {
  let entries: string[];
  try {
    entries = readdirSync(baseDir);
  } catch {
    return 0;
  }
  const leftovers = entries.filter((name) => isLeftoverDir(baseDir, name));
  leftovers.forEach((name) => removeTempDir(join(baseDir, name)));
  return leftovers.length;
}
