import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { findAllSrtFiles } from '../findAllSrtFiles';

describe('findAllSrtFiles', () => {
  let dir: string;
  const originalEngines = process.env.INCLUDE_ENGINES;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'find-subs-test-'));
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
    if (originalEngines === undefined) delete process.env.INCLUDE_ENGINES;
    else process.env.INCLUDE_ENGINES = originalEngines;
  });

  const touch = (...names: string[]) => names.forEach((name) => writeFileSync(join(dir, name), 'x'));
  const scan = () => findAllSrtFiles({ includePaths: [dir], excludePaths: [] });

  it('finds .srt and .ass files but never generated outputs', async () => {
    process.env.INCLUDE_ENGINES = 'ffsubsync,alass';
    touch('a.en.srt', 'b.en.ass', 'b.en.ffsubsync.ass', 'c.en.alass.ass', 'd.vtt');
    const { files } = await scan();
    expect(files.sort()).toEqual([join(dir, 'a.en.srt'), join(dir, 'b.en.ass')]);
  });

  it('treats .ass as synced once every engine that supports it has output', async () => {
    process.env.INCLUDE_ENGINES = 'ffsubsync,autosubsync,alass';
    touch('movie.en.ass', 'movie.en.ffsubsync.ass', 'movie.en.alass.ass');
    expect(await scan()).toEqual({ files: [], skippedCount: 1 });
  });

  it('ignores .ass files when only unsupported engines are enabled', async () => {
    process.env.INCLUDE_ENGINES = 'autosubsync';
    touch('movie.en.ass', 'movie.en.srt');
    expect(await scan()).toEqual({ files: [join(dir, 'movie.en.srt')], skippedCount: 0 });
  });
});
