import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
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

describe('findAllSrtFiles generated-output exclusion', () => {
  const originalEnv = process.env;
  let directory: string;

  beforeEach(async () => {
    process.env = {
      ...originalEnv,
      INCLUDE_ENGINES: 'ffsubsync',
      SYNC_LANGUAGES: '',
      FFSUBSYNC_SUFFIX: '',
      AUTOSUBSYNC_SUFFIX: '',
      ALASS_SUFFIX: '',
    };
    directory = await mkdtemp(join(tmpdir(), 'subsyncarr-scan-'));
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(directory, { recursive: true, force: true });
  });

  async function writeFiles(fileNames: string[], targetDirectory = directory): Promise<void> {
    await Promise.all(fileNames.map((fileName) => writeFile(join(targetDirectory, fileName), '')));
  }

  it('excludes all default engine outputs when only ffsubsync is enabled', async () => {
    await writeFiles(['movie.en.srt', 'movie.en.alass.srt', 'movie.en.autosubsync.srt']);

    // Keep this output separate so movie.en.srt still needs ffsubsync processing.
    const otherDirectory = join(directory, 'other');
    await mkdir(otherDirectory);
    await writeFiles(['movie.en.ffsubsync.srt'], otherDirectory);

    const result = await findAllSrtFiles({ includePaths: [directory], excludePaths: [] });

    expect(result).toEqual({ files: [join(directory, 'movie.en.srt')], skippedCount: 0 });
  });

  it.each(['ffsubsync', 'autosubsync', 'alass'])(
    'excludes custom outputs from every engine when only %s is enabled',
    async (engine) => {
      process.env.INCLUDE_ENGINES = engine;
      process.env.FFSUBSYNC_SUFFIX = 'ffsubsync-aligned';
      process.env.AUTOSUBSYNC_SUFFIX = 'autosubsync-aligned';
      process.env.ALASS_SUFFIX = 'alass-aligned';

      await writeFiles(['movie.ro.srt']);
      const otherDirectory = join(directory, 'other');
      await mkdir(otherDirectory);
      await writeFiles(
        ['movie.ro.ffsubsync-aligned.srt', 'movie.ro.autosubsync-aligned.srt', 'movie.ro.alass-aligned.srt'],
        otherDirectory,
      );

      const result = await findAllSrtFiles({ includePaths: [directory], excludePaths: [] });

      expect(result).toEqual({ files: [join(directory, 'movie.ro.srt')], skippedCount: 0 });
    },
  );

  it('only requires enabled engine outputs to count a source as already synced', async () => {
    process.env.FFSUBSYNC_SUFFIX = 'ffsubsync-aligned';
    await writeFiles(['movie.en.srt', 'movie.en.ffsubsync-aligned.srt']);

    const result = await findAllSrtFiles({ includePaths: [directory], excludePaths: [] });

    expect(result).toEqual({ files: [], skippedCount: 1 });
  });
});
