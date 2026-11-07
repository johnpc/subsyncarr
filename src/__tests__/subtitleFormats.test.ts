import {
  engineSupportsSubtitle,
  getSubtitleExtension,
  isSubtitleFile,
  stripSubtitleExtension,
  unsupportedFormatResult,
} from '../subtitleFormats';

describe('subtitleFormats', () => {
  it('recognises .srt and .ass case-insensitively', () => {
    expect(getSubtitleExtension('/m/movie.en.srt')).toBe('.srt');
    expect(getSubtitleExtension('/m/movie.en.ASS')).toBe('.ass');
    expect(isSubtitleFile('movie.vtt')).toBe(false);
    expect(isSubtitleFile('movie.mkv')).toBe(false);
  });

  it('strips the directory and subtitle extension', () => {
    expect(stripSubtitleExtension('/m/movie.en.ass')).toBe('movie.en');
    expect(stripSubtitleExtension('/m/movie.en.srt')).toBe('movie.en');
    expect(stripSubtitleExtension('/m/movie.txt')).toBe('movie.txt');
  });

  it('knows which engines support .ass', () => {
    expect(engineSupportsSubtitle('ffsubsync', 'a.ass')).toBe(true);
    expect(engineSupportsSubtitle('alass', 'a.ass')).toBe(true);
    expect(engineSupportsSubtitle('autosubsync', 'a.ass')).toBe(false);
    expect(engineSupportsSubtitle('autosubsync', 'a.srt')).toBe(true);
  });

  it('returns a skip result only for unsupported formats', () => {
    expect(unsupportedFormatResult('ffsubsync', '/m/movie.en.ass')).toBeNull();
    expect(unsupportedFormatResult('autosubsync', '/m/movie.en.ass')).toEqual({
      success: true,
      skipped: true,
      message: 'Skipping autosubsync for movie.en.ass - autosubsync does not support .ass subtitles',
    });
  });
});
