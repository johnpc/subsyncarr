import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createJobTempDir, sweepLeftoverTempDirs } from '../tempDir';

describe('tempDir', () => {
  let baseTmp: string;

  beforeEach(() => {
    baseTmp = mkdtempSync(join(tmpdir(), 'tempdir-test-'));
  });

  afterEach(() => {
    rmSync(baseTmp, { recursive: true, force: true });
  });

  function makeDir(name: string, files: string[] = []): void {
    mkdirSync(join(baseTmp, name));
    files.forEach((file) => writeFileSync(join(baseTmp, name, file), 'x'));
  }

  it('creates job dirs with the subsyncarr- prefix', () => {
    const dir = createJobTempDir(baseTmp);
    expect(readdirSync(baseTmp)).toEqual([dir.slice(baseTmp.length + 1)]);
    expect(dir).toContain('subsyncarr-');
  });

  it('sweeps job dirs and legacy autosubsync dirs but leaves everything else', () => {
    createJobTempDir(baseTmp);
    makeDir('tmp05s3e5ov', ['sound.flac']);
    makeDir('tmpunrelated', ['other.txt']);
    makeDir('somethingelse', ['sound.flac']);
    writeFileSync(join(baseTmp, 'tmpfile'), 'x');

    expect(sweepLeftoverTempDirs(baseTmp)).toBe(2);
    expect(readdirSync(baseTmp).sort()).toEqual(['somethingelse', 'tmpfile', 'tmpunrelated']);
  });

  it('returns 0 when the base dir does not exist', () => {
    expect(sweepLeftoverTempDirs(join(baseTmp, 'missing'))).toBe(0);
  });
});
