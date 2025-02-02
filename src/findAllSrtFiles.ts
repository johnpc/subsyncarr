import { readdir } from 'fs/promises';
import { extname, join } from 'path';
import { ScanConfig } from './config';

export async function findAllSrtFiles(config: ScanConfig): Promise<string[]> {
  const files: string[] = [];

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
        files.push(fullPath);
      }
    }
  }

  // Scan all included paths
  for (const includePath of config.includePaths) {
    await scan(includePath);
  }

  return files;
}
