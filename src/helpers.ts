import { dirname, join } from 'path';
import { getSubtitleExtension, stripSubtitleExtension } from './subtitleFormats';

/** Builds e.g. movie.en.ffsubsync.srt / movie.en.ffsubsync.ass, keeping the input's subtitle format. */
export function buildOutputPath(subtitlePath: string, suffix: string): string {
  const directory = dirname(subtitlePath);
  const ext = getSubtitleExtension(subtitlePath) ?? '.srt';
  let baseName = stripSubtitleExtension(subtitlePath);
  if (baseName.endsWith(`.${suffix}`)) {
    baseName = baseName.slice(0, -(suffix.length + 1));
  }
  return join(directory, `${baseName}.${suffix}${ext}`);
}

export interface ProcessingResult {
  success: boolean;
  message: string;
  stdout?: string;
  stderr?: string;
  skipped?: boolean;
}

export { execPromise } from './execPromise';
