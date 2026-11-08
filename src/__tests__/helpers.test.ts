import { buildOutputPath } from '../helpers';

describe('buildOutputPath', () => {
  it('keeps the .srt extension', () => {
    expect(buildOutputPath('/m/movie.en.srt', 'ffsubsync')).toBe('/m/movie.en.ffsubsync.srt');
  });

  it('keeps the .ass extension', () => {
    expect(buildOutputPath('/m/movie.en.ass', 'ffsubsync')).toBe('/m/movie.en.ffsubsync.ass');
    expect(buildOutputPath('/m/movie.en.ass', 'alass')).toBe('/m/movie.en.alass.ass');
  });

  it('does not double up an existing suffix', () => {
    expect(buildOutputPath('/m/movie.en.ffsubsync.ass', 'ffsubsync')).toBe('/m/movie.en.ffsubsync.ass');
  });
});
