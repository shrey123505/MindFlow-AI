import type { LectureWorkspace, SavedLibraryEntry } from '../types/mindflow';
import { extractYouTubeId, isValidYouTubeId, normalizeYouTubeUrl } from './youtube.ts';

const MANUAL_ID_PREFIX = 'manual-';
const MANUAL_ID_REGEX = /^manual-[a-z0-9_-]{4,40}$/i;

/**
 * Deterministic 32-bit FNV-1a hash in base-36 for creating stable, distinct
 * manual transcript workspace IDs without relying on Node-only crypto APIs.
 */
function fnv1aHash36(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

/**
 * Generates a unique, safe workspace identity for a manually pasted transcript.
 * Distinct transcripts always get distinct IDs so they never collide in caches,
 * Saved Library, or chat history.
 */
export function createManualTranscriptId(transcriptText: string): string {
  const normalized = transcriptText.trim().replace(/\s+/g, ' ').slice(0, 12000);
  const headHash = fnv1aHash36(normalized || 'empty');
  const tailHash = fnv1aHash36(`${normalized.length}:${normalized.slice(-2000)}`);
  return `${MANUAL_ID_PREFIX}${headHash}${tailHash.slice(0, 4)}`;
}

/** Returns true if the given videoId belongs to a transcript-only workspace. */
export function isManualTranscriptId(videoId: string | null | undefined): boolean {
  if (typeof videoId !== 'string') return false;
  const trimmed = videoId.trim();
  return trimmed === 'manual-transcript' || MANUAL_ID_REGEX.test(trimmed);
}

/** Returns true when a workspace or library entry is transcript-only (not YouTube-backed). */
export function isManualTranscriptWorkspace(
  item:
    | Pick<LectureWorkspace, 'videoId' | 'sourceType'>
    | Pick<SavedLibraryEntry, 'videoId' | 'sourceType'>
    | null
    | undefined
): boolean {
  if (!item) return false;
  if (item.sourceType === 'manual-transcript') return true;
  if (isManualTranscriptId(item.videoId)) return true;
  return !isValidYouTubeId(item.videoId);
}

export interface ManualTranscriptIdentityResult {
  ok: boolean;
  videoId: string;
  youtubeUrl: string;
  sourceType: 'youtube' | 'manual-transcript';
  error?: string;
}

/**
 * Resolves the exact identity for a manual transcript analysis.
 * Strictly NEVER inherits or falls back to a previous unrelated workspace's videoId.
 */
export function resolveManualTranscriptIdentity(params: {
  transcript: string;
  optionalYouTubeUrl?: string;
}): ManualTranscriptIdentityResult {
  const trimmedTranscript = params.transcript.trim();
  const rawOptionalUrl = (params.optionalYouTubeUrl ?? '').trim();

  if (!rawOptionalUrl) {
    return {
      ok: true,
      videoId: createManualTranscriptId(trimmedTranscript),
      youtubeUrl: '',
      sourceType: 'manual-transcript',
    };
  }

  const extractedId = extractYouTubeId(rawOptionalUrl);
  if (!extractedId) {
    return {
      ok: false,
      videoId: '',
      youtubeUrl: '',
      sourceType: 'manual-transcript',
      error:
        'The optional YouTube URL is invalid. Fix the link or leave it blank to create a transcript-only workspace.',
    };
  }

  return {
    ok: true,
    videoId: extractedId,
    youtubeUrl: normalizeYouTubeUrl(extractedId),
    sourceType: 'youtube',
  };
}
