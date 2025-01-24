import { access } from 'fs/promises';
import { basename, dirname, join } from 'path';
import { execPromise, ProcessingResult } from './helpers';

export async function generateFfsubsyncSubtitles(srtPath: string, videoPath: string): Promise<ProcessingResult> {
  const directory = dirname(srtPath);
  const srtBaseName = basename(srtPath, '.srt');
  const outputPath = join(directory, `${srtBaseName}.ffsubsync.srt`);

  // Check if synced subtitle already exists
  try {
    await access(outputPath);
    return {
      success: true,
      message: `Skipping ${srtBaseName} - already processed`,
    };
  } catch (error) {
    // File doesn't exist, proceed with sync
  }

  try {
    const command = `ffsubsync "${videoPath}" -i "${srtPath}" -o "${outputPath}"`;
    console.log(`${new Date().toLocaleString()} Processing: ${command}`);
    await execPromise(command);
    return {
      success: true,
      message: `Successfully processed: ${srtBaseName}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      message: `Error processing ${srtBaseName}: ${errorMessage}`,
    };
  }
}
