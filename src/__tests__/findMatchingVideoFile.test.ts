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

  it('matches a .ts video with the same base name', () => {
    writeFileSync(join(dir, 'Show - S01E01.ts'), 'x');
    writeFileSync(join(dir, 'Show - S01E01.srt'), '');
    expect(findMatchingVideoFile(join(dir, 'Show - S01E01.srt'))).toBe(join(dir, 'Show - S01E01.ts'));
  });

  it('matches a .ts video after removing language and flag tags', () => {
    writeFileSync(join(dir, 'F1.ts'), 'x');
    writeFileSync(join(dir, 'F1.en.hi.srt'), '');
    expect(findMatchingVideoFile(join(dir, 'F1.en.hi.srt'))).toBe(join(dir, 'F1.ts'));
  });

  it('still prefers .mkv when a .ts with the same name exists', () => {
    writeFileSync(join(dir, 'movie.ts'), 'x');
    expect(findMatchingVideoFile(join(dir, 'movie.en.srt'))).toBe(join(dir, 'movie.mkv'));
  });
});
