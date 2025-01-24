import { readdir } from 'fs/promises';
import { extname, join } from 'path';

export async function findAllSrtFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  async function scan(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.srt') {
        files.push(fullPath);
      }
    }
  }

  await scan(dir);
  return files;
}
