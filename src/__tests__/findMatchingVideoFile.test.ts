import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { findMatchingVideoFile } from '../findMatchingVideoFile';

describe('findMatchingVideoFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'video-match-test-'));
    writeFileSync(join(dir, 'movie.mkv'), 'x');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('matches .ass subtitles to their video', () => {
    expect(findMatchingVideoFile(join(dir, 'movie.ass'))).toBe(join(dir, 'movie.mkv'));
    expect(findMatchingVideoFile(join(dir, 'movie.en.ass'))).toBe(join(dir, 'movie.mkv'));
  });

  it('still matches .srt subtitles', () => {
    expect(findMatchingVideoFile(join(dir, 'movie.en.srt'))).toBe(join(dir, 'movie.mkv'));
  });
});
