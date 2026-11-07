import { basename, extname } from 'path';
import type { ProcessingResult } from './helpers';

export const SUBTITLE_EXTENSIONS = ['.srt', '.ass'] as const;
export type SubtitleExtension = (typeof SUBTITLE_EXTENSIONS)[number];

// Formats each sync engine can read and write.
// autosubsync only parses SubRip, so .ass files are skipped for it.
const ENGINE_FORMATS: Record<string, readonly SubtitleExtension[]> = {
  ffsubsync: ['.srt', '.ass'],
  autosubsync: ['.srt'],
  alass: ['.srt', '.ass'],
};

export function getSubtitleExtension(filePath: string): SubtitleExtension | null {
  const ext = extname(filePath).toLowerCase();
  return SUBTITLE_EXTENSIONS.find((supported) => supported === ext) ?? null;
}

export function isSubtitleFile(filePath: string): boolean {
  return getSubtitleExtension(filePath) !== null;
}

/** Returns the file name without its directory and subtitle extension. */
export function stripSubtitleExtension(filePath: string): string {
  const name = basename(filePath);
  const ext = getSubtitleExtension(name);
  return ext ? name.slice(0, -ext.length) : name;
}

export function engineSupportsSubtitle(engine: string, filePath: string): boolean {
  const ext = getSubtitleExtension(filePath);
  const formats = ENGINE_FORMATS[engine] ?? ['.srt'];
  return ext !== null && formats.includes(ext);
}

/** Skip result for an engine that cannot handle the subtitle's format, or null if it can. */
export function unsupportedFormatResult(engine: string, filePath: string): ProcessingResult | null {
  if (engineSupportsSubtitle(engine, filePath)) return null;
  const ext = extname(filePath).toLowerCase() || 'this';
  return {
    success: true,
    skipped: true,
    message: `Skipping ${engine} for ${basename(filePath)} - ${engine} does not support ${ext} subtitles`,
  };
}
