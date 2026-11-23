import type { LanguageCode, LectureWorkspace } from '../types/mindflow';

const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

/** Returns true if the string is a valid 11-character YouTube video ID. */
export function isValidYouTubeId(videoId: string): boolean {
  return typeof videoId === 'string' && YOUTUBE_ID_REGEX.test(videoId.trim());
}

/** Validates that an external link uses only http: or https: protocols. */
export function isSafeHttpUrl(rawUrl: string): boolean {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export interface WorkspaceShareParams {
  videoId: string | null;
  startSeconds: number | null;
  language: LanguageCode | null;
}

export interface DetailedShareParams extends WorkspaceShareParams {
  hasShareParams: boolean;
  invalidVideoId: boolean;
  invalidTimestamp: boolean;
  invalidLanguage: boolean;
}

const MAX_SHARE_TIMESTAMP_SECONDS = 86400; // 24 hours sanity bound

/**
 * Strictly parses & validates ?v=<videoId>&t=<seconds|MM:SS|H:MM:SS>&lang=<en|hi|hinglish>
 * share parameters, reporting whether any supplied parameter was invalid.
 */
export function parseDetailedShareParams(search: string): DetailedShareParams {
  try {
    const params = new URLSearchParams(search);
    const hasV = params.has('v');
    const hasT = params.has('t');
    const hasLang = params.has('lang');
    const hasShareParams = hasV || hasT || hasLang;

    const rawV = params.get('v')?.trim() ?? '';
    const videoId = rawV ? extractYouTubeId(rawV) : null;
    const invalidVideoId = hasV && !videoId;

    const rawT = params.get('t')?.trim() ?? '';
    let startSeconds: number | null = null;
    if (rawT) {
      if (/^\d+$/.test(rawT)) {
        const parsed = Number.parseInt(rawT, 10);
        if (Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= MAX_SHARE_TIMESTAMP_SECONDS) {
          startSeconds = parsed;
        }
      } else if (/^\d{1,3}:\d{2}(?::\d{2})?$/.test(rawT)) {
        const parsedTs = parseTimestampToSeconds(rawT);
        if (
          parsedTs <= MAX_SHARE_TIMESTAMP_SECONDS &&
          (parsedTs > 0 || rawT === '00:00' || rawT === '0:00' || rawT === '0:00:00' || rawT === '00:00:00')
        ) {
          startSeconds = parsedTs;
        }
      }
    }
    const invalidTimestamp = hasT && startSeconds === null;

    const rawLang = params.get('lang')?.trim().toLowerCase() ?? '';
    const language: LanguageCode | null =
      rawLang === 'en' || rawLang === 'hi' || rawLang === 'hinglish'
        ? (rawLang as LanguageCode)
        : null;
    const invalidLanguage = hasLang && !language;

    return {
      videoId,
      startSeconds,
      language,
      hasShareParams,
      invalidVideoId,
      invalidTimestamp,
      invalidLanguage,
    };
  } catch {
    return {
      videoId: null,
      startSeconds: null,
      language: null,
      hasShareParams: false,
      invalidVideoId: false,
      invalidTimestamp: false,
      invalidLanguage: false,
    };
  }
}

/**
 * Parses ?v=<videoId>&t=<seconds>&lang=<en|hi|hinglish> share link parameters
 * so opening a shared MindFlow AI link restores the exact video, timestamp, and language.
 */
export function parseWorkspaceShareParams(search: string): WorkspaceShareParams {
  const { videoId, startSeconds, language } = parseDetailedShareParams(search);
  return { videoId, startSeconds, language };
}

/**
 * Generates 3 concise, context-aware starter questions for "Ask This Video"
 * directly from the active workspace's mindmap modules.
 */
export function buildDynamicChatPrompts(
  workspace: Pick<LectureWorkspace, 'title' | 'nodes'>,
  language: LanguageCode
): string[] {
  const mainNodes = workspace.nodes.filter((n) => !n.isRoot);
  const firstTopic = mainNodes[0]?.title?.trim();
  const lastTopic =
    mainNodes.length >= 2 ? mainNodes[mainNodes.length - 1]?.title?.trim() : undefined;

  if (language === 'hi') {
    return [
      firstTopic
        ? `"${firstTopic}" को आसान भाषा और वास्तविक उदाहरण से समझाएं`
        : 'इस वीडियो के मुख्य विषय को आसान भाषा में समझाएं',
      firstTopic && lastTopic && firstTopic !== lastTopic
        ? `"${firstTopic}" और "${lastTopic}" के बीच क्या संबंध या अंतर है?`
        : 'इस वीडियो के मुख्य कॉन्सेप्ट्स की तुलना करें',
      'इस वीडियो से 3 महत्वपूर्ण रिवीज़न प्रश्न (और संक्षिप्त उत्तर) बनाएं',
    ];
  }

  if (language === 'hinglish') {
    return [
      firstTopic
        ? `"${firstTopic}" ko simple language aur real-life example se samjhao`
        : 'Is video ka core concept simple language me samjhao',
      firstTopic && lastTopic && firstTopic !== lastTopic
        ? `"${firstTopic}" aur "${lastTopic}" ko compare karo ya connect karo`
        : 'Is video ke main concepts ka comparison samjhao',
      'Is video ke content se 3 quick revision questions banao',
    ];
  }

  return [
    firstTopic
      ? `Explain "${firstTopic}" simply with a concrete example`
      : 'Explain the core concept simply with a concrete example',
    firstTopic && lastTopic && firstTopic !== lastTopic
      ? `How do "${firstTopic}" and "${lastTopic}" compare or connect?`
      : 'Compare the main concepts covered in this video',
    'Generate 3 revision questions based on what this video actually covers',
  ];
}

function parseSingleYouTubeCandidate(raw: string): string | null {
  const cleaned = raw.trim().replace(/^<|>$/g, '').replace(/[),.;!?]+$/, '');
  if (!cleaned) return null;

  if (YOUTUBE_ID_REGEX.test(cleaned)) {
    return cleaned;
  }

  let normalized = cleaned;
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  try {
    const url = new URL(normalized);
    const host = url.hostname.replace(/^(www\.|m\.|mobile\.)/, '').toLowerCase();

    if (host === 'youtu.be') {
      const candidate = url.pathname.split('/').filter(Boolean)[0] ?? '';
      return YOUTUBE_ID_REGEX.test(candidate) ? candidate : null;
    }

    if (
      host === 'youtube.com' ||
      host === 'music.youtube.com' ||
      host === 'youtube-nocookie.com'
    ) {
      const watchId = url.searchParams.get('v');
      if (watchId && YOUTUBE_ID_REGEX.test(watchId)) {
        return watchId;
      }

      const parts = url.pathname.split('/').filter(Boolean);
      if (
        parts.length >= 2 &&
        (parts[0] === 'embed' ||
          parts[0] === 'shorts' ||
          parts[0] === 'live' ||
          parts[0] === 'v')
      ) {
        return YOUTUBE_ID_REGEX.test(parts[1]) ? parts[1] : null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Extracts a valid 11-character YouTube video ID from standard watch URLs,
 * short youtu.be links, Shorts, Live, Embeds, mobile URLs, pasted share text,
 * or a raw 11-char ID.
 */
export function extractYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const direct = parseSingleYouTubeCandidate(trimmed);
  if (direct) return direct;

  // Support mobile share strings like: "Great lecture! https://youtu.be/8hly31xKli0?si=abc"
  const embeddedUrlMatches = trimmed.match(
    /(?:https?:\/\/)?(?:(?:www|m|mobile|music)\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)\/[^\s"'<>]+/gi
  );
  if (embeddedUrlMatches) {
    for (const candidate of embeddedUrlMatches) {
      const id = parseSingleYouTubeCandidate(candidate);
      if (id) return id;
    }
  }

  return null;
}

/** Canonical watch URL used by YouTube oEmbed and Gemini multimodal analysis. */
export function normalizeYouTubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/** Deterministic cache key per video + language to prevent redundant API calls. */
export function buildWorkspaceCacheKey(videoId: string, language: LanguageCode): string {
  return `mindflow_ws_v2:${videoId}:${language}`;
}

/** Formats non-negative seconds into MM:SS (< 1 hour) or H:MM:SS (>= 1 hour). */
export function formatSecondsToTimestamp(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return '00:00';
  }
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Backwards-compatible alias for formatSecondsToTimestamp. */
export function formatSeconds(totalSeconds: number): string {
  return formatSecondsToTimestamp(totalSeconds);
}

/**
 * Parses MM:SS, H:MM:SS, or HH:MM:SS timestamp strings into exact integer seconds.
 * Never drops hours or misparses hours as minutes.
 */
export function parseTimestampToSeconds(label: string): number {
  if (typeof label !== 'string') return 0;
  const cleaned = label.trim().replace(/^[\[\(▶►\s]+|[\]\)\s]+$/g, '');
  const match = cleaned.match(/^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) return 0;

  const first = Number.parseInt(match[1], 10);
  const second = Number.parseInt(match[2], 10);
  const third = match[3] !== undefined ? Number.parseInt(match[3], 10) : null;

  if (
    Number.isNaN(first) ||
    Number.isNaN(second) ||
    (third !== null && Number.isNaN(third)) ||
    first < 0 ||
    second < 0 ||
    (third !== null && third < 0)
  ) {
    return 0;
  }

  if (third !== null) {
    // H:MM:SS or HH:MM:SS
    if (second >= 60 || third >= 60) return 0;
    return first * 3600 + second * 60 + third;
  }

  // MM:SS
  if (second >= 60) return 0;
  return first * 60 + second;
}

/** Backwards-compatible alias for parseTimestampToSeconds. */
export function parseTimestamp(label: string): number {
  return parseTimestampToSeconds(label);
}

/** Builds a clean YouTube IFrame embed URL with JS API enabled for live seeking. */
export function buildYouTubeEmbedUrl(videoId: string, startSeconds = 0): string {
  const params = new URLSearchParams({
    enablejsapi: '1',
    widgetid: '1',
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
  });
  if (startSeconds > 0) {
    params.set('start', String(Math.floor(startSeconds)));
  }
  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}
