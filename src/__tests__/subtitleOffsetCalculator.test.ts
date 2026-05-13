import { calculateSubtitleOffset } from '../subtitleOffsetCalculator';

describe('calculateSubtitleOffset', () => {
  it('should return 0 for identical content', () => {
    const content = `1
00:00:20,000 --> 00:00:24,400
Hello world

2
00:01:00,000 --> 00:01:04,000
Goodbye world`;

    expect(calculateSubtitleOffset(content, content)).toBe(0);
  });

  it('should calculate positive offset when synced subtitles are later', () => {
    const original = `1
00:00:20,000 --> 00:00:24,400
Hello world

2
00:01:00,000 --> 00:01:04,000
Goodbye world`;

    const synced = `1
00:00:25,000 --> 00:00:29,400
Hello world

2
00:01:05,000 --> 00:01:09,000
Goodbye world`;

    // Both entries shifted by 5000ms (5 seconds)
    expect(calculateSubtitleOffset(original, synced)).toBe(5000);
  });

  it('should calculate negative offset when synced subtitles are earlier', () => {
    const original = `1
00:00:25,000 --> 00:00:29,400
Hello world

2
00:01:05,000 --> 00:01:09,000
Goodbye world`;

    const synced = `1
00:00:20,000 --> 00:00:24,400
Hello world

2
00:01:00,000 --> 00:01:04,000
Goodbye world`;

    // Both entries shifted by -5000ms
    expect(calculateSubtitleOffset(original, synced)).toBe(-5000);
  });

  it('should use median offset to handle outliers', () => {
    const original = `1
00:00:20,000 --> 00:00:24,400
First

2
00:01:00,000 --> 00:01:04,000
Second

3
00:02:00,000 --> 00:02:04,000
Third`;

    const synced = `1
00:00:25,000 --> 00:00:29,400
First

2
00:01:05,000 --> 00:01:09,000
Second

3
00:02:30,000 --> 00:02:34,000
Third`;

    // Offsets: 5000, 5000, 30000
    // Median of [5000, 5000, 30000] = 5000
    expect(calculateSubtitleOffset(original, synced)).toBe(5000);
  });

  it('should return 0 for empty content', () => {
    const content = `1
00:00:20,000 --> 00:00:24,400
Hello world`;

    expect(calculateSubtitleOffset('', content)).toBe(0);
    expect(calculateSubtitleOffset(content, '')).toBe(0);
    expect(calculateSubtitleOffset('', '')).toBe(0);
  });

  it('should handle sync marker header lines', () => {
    const original = `1
00:00:20,000 --> 00:00:24,400
Hello world`;

    const syncedWithMarker = `# synced:ffsubsync 1234567890
1
00:00:25,000 --> 00:00:29,400
Hello world`;

    // Should ignore the sync marker line and calculate offset correctly
    expect(calculateSubtitleOffset(original, syncedWithMarker)).toBe(5000);
  });

  it('should handle large offset (30+ seconds)', () => {
    const original = `1
00:00:20,000 --> 00:00:24,400
Hello world

2
00:01:00,000 --> 00:01:04,000
Goodbye world`;

    const synced = `1
00:00:50,000 --> 00:00:54,400
Hello world

2
00:01:30,000 --> 00:01:34,000
Goodbye world`;

    // Both entries shifted by 30000ms (30 seconds)
    expect(calculateSubtitleOffset(original, synced)).toBe(30000);
  });

  it('should handle millisecond precision', () => {
    const original = `1
00:00:20,000 --> 00:00:24,400
Hello world`;

    const synced = `1
00:00:20,500 --> 00:00:24,900
Hello world`;

    // Offset of 500ms
    expect(calculateSubtitleOffset(original, synced)).toBe(500);
  });
});