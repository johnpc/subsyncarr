import { execPromise } from '../execPromise';
import { generateAutosubsyncSubtitles } from '../generateAutosubsyncSubtitles';

jest.mock('../execPromise', () => ({ execPromise: jest.fn() }));

describe('generateAutosubsyncSubtitles', () => {
  it('skips .ass subtitles without running autosubsync', async () => {
    const result = await generateAutosubsyncSubtitles('/no/such/movie.en.ass', '/no/such/movie.mkv');
    expect(result.skipped).toBe(true);
    expect(result.message).toContain('does not support .ass');
    expect(execPromise).not.toHaveBeenCalled();
  });
});
