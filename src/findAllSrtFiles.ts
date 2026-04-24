import { readdir } from 'fs/promises';
import { basename, dirname, extname, join } from 'path';
import { existsSync } from 'fs';
import { ScanConfig } from './config';

function isAlreadySynced(srtPath: string, engines: string[]): boolean {
  const directory = dirname(srtPath);
  const srtBaseName = basename(srtPath, '.srt');

  return engines.every((engine) => {
    const outputPath = join(directory, `${srtBaseName}.${engine}.srt`);
    return existsSync(outputPath);
  });
}

export async function findAllSrtFiles(config: ScanConfig): Promise<string[]> {
  const engines = process.env.INCLUDE_ENGINES?.split(',') || ['ffsubsync', 'autosubsync', 'alass'];
  const files: string[] = [];
  let skippedCount = 0;

  async function scan(directory: string): Promise<void> {
    // Check if this directory should be excluded
    if (config.excludePaths.some((excludePath) => directory.startsWith(excludePath))) {
      return;
    }

    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (
        entry.isFile() &&
        extname(entry.name).toLowerCase() === '.srt' &&
        !entry.name.includes('.ffsubsync.') &&
        !entry.name.includes('.alass.') &&
        !entry.name.includes('.autosubsync.')
      ) {
        if (isAlreadySynced(fullPath, engines)) {
          skippedCount++;
        } else {
          files.push(fullPath);
        }
      }
    }
  }

  // Scan all included paths
  for (const includePath of config.includePaths) {
    await scan(includePath);
  }

  if (skippedCount > 0) {
    console.log(`${new Date().toLocaleString()} Skipped ${skippedCount} already-synced SRT files`);
  }

  return files;
}
