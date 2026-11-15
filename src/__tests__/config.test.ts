import { getScanConfig } from '../config';

describe('getScanConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('defaults to /scan_dir when SCAN_PATHS is unset', () => {
    delete process.env.SCAN_PATHS;
    expect(getScanConfig().includePaths).toEqual(['/scan_dir']);
  });

  it('supports multiple scan paths', () => {
    process.env.SCAN_PATHS = '/movies,/tv,/tv2';
    expect(getScanConfig().includePaths).toEqual(['/movies', '/tv', '/tv2']);
  });

  it('trims whitespace around comma-separated paths', () => {
    process.env.SCAN_PATHS = '/movies, /tv , /tv2';
    process.env.EXCLUDE_PATHS = ' /tv/downloads ,';
    const config = getScanConfig();
    expect(config.includePaths).toEqual(['/movies', '/tv', '/tv2']);
    expect(config.excludePaths).toEqual(['/tv/downloads']);
  });

  it('drops invalid paths and falls back to /scan_dir when none remain', () => {
    process.env.SCAN_PATHS = 'relative,/a/../b';
    expect(getScanConfig().includePaths).toEqual(['/scan_dir']);
  });

  it('warns when a scan path does not exist', () => {
    process.env.SCAN_PATHS = '/definitely-not-mounted-xyz';
    getScanConfig();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('does not exist: /definitely-not-mounted-xyz'));
  });
});
