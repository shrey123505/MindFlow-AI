import { formatSecondsToTimestamp, parseTimestampToSeconds } from './youtube.ts';

export type CoverageMode = 'full-transcript' | 'timeline-sampled' | 'chapters-metadata';

export type DurationScaleTier = 'short' | 'medium' | 'long' | 'mega';

export interface VideoChapterMarker {
  title: string;
  startSeconds: number;
  endSeconds?: number;
  timestampLabel: string;
}

export interface TranscriptCaptionSegment {
  startSeconds: number;
  text: string;
}

export interface DurationScaleProfile {
  tier: DurationScaleTier;
  tierLabel: string;
  mainNodesMin: number;
  mainNodesMax: number;
  subNodesMin: number;
  subNodesMax: number;
  scriptChaptersMin: number;
  scriptChaptersMax: number;
  cheatSheetCardsMin: number;
  cheatSheetCardsMax: number;
  maxOutputTokens: number;
  timeoutMs: number;
}

export interface StratifiedTranscriptResult {
  text: string;
  coverageMode: 'full-transcript' | 'timeline-sampled';
  effectiveDurationSeconds: number;
  bucketCount: number;
  coveredStartSeconds: number;
  coveredEndSeconds: number;
}

/**
 * Returns duration-proportional structural targets, token budget, and timeout
 * so 5-minute explainers and 10-hour university courses both scale naturally.
 */
export function getDurationScaleProfile(durationSeconds?: number): DurationScaleProfile {
  const sec =
    typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds
      : 600;

  if (sec < 900) {
    return {
      tier: 'short',
      tierLabel: 'Short (< 15 min)',
      mainNodesMin: 4,
      mainNodesMax: 5,
      subNodesMin: 2,
      subNodesMax: 3,
      scriptChaptersMin: 5,
      scriptChaptersMax: 7,
      cheatSheetCardsMin: 4,
      cheatSheetCardsMax: 5,
      maxOutputTokens: 10240,
      timeoutMs: 28000,
    };
  }

  if (sec < 3600) {
    return {
      tier: 'medium',
      tierLabel: 'Medium (15–60 min)',
      mainNodesMin: 5,
      mainNodesMax: 7,
      subNodesMin: 3,
      subNodesMax: 4,
      scriptChaptersMin: 8,
      scriptChaptersMax: 12,
      cheatSheetCardsMin: 6,
      cheatSheetCardsMax: 8,
      maxOutputTokens: 14336,
      timeoutMs: 34000,
    };
  }

  if (sec < 10800) {
    return {
      tier: 'long',
      tierLabel: 'Long (1–3 hr)',
      mainNodesMin: 7,
      mainNodesMax: 8,
      subNodesMin: 3,
      subNodesMax: 4,
      scriptChaptersMin: 12,
      scriptChaptersMax: 16,
      cheatSheetCardsMin: 8,
      cheatSheetCardsMax: 10,
      maxOutputTokens: 18432,
      timeoutMs: 40000,
    };
  }

  return {
    tier: 'mega',
    tierLabel: 'Full Course / Marathon (3–12 hr+)',
    mainNodesMin: 8,
    mainNodesMax: 10,
    subNodesMin: 3,
    subNodesMax: 5,
    scriptChaptersMin: 15,
    scriptChaptersMax: 22,
    cheatSheetCardsMin: 10,
    cheatSheetCardsMax: 14,
    maxOutputTokens: 24576,
    timeoutMs: 46000,
  };
}

/**
 * Extracts chronological chapter timestamps from a YouTube video description.
 * Supports formats like:
 * - "0:00 Introduction"
 * - "01:15:20 - Dynamic Programming"
 * - "(10:02:15) Final Capstone Project"
 * - "Chapter 4 — 02:30:00 Trees & Graphs"
 */
export function extractChaptersFromDescription(
  description: string,
  maxDurationSeconds?: number
): VideoChapterMarker[] {
  if (!description || typeof description !== 'string') return [];

  const lines = description.split(/\r?\n/);
  const seenSeconds = new Set<number>();
  const markers: VideoChapterMarker[] = [];

  const lineTimestampRegex =
    /(?:^|\s|[\(\[])(\d{1,2}:\d{2}(?::\d{2})?)(?:[\)\]]|\s|$)/;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.length > 220) continue;

    const match = line.match(lineTimestampRegex);
    if (!match?.[1]) continue;

    const rawStamp = match[1];
    const seconds = parseTimestampToSeconds(rawStamp);
    if (
      typeof maxDurationSeconds === 'number' &&
      maxDurationSeconds > 0 &&
      seconds > maxDurationSeconds
    ) {
      continue;
    }

    if (seenSeconds.has(seconds)) continue;

    const cleanedTitle = line
      .replace(match[0], ' ')
      .replace(/^[\s\-–—:|•·.)\]]*(?:\d{1,2}:\d{2}(?::\d{2})?)[\s\-–—:|•·.)\]]*/, ' ')
      .replace(/^[\s\-–—:|•·.)\]]+/, '')
      .replace(/[\s\-–—:|•·(\[]+$/, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanedTitle || cleanedTitle.length < 2) continue;

    seenSeconds.add(seconds);
    markers.push({
      title: cleanedTitle.slice(0, 110),
      startSeconds: seconds,
      timestampLabel: formatSecondsToTimestamp(seconds),
    });
  }

  markers.sort((a, b) => a.startSeconds - b.startSeconds);

  // Guard against false positives (e.g., a single stray clock time in prose)
  if (markers.length < 2) return [];
  return markers.slice(0, 80);
}

/**
 * Best-effort extraction of official YouTube Chapters from watch page HTML
 * (`macroMarkersListItemRenderer` / `chapterRenderer` inside `ytInitialData`).
 */
export function extractChaptersFromYtInitialData(
  html: string,
  maxDurationSeconds?: number
): VideoChapterMarker[] {
  if (!html || typeof html !== 'string') return [];

  const markers: VideoChapterMarker[] = [];
  const seen = new Set<number>();

  // Pattern 1: chapterRenderer { title: { simpleText: "..." }, timeRangeStartMillis: 123000 }
  const chapterRegex =
    /"chapterRenderer"\s*:\s*\{\s*"title"\s*:\s*\{\s*"simpleText"\s*:\s*"((?:\\.|[^"\\])+)"\s*\}\s*,\s*"timeRangeStartMillis"\s*:\s*(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = chapterRegex.exec(html)) !== null) {
    const rawTitle = match[1];
    const millis = Number(match[2]);
    if (!Number.isFinite(millis) || millis < 0) continue;
    const seconds = Math.floor(millis / 1000);
    if (
      typeof maxDurationSeconds === 'number' &&
      maxDurationSeconds > 0 &&
      seconds > maxDurationSeconds
    ) {
      continue;
    }
    if (seen.has(seconds)) continue;

    let decodedTitle = rawTitle;
    try {
      decodedTitle = JSON.parse(`"${rawTitle}"`) as string;
    } catch {
      decodedTitle = rawTitle.replace(/\\"/g, '"');
    }
    const title = decodedTitle.trim();
    if (!title) continue;
    seen.add(seconds);
    markers.push({
      title: title.slice(0, 110),
      startSeconds: seconds,
      timestampLabel: formatSecondsToTimestamp(seconds),
    });
  }

  // Pattern 2: macroMarkersListItemRenderer { title: { simpleText: "..." }, timeDescription: { simpleText: "1:04:20" } }
  if (markers.length < 2) {
    const macroRegex =
      /"macroMarkersListItemRenderer"\s*:\s*\{\s*"title"\s*:\s*\{\s*"simpleText"\s*:\s*"((?:\\.|[^"\\])+)"\s*\}[\s\S]{0,360}?"timeDescription"\s*:\s*\{\s*"simpleText"\s*:\s*"(\d{1,2}:\d{2}(?::\d{2})?)"\s*\}/g;
    while ((match = macroRegex.exec(html)) !== null) {
      const rawTitle = match[1];
      const stamp = match[2];
      const seconds = parseTimestampToSeconds(stamp);
      if (
        typeof maxDurationSeconds === 'number' &&
        maxDurationSeconds > 0 &&
        seconds > maxDurationSeconds
      ) {
        continue;
      }
      if (seen.has(seconds)) continue;

      let decodedTitle = rawTitle;
      try {
        decodedTitle = JSON.parse(`"${rawTitle}"`) as string;
      } catch {
        decodedTitle = rawTitle.replace(/\\"/g, '"');
      }
      const title = decodedTitle.trim();
      if (!title) continue;
      seen.add(seconds);
      markers.push({
        title: title.slice(0, 110),
        startSeconds: seconds,
        timestampLabel: formatSecondsToTimestamp(seconds),
      });
    }
  }

  markers.sort((a, b) => a.startSeconds - b.startSeconds);
  return markers.length >= 2 ? markers.slice(0, 80) : [];
}

/** Merges official YouTube chapters with description-parsed chapters cleanly. */
export function mergeVideoChapters(
  officialChapters: VideoChapterMarker[],
  descriptionChapters: VideoChapterMarker[]
): VideoChapterMarker[] {
  if (officialChapters.length >= 2) {
    return officialChapters;
  }
  return descriptionChapters;
}

/**
 * Duration-Aware Stratified Transcript Compressor.
 * - Never truncates blindly from the start of a long video.
 * - If raw transcript fits within `maxChars` (default 120,000 chars), preserves 100% verbatim.
 * - If massive (e.g., 5–12 hour course), partitions 0%..100% of the timeline into
 *   24–32 evenly spaced chronological buckets (or chapter-aligned windows) and samples
 *   representative timestamped transcript lines from EVERY bucket from start to finish.
 */
export function compressTranscriptStratified(
  segments: TranscriptCaptionSegment[],
  totalDurationSeconds?: number,
  chapters: VideoChapterMarker[] = [],
  maxChars = 120000
): StratifiedTranscriptResult {
  const sorted = [...segments]
    .filter((s) => s.text.trim().length > 0 && Number.isFinite(s.startSeconds) && s.startSeconds >= 0)
    .sort((a, b) => a.startSeconds - b.startSeconds);

  if (sorted.length === 0) {
    const fallbackDuration = Math.max(0, Math.floor(totalDurationSeconds ?? 0));
    return {
      text: '',
      coverageMode: 'full-transcript',
      effectiveDurationSeconds: fallbackDuration,
      bucketCount: 0,
      coveredStartSeconds: 0,
      coveredEndSeconds: fallbackDuration,
    };
  }

  const lastSegmentSec = Math.floor(sorted[sorted.length - 1].startSeconds);
  const firstSegmentSec = Math.floor(sorted[0].startSeconds);
  const effectiveDurationSeconds = Math.max(
    Math.floor(totalDurationSeconds ?? 0),
    lastSegmentSec,
    1
  );

  const formattedLines = sorted.map(
    (seg) => `[${formatSecondsToTimestamp(seg.startSeconds)}] ${seg.text.trim()}`
  );
  const fullJoined = formattedLines.join('\n');

  if (fullJoined.length <= maxChars) {
    return {
      text: fullJoined,
      coverageMode: 'full-transcript',
      effectiveDurationSeconds,
      bucketCount: 1,
      coveredStartSeconds: firstSegmentSec,
      coveredEndSeconds: lastSegmentSec,
    };
  }

  // Decide chronological windows (chapter-aligned if well-distributed, else 28 equal buckets)
  interface TimeWindow {
    startSec: number;
    endSec: number;
    label?: string;
  }

  const windows: TimeWindow[] = [];
  const validChapters = chapters
    .filter((ch) => ch.startSeconds >= 0 && ch.startSeconds < effectiveDurationSeconds)
    .sort((a, b) => a.startSeconds - b.startSeconds);

  const useChapterWindows =
    validChapters.length >= 6 &&
    validChapters[validChapters.length - 1].startSeconds >= effectiveDurationSeconds * 0.65;

  if (useChapterWindows) {
    // Downsample evenly to at most 32 windows if a video has 60+ micro-chapters
    const targetWindows = Math.min(32, validChapters.length);
    for (let i = 0; i < targetWindows; i++) {
      const chIdx = Math.floor((i * validChapters.length) / targetWindows);
      const nextChIdx =
        i === targetWindows - 1
          ? validChapters.length
          : Math.floor(((i + 1) * validChapters.length) / targetWindows);
      const startSec = i === 0 ? 0 : validChapters[chIdx].startSeconds;
      const endSec =
        nextChIdx < validChapters.length
          ? validChapters[nextChIdx].startSeconds
          : effectiveDurationSeconds + 1;
      windows.push({
        startSec,
        endSec: Math.max(endSec, startSec + 1),
        label: validChapters[chIdx].title,
      });
    }
  } else {
    const bucketCount = effectiveDurationSeconds >= 21600 ? 32 : 28;
    const bucketSpan = effectiveDurationSeconds / bucketCount;
    for (let i = 0; i < bucketCount; i++) {
      const startSec = Math.floor(i * bucketSpan);
      const endSec =
        i === bucketCount - 1
          ? effectiveDurationSeconds + 1
          : Math.floor((i + 1) * bucketSpan);
      windows.push({ startSec, endSec: Math.max(endSec, startSec + 1) });
    }
  }

  // Assign every segment to its chronological window in a single O(N) sweep
  const bucketSegments: TranscriptCaptionSegment[][] = windows.map(() => []);
  let wIdx = 0;
  for (const seg of sorted) {
    while (wIdx < windows.length - 1 && seg.startSeconds >= windows[wIdx].endSec) {
      wIdx++;
    }
    bucketSegments[wIdx].push(seg);
  }

  const perBucketBudget = Math.max(600, Math.floor((maxChars - windows.length * 90) / windows.length));
  const chunks: string[] = [];
  let minCovered = Number.POSITIVE_INFINITY;
  let maxCovered = 0;

  for (let i = 0; i < windows.length; i++) {
    const win = windows[i];
    const segs = bucketSegments[i];
    if (segs.length === 0) continue;

    const startLabel = formatSecondsToTimestamp(win.startSec);
    const endLabel = formatSecondsToTimestamp(Math.min(win.endSec, effectiveDurationSeconds));
    const header = win.label
      ? `=== TIMELINE SEGMENT ${i + 1}/${windows.length} (${startLabel}–${endLabel} · ${win.label}) ===`
      : `=== TIMELINE SEGMENT ${i + 1}/${windows.length} (${startLabel}–${endLabel}) ===`;

    // Sample evenly across the bucket (start, middle, end) so we capture full arc inside each window
    const linesForBucket: string[] = [header];
    let usedChars = header.length + 1;

    const formattedBucket = segs.map(
      (s) => `[${formatSecondsToTimestamp(s.startSeconds)}] ${s.text.trim()}`
    );
    const totalBucketChars = formattedBucket.reduce((sum, l) => sum + l.length + 1, 0);

    if (totalBucketChars <= perBucketBudget) {
      for (let j = 0; j < segs.length; j++) {
        linesForBucket.push(formattedBucket[j]);
        minCovered = Math.min(minCovered, segs[j].startSeconds);
        maxCovered = Math.max(maxCovered, segs[j].startSeconds);
      }
    } else {
      const avgLineLen = Math.max(24, Math.ceil(totalBucketChars / segs.length));
      const desiredLines = Math.max(3, Math.floor(perBucketBudget / avgLineLen));
      const stride = Math.max(1, segs.length / desiredLines);

      const pickedIndices = new Set<number>();
      for (let k = 0; k < desiredLines; k++) {
        const idx = Math.min(segs.length - 1, Math.floor(k * stride));
        pickedIndices.add(idx);
      }
      // Always include first and last segment of every bucket for crisp boundary anchoring
      pickedIndices.add(0);
      pickedIndices.add(segs.length - 1);

      const orderedIndices = Array.from(pickedIndices).sort((a, b) => a - b);
      for (const idx of orderedIndices) {
        const line = formattedBucket[idx];
        if (usedChars + line.length + 1 > perBucketBudget && linesForBucket.length > 2) {
          break;
        }
        linesForBucket.push(line);
        usedChars += line.length + 1;
        minCovered = Math.min(minCovered, segs[idx].startSeconds);
        maxCovered = Math.max(maxCovered, segs[idx].startSeconds);
      }
    }

    chunks.push(linesForBucket.join('\n'));
  }

  return {
    text: chunks.join('\n\n'),
    coverageMode: 'timeline-sampled',
    effectiveDurationSeconds,
    bucketCount: windows.length,
    coveredStartSeconds: Number.isFinite(minCovered) ? Math.floor(minCovered) : firstSegmentSec,
    coveredEndSeconds: maxCovered > 0 ? Math.floor(maxCovered) : lastSegmentSec,
  };
}

/** Clamps a timestamp safely inside [0, maxDurationSeconds]. */
export function clampTimestampSeconds(
  seconds: number,
  maxDurationSeconds?: number
): number {
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  const floored = Math.floor(seconds);
  if (
    typeof maxDurationSeconds === 'number' &&
    Number.isFinite(maxDurationSeconds) &&
    maxDurationSeconds > 0
  ) {
    return Math.min(floored, Math.floor(maxDurationSeconds));
  }
  return floored;
}

/**
 * Reconciles AI-generated `timestampSeconds` and `timestampLabel`:
 * - Parses H:MM:SS / HH:MM:SS labels accurately (so hours are never dropped).
 * - Clamps to real video duration if known.
 * - Normalizes the label via `formatSecondsToTimestamp`.
 */
export function normalizeTimestampPair(
  rawSeconds: unknown,
  rawLabel: unknown,
  maxDurationSeconds?: number
): { seconds: number; label: string } {
  const labelStr = typeof rawLabel === 'string' ? rawLabel.trim() : '';
  const parsedFromLabel = labelStr ? parseTimestampToSeconds(labelStr) : 0;
  const numericSec =
    typeof rawSeconds === 'number'
      ? rawSeconds
      : typeof rawSeconds === 'string' && rawSeconds.trim() !== ''
        ? Number(rawSeconds)
        : Number.NaN;

  let chosen = 0;
  if (Number.isFinite(numericSec) && numericSec > 0) {
    // If label specifies an hour-level timestamp that disagrees sharply with a truncated numericSec
    // (e.g., AI put timestampLabel "2:15:00" but timestampSeconds 135), trust the explicit HH:MM:SS label!
    if (
      parsedFromLabel >= 3600 &&
      numericSec < 3600 &&
      Math.abs(parsedFromLabel - numericSec) > 600
    ) {
      chosen = parsedFromLabel;
    } else {
      chosen = numericSec;
    }
  } else if (parsedFromLabel > 0) {
    chosen = parsedFromLabel;
  } else if (Number.isFinite(numericSec) && numericSec >= 0) {
    chosen = numericSec;
  }

  const clamped = clampTimestampSeconds(chosen, maxDurationSeconds);
  return {
    seconds: clamped,
    label: formatSecondsToTimestamp(clamped),
  };
}
