import { basename } from 'path';
import { findAllSrtFiles } from './findAllSrtFiles';
import { findMatchingVideoFile } from './findMatchingVideoFile';
import { generateFfsubsyncSubtitles } from './generateFfsubsyncSubtitles';
import { generateAutosubsyncSubtitles } from './generateAutosubsyncSubtitles';

const SCAN_DIR = '/scan_dir';

async function main(): Promise<void> {
  const scanDir = SCAN_DIR;

  try {
    // Find all .srt files
    const srtFiles = await findAllSrtFiles(scanDir);
    console.log(`${new Date().toLocaleString()} Found ${srtFiles.length} SRT files`);

    // Process each SRT file
    for (const srtFile of srtFiles) {
      const videoFile = findMatchingVideoFile(srtFile);

      if (videoFile) {
        const ffsubsyncResult = await generateFfsubsyncSubtitles(srtFile, videoFile);
        console.log(`${new Date().toLocaleString()} ffsubsync result: ${ffsubsyncResult.message}`);
        const autosubsyncResult = await generateAutosubsyncSubtitles(srtFile, videoFile);
        console.log(`${new Date().toLocaleString()} autosubsync result: ${autosubsyncResult.message}`);
      } else {
        console.log(`${new Date().toLocaleString()} No matching video file found for: ${basename(srtFile)}`);
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error:', errorMessage);
  }
}

main();
