import { basename } from 'path';
import { findMatchingVideoFile } from './findMatchingVideoFile';
import { generateAutosubsyncSubtitles } from './generateAutosubsyncSubtitles';
import { generateFfsubsyncSubtitles } from './generateFfsubsyncSubtitles';

export const processSrtFile = async (srtFile: string) => {
  const videoFile = findMatchingVideoFile(srtFile);
  const includeEngines = process.env.INCLUDE_ENGINES?.split(',') || ['ffsubsync', 'autosubsync'];

  if (videoFile) {
    if (includeEngines.includes('ffsubsync')) {
      const ffsubsyncResult = await generateFfsubsyncSubtitles(srtFile, videoFile);
      console.log(`${new Date().toLocaleString()} ffsubsync result: ${ffsubsyncResult.message}`);
    }
    if (includeEngines.includes('autosubsync')) {
      const autosubsyncResult = await generateAutosubsyncSubtitles(srtFile, videoFile);
      console.log(`${new Date().toLocaleString()} autosubsync result: ${autosubsyncResult.message}`);
    }
  } else {
    console.log(`${new Date().toLocaleString()} No matching video file found for: ${basename(srtFile)}`);
  }
};
