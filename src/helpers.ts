import { basename, dirname, join } from 'path';

export function buildOutputPath(srtPath: string, suffix: string): string {
  const directory = dirname(srtPath);
  let srtBaseName = basename(srtPath, '.srt');
  if (srtBaseName.endsWith(`.${suffix}`)) {
    srtBaseName = srtBaseName.slice(0, -(suffix.length + 1));
  }
  return join(directory, `${srtBaseName}.${suffix}.srt`);
}

export interface ProcessingResult {
  success: boolean;
  message: string;
  stdout?: string;
  stderr?: string;
  skipped?: boolean;
}

export { execPromise } from './execPromise';
