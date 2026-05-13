/**
 * Calculates the time offset between original and synced subtitle files.
 *
 * This is used to detect when a sync engine's output is still significantly
 * off from the video, which may indicate the subtitle doesn't match the media
 * and a retry (or rejection) is warranted.
 */

interface SrtEntry {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

/**
 * Parse an SRT timestamp string (HH:MM:SS,mmm) into milliseconds.
 */
function parseSrtTimestamp(timestamp: string): number {
  const match = timestamp.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
  if (!match) return 0;
  const [, hours, minutes, seconds, ms] = match;
  return parseInt(hours, 10) * 3600000 + parseInt(minutes, 10) * 60000 + parseInt(seconds, 10) * 1000 + parseInt(ms, 10);
}

/**
 * Parse SRT content into an array of entries with start/end times in ms.
 * Skips malformed blocks silently.
 */
function parseSrtContent(content: string): SrtEntry[] {
  // Strip any sync marker header lines (e.g. "# synced:ffsubsync 1234567890")
  const lines = content.split('\n');
  const filteredLines = lines.filter((line) => !line.startsWith('# synced:'));
  const cleanContent = filteredLines.join('\n');

  const blocks = cleanContent.trim().split(/\n\s*\n/);
  const entries: SrtEntry[] = [];

  for (const block of blocks) {
    const blockLines = block.trim().split('\n');
    if (blockLines.length < 2) continue;

    const index = parseInt(blockLines[0], 10);
    if (isNaN(index)) continue;

    const timeMatch = blockLines[1].match(
      /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/,
    );
    if (!timeMatch) continue;

    const startMs = parseSrtTimestamp(timeMatch[1]);
    const endMs = parseSrtTimestamp(timeMatch[2]);
    const text = blockLines.slice(2).join('\n');

    entries.push({ index, startMs, endMs, text });
  }

  return entries;
}

/**
 * Calculate the median of an array of numbers.
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Calculate the time offset (in milliseconds) between original and synced SRT content.
 *
 * Matches entries by index and computes the median shift in start times.
 * A positive offset means the synced subtitles are later than the original;
 * a negative offset means they are earlier.
 *
 * Returns 0 if either content is empty or cannot be parsed.
 */
export function calculateSubtitleOffset(originalContent: string, syncedContent: string): number {
  const original = parseSrtContent(originalContent);
  const synced = parseSrtContent(syncedContent);

  if (original.length === 0 || synced.length === 0) return 0;

  const offsets: number[] = [];
  const minLen = Math.min(original.length, synced.length);

  for (let i = 0; i < minLen; i++) {
    // Only include entries where both have valid timestamps
    if (original[i].startMs > 0 || synced[i].startMs > 0) {
      offsets.push(synced[i].startMs - original[i].startMs);
    }
  }

  return median(offsets);
}