import { execPromise } from '../execPromise';
import { generateFfsubsyncSubtitles } from '../generateFfsubsyncSubtitles';

jest.mock('../execPromise', () => ({ execPromise: jest.fn() }));

describe('generateFfsubsyncSubtitles', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.mocked(execPromise).mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('syncs .ass subtitles to an .ass output', async () => {
    const result = await generateFfsubsyncSubtitles('/no/such/movie.en.ass', '/no/such/movie.mkv');
    expect(result.success).toBe(true);
    expect(execPromise).toHaveBeenCalledWith(
      'ffsubsync "/no/such/movie.mkv" -i "/no/such/movie.en.ass" -o "/no/such/movie.en.ffsubsync.ass"',
    );
  });
});
