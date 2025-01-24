import { existsSync } from 'fs';
import { basename, dirname, join } from 'path';

type VideoExtension = '.mkv' | '.mp4' | '.avi' | '.mov';
const VIDEO_EXTENSIONS: VideoExtension[] = ['.mkv', '.mp4', '.avi', '.mov'];

export function findMatchingVideoFile(srtPath: string): string | null {
  const directory = dirname(srtPath);
  const srtBaseName = basename(srtPath, '.srt');

  // Try to find a video file with the same name but different extension
  for (const ext of VIDEO_EXTENSIONS) {
    const possibleVideoPath = join(directory, `${srtBaseName}${ext}`);
    if (existsSync(possibleVideoPath)) {
      return possibleVideoPath;
    }
  }

  return null;
}
