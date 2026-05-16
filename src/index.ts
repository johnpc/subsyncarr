import { findAllSrtFiles } from './findAllSrtFiles';
import { getScanConfig } from './config';
import { processSrtFile } from './processSrtFile';

async function main(): Promise<void> {
  try {
    // Find all .srt files
    const scanConfig = getScanConfig();
    const { files: srtFiles, skippedCount } = await findAllSrtFiles(scanConfig);
    console.log(`${new Date().toLocaleString()} Found ${srtFiles.length} SRT files (${skippedCount} already synced)`);

    const maxConcurrentSyncTasks = process.env.MAX_CONCURRENT_SYNC_TASKS
      ? parseInt(process.env.MAX_CONCURRENT_SYNC_TASKS)
      : 1;

    for (let i = 0; i < srtFiles.length; i += maxConcurrentSyncTasks) {
      const chunk = srtFiles.slice(i, i + maxConcurrentSyncTasks);
      await Promise.all(chunk.map((srtFile) => processSrtFile(srtFile)));
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`${new Date().toLocaleString()} Error:`, errorMessage);
  } finally {
    console.log(`${new Date().toLocaleString()} subsyncarr-plus completed.`);
  }
}

main();
