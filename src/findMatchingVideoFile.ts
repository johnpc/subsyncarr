import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { stripSubtitleExtension } from './subtitleFormats';

type VideoExtension = '.mkv' | '.mp4' | '.avi' | '.mov';
const VIDEO_EXTENSIONS: VideoExtension[] = ['.mkv', '.mp4', '.avi', '.mov'];

export function findMatchingVideoFile(srtPath: string): string | null {
  const directory = dirname(srtPath);
  const srtBaseName = stripSubtitleExtension(srtPath);

  // Try exact match first
  for (const ext of VIDEO_EXTENSIONS) {
    const possibleVideoPath = join(directory, `${srtBaseName}${ext}`);
    if (existsSync(possibleVideoPath)) {
      return possibleVideoPath;
    }
  }

  // Progressive tag removal - split by dots and try removing one segment at a time
  const segments = srtBaseName.split('.');
  while (segments.length > 1) {
    segments.pop(); // Remove the last segment
    const baseNameToTry = segments.join('.');

    for (const ext of VIDEO_EXTENSIONS) {
      const possibleVideoPath = join(directory, `${baseNameToTry}${ext}`);
      if (existsSync(possibleVideoPath)) {
        return possibleVideoPath;
      }
    }
  }

  return null;
}
