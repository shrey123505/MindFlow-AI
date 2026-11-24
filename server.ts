import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel, Type, type Schema } from '@google/genai';
import {
  buildProxyImageUrl,
  buildYouTubeFrameUrl,
  isAllowedRemoteImageUrl,
  sanitizeOptionalSvgDiagram,
} from './src/utils/visualGuide.ts';
import {
  formatSecondsToTimestamp,
  isSafeHttpUrl,
  isValidYouTubeId,
  parseTimestampToSeconds,
} from './src/utils/youtube.ts';
import {
  compressTranscriptStratified,
  extractChaptersFromDescription,
  extractChaptersFromYtInitialData,
  getDurationScaleProfile,
  mergeVideoChapters,
  normalizeTimestampPair,
  type CoverageMode,
  type TranscriptCaptionSegment,
  type VideoChapterMarker,
} from './src/utils/longVideo.ts';
import { createManualTranscriptId } from './src/utils/manualTranscript.ts';
import {
  buildVisualGuideContext,
  retrieveChatContext,
  validateChatCitations,
} from './src/utils/contextRetrieval.ts';
import {
  compressPlainTextStratified,
  detectContentDomain,
  ensureFullTimelineCoverage,
  formatStructuredSimplification,
  getAdaptiveScaleProfile,
  getDomainCheatSheetGuidance,
  getLanguagePromptGuide,
  normalizeAndDeduplicateWorkspace,
  parseStructuredSimplification,
  sampleItemsEvenly,
  validateWorkspaceQuality,
} from './src/utils/educationalPipeline.ts';
import type { LectureWorkspace } from './src/types/mindflow.ts';
import {
  classifyApiError,
  computeWorkspaceContentFingerprint,
  ConcurrencyLimiter,
  executeWithGeminiRetry,
  hashCacheKey,
  InFlightDeduplicator,
  isAllowedApiOrigin,
  isAllowedRasterImageMime,
  isAllowedYouTubeCaptionUrl,
  isAllowedYouTubeUserUrl,
  readResponseBufferWithLimit,
  resolveTrustProxySetting,
  sanitizeLogString,
  sanitizeUserText,
  SlidingWindowRateLimiter,
  TtlLruCache,
} from './src/utils/serverGuards.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT ?? 3000);
const isCompiledProductionBundle =
  path.basename(__filename) === 'server.js' &&
  fs.existsSync(path.join(__dirname, 'index.html')) &&
  fs.existsSync(path.join(__dirname, 'assets'));
const isProduction =
  process.env.NODE_ENV === 'production' || isCompiledProductionBundle;
const FREE_TIER_MODELS = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'] as const;

type LanguageCode = 'en' | 'hi' | 'hinglish';

/**
 * Tracks actual HTTP client disconnects safely on Node 18/20/22+.
 * Note: Listening on `req.on('close')` fires immediately once the request body finishes
 * streaming in Node 16+, whereas `res.on('close')` with `!res.writableEnded` accurately
 * fires only when the client disconnects before the response completes.
 */
function createClientAbortController(res: express.Response): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) {
      controller.abort(new Error('Client connection closed.'));
    }
  };
  res.on('close', onClose);
  return {
    controller,
    cleanup: () => {
      res.off('close', onClose);
    },
  };
}

/**
 * Links a bounded timeout controller to an optional parent AbortSignal and cleans up listeners.
 */
function createLinkedTimeoutController(
  timeoutMs: number,
  label: string,
  parentSignal?: AbortSignal
): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`${label} timed out after ${Math.max(1, Math.round(timeoutMs / 1000))}s`));
  }, timeoutMs);

  const onParentAbort = () => {
    controller.abort(parentSignal?.reason ?? new Error('Client connection closed.'));
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      clearTimeout(timer);
      controller.abort(parentSignal.reason ?? new Error('Client connection closed.'));
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  return {
    controller,
    cleanup: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onParentAbort);
    },
  };
}

function sendClassifiedApiError(
  res: express.Response,
  error: unknown,
  fallbackMessage: string,
  context: string,
  extra?: Record<string, unknown>
): void {
  const classified = classifyApiError(error, fallbackMessage);
  console.warn(`[MindFlow API:${context}] ${classified.code} (${classified.status}) — ${sanitizeLogString(error)}`);
  if (res.headersSent || res.writableEnded || res.destroyed) {
    return;
  }
  if (classified.retryAfterSeconds) {
    res.setHeader('Retry-After', String(classified.retryAfterSeconds));
  }
  res.status(classified.status).json({
    error: classified.error,
    code: classified.code,
    retryable: classified.retryable,
    ...(classified.retryAfterSeconds ? { retryAfterSeconds: classified.retryAfterSeconds } : {}),
    ...(extra ?? {}),
  });
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('Empty JSON response.');
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // Strip markdown code fences or surrounding prose
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : trimmed;
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(candidate.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
    }
    throw new Error('Could not parse structured JSON from AI response.');
  }
}

function stripThinkingConfig(
  params: Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'>
): Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'> {
  if (!params.config || !('thinkingConfig' in params.config)) {
    return params;
  }
  const clonedConfig = { ...params.config };
  delete clonedConfig.thinkingConfig;
  return { ...params, config: clonedConfig };
}

const modelRateLimitCooldownUntil = new Map<string, number>();
const keyRateLimitCooldownUntil = new Map<string, number>();
let keyRoundRobinCursor = 0;

/** Holds a visitor's own Gemini key (sent via x-user-gemini-key) for the duration of one API request. */
const requestKeyStorage = new AsyncLocalStorage<string>();

function getConfiguredGeminiApiKeys(): string[] {
  const ownKey = requestKeyStorage.getStore();
  if (ownKey) return [ownKey];
  const candidates: string[] = [];
  const pushRaw = (raw: string | undefined) => {
    if (!raw) return;
    for (const part of raw.split(/[\s,;]+/)) {
      const cleaned = part.trim();
      if (cleaned && cleaned !== 'MY_GEMINI_API_KEY' && !candidates.includes(cleaned)) {
        candidates.push(cleaned);
      }
    }
  };
  pushRaw(process.env.GEMINI_API_KEY);
  pushRaw(process.env.GEMINI_API_KEYS);
  pushRaw(process.env.GEMINI_API_KEY_2);
  pushRaw(process.env.GEMINI_API_KEY_3);
  pushRaw(process.env.GEMINI_API_KEY_4);
  pushRaw(process.env.GEMINI_API_KEY_5);
  return candidates;
}

function buildGeminiClientForKey(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function pickGeminiClientForAttempt(fallbackClient: GoogleGenAI, now = Date.now()): {
  client: GoogleGenAI;
  keyId: string;
} {
  const keys = getConfiguredGeminiApiKeys();
  if (keys.length <= 1) {
    return { client: fallbackClient, keyId: keys[0] ?? 'default' };
  }
  const startIdx = keyRoundRobinCursor % keys.length;
  keyRoundRobinCursor = (keyRoundRobinCursor + 1) % keys.length;

  for (let offset = 0; offset < keys.length; offset++) {
    const key = keys[(startIdx + offset) % keys.length];
    const cooldownUntil = keyRateLimitCooldownUntil.get(key) ?? 0;
    if (cooldownUntil <= now) {
      return { client: buildGeminiClientForKey(key), keyId: key };
    }
  }
  const fallbackKey = keys[startIdx];
  return { client: buildGeminiClientForKey(fallbackKey), keyId: fallbackKey };
}

function getOrderedFreeTierModels(now = Date.now()): readonly string[] {
  const active: string[] = [];
  const cooledDown: string[] = [];
  for (const m of FREE_TIER_MODELS) {
    const until = modelRateLimitCooldownUntil.get(m) ?? 0;
    if (until > now) {
      cooledDown.push(m);
    } else {
      active.push(m);
    }
  }
  return [...active, ...cooledDown];
}

/**
 * Resilient Gemini caller powered by `executeWithGeminiRetry` across configured models and API keys:
 * - Forwards a per-attempt AbortSignal to `@google/genai` `config.abortSignal` (which passes it to `fetch`).
 * - Respects client disconnects via `parentSignal` (including aborting retry backoff sleep).
 * - Automatically rotates across multiple configured API keys (`GEMINI_API_KEY`, `GEMINI_API_KEYS`, `GEMINI_API_KEY_2..5`)
 *   and falls back across `FREE_TIER_MODELS` on 429 quota/rate limits.
 * - Automatically strips `thinkingConfig` on `gemini-3.1-flash-lite` fallback for compatibility.
 */
async function generateWithFreeTierFallback(
  ai: GoogleGenAI,
  params: Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'>,
  timeoutMs = 24000,
  maxRounds = 2,
  options?: { parentSignal?: AbortSignal }
) {
  const keyCount = Math.max(1, getConfiguredGeminiApiKeys().length);
  return executeWithGeminiRetry({
    models: getOrderedFreeTierModels(),
    timeoutMs: Math.max(10_000, Math.min(timeoutMs, 45_000)),
    maxRounds: Math.max(maxRounds, Math.min(4, keyCount + 1)),
    parentSignal: options?.parentSignal,
    invoke: async (model, attemptSignal) => {
      const adapted =
        model === 'gemini-3.1-flash-lite' ? stripThinkingConfig(params) : params;
      const { client, keyId } = pickGeminiClientForAttempt(ai);
      try {
        return await client.models.generateContent({
          ...adapted,
          model,
          config: {
            ...(adapted.config ?? {}),
            abortSignal: attemptSignal,
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err ?? '');
        const status = Number((err as { status?: number; code?: number } | null)?.status ?? 0);
        if (status === 429 || /\b429\b|RESOURCE_EXHAUSTED|quota|rate limit/i.test(msg)) {
          keyRateLimitCooldownUntil.set(keyId, Date.now() + 60_000);
          if (keyCount <= 1) {
            modelRateLimitCooldownUntil.set(model, Date.now() + 60_000);
          }
        }
        throw err;
      }
    },
  });
}

function createGeminiClient(): GoogleGenAI | null {
  const keys = getConfiguredGeminiApiKeys();
  if (keys.length === 0) {
    return null;
  }
  const { client } = pickGeminiClientForAttempt(buildGeminiClientForKey(keys[0]));
  return client;
}

function getLanguageInstruction(language: LanguageCode): string {
  return getLanguagePromptGuide(language);
}

interface OEmbedInfo {
  title?: string;
  authorName?: string;
  httpStatus?: number;
  unavailable?: boolean;
}

/** Layer 1: Safely fetch YouTube title & channel via public oEmbed with 4s timeout */
async function fetchYouTubeOEmbed(
  videoId: string,
  parentSignal?: AbortSignal
): Promise<OEmbedInfo> {
  const { controller, cleanup } = createLinkedTimeoutController(
    4000,
    'YouTube oEmbed',
    parentSignal
  );

  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${videoId}`
    )}&format=json`;
    const resp = await fetch(oembedUrl, {
      signal: controller.signal,
      redirect: 'manual',
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) {
      return {
        httpStatus: resp.status,
        unavailable: resp.status === 401 || resp.status === 403 || resp.status === 404,
      };
    }
    const data = (await resp.json()) as { title?: string; author_name?: string };
    return {
      title: data.title?.trim(),
      authorName: data.author_name?.trim(),
      httpStatus: resp.status,
    };
  } catch {
    return {};
  } finally {
    cleanup();
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeJsonEscapedString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
}

interface YouTubeExtractedBundle {
  captionSegments: TranscriptCaptionSegment[];
  title?: string;
  authorName?: string;
  description?: string;
  lengthSeconds?: number;
  keywords?: string[];
  chapters: VideoChapterMarker[];
  playabilityStatus?: string;
  playabilityReason?: string;
}

const MAX_CAPTION_XML_BYTES = 4 * 1024 * 1024;

/**
 * Fetches and parses the ENTIRE caption track (zero early segment truncation)
 * after strictly validating the timedtext host/path against YouTube's allowlist.
 */
async function fetchCaptionSegments(
  tracks: Array<{ baseUrl?: string; languageCode?: string }>,
  signal: AbortSignal
): Promise<TranscriptCaptionSegment[]> {
  if (!Array.isArray(tracks) || tracks.length === 0) return [];
  const validTracks = tracks.filter(
    (t) => typeof t.baseUrl === 'string' && isAllowedYouTubeCaptionUrl(t.baseUrl)
  );
  if (validTracks.length === 0) return [];

  const preferred =
    validTracks.find((t) => t.languageCode?.startsWith('en')) ??
    validTracks.find((t) => t.languageCode?.startsWith('hi')) ??
    validTracks[0];
  if (!preferred?.baseUrl) return [];

  const captionResp = await fetch(preferred.baseUrl, {
    signal,
    redirect: 'manual',
  });
  if (!captionResp.ok) return [];
  const xmlBuf = await readResponseBufferWithLimit(captionResp, MAX_CAPTION_XML_BYTES);
  const xml = xmlBuf.toString('utf-8');

  const segments: TranscriptCaptionSegment[] = [];
  const textRegex = /<text[^>]*start="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let match: RegExpExecArray | null;
  while ((match = textRegex.exec(xml)) !== null) {
    const start = Number.parseFloat(match[1]);
    const cleaned = decodeHtmlEntities(match[2]);
    if (cleaned && Number.isFinite(start) && start >= 0) {
      segments.push({ startSeconds: start, text: cleaned });
    }
  }

  // Fallback for SRV3 / timedtext <p t="ms"> format
  if (segments.length < 5) {
    const pRegex = /<p[^>]*t="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
    while ((match = pRegex.exec(xml)) !== null) {
      const startMs = Number.parseInt(match[1], 10);
      const cleaned = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, ' '));
      if (cleaned && Number.isFinite(startMs) && startMs >= 0) {
        segments.push({ startSeconds: startMs / 1000, text: cleaned });
      }
    }
  }

  return segments.length >= 5 ? segments : [];
}

/**
 * Layer 2: Best-effort server-side YouTube metadata, official chapters, & full caption extraction.
 * Queries both YouTube InnerTube player API and watch page HTML in parallel
 * with bounded timeouts so datacenter blocks never hang the request.
 */
async function fetchYouTubeBundle(
  videoId: string,
  parentSignal?: AbortSignal
): Promise<YouTubeExtractedBundle> {
  const { controller, cleanup } = createLinkedTimeoutController(
    6500,
    'YouTube bundle',
    parentSignal
  );

  try {
    const [innerTubeResult, watchHtmlResult] = await Promise.allSettled([
      fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        signal: controller.signal,
        redirect: 'manual',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          context: {
            client: {
              clientName: 'ANDROID',
              clientVersion: '20.10.38',
            },
          },
        }),
      }).then((r) => (r.ok ? r.json() : null)),
      fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      }).then((r) => (r.ok ? r.text() : '')),
    ]);

    let title: string | undefined;
    let authorName: string | undefined;
    let description: string | undefined;
    let lengthSeconds: number | undefined;
    let keywords: string[] | undefined;
    let tracks: Array<{ baseUrl?: string; languageCode?: string }> = [];
    let officialChapters: VideoChapterMarker[] = [];
    let playabilityStatus: string | undefined;
    let playabilityReason: string | undefined;

    if (innerTubeResult.status === 'fulfilled' && innerTubeResult.value) {
      const it = innerTubeResult.value as {
        playabilityStatus?: {
          status?: string;
          reason?: string;
        };
        videoDetails?: {
          title?: string;
          author?: string;
          shortDescription?: string;
          lengthSeconds?: string;
          keywords?: string[];
        };
        captions?: {
          playerCaptionsTracklistRenderer?: {
            captionTracks?: Array<{ baseUrl?: string; languageCode?: string }>;
          };
        };
      };
      playabilityStatus = it.playabilityStatus?.status?.trim();
      playabilityReason = it.playabilityStatus?.reason?.trim();
      title = it.videoDetails?.title?.trim() || title;
      authorName = it.videoDetails?.author?.trim() || authorName;
      description = it.videoDetails?.shortDescription?.trim() || description;
      const parsedLen = Number(it.videoDetails?.lengthSeconds ?? 0);
      if (Number.isFinite(parsedLen) && parsedLen > 0) {
        lengthSeconds = parsedLen;
      }
      if (Array.isArray(it.videoDetails?.keywords)) {
        keywords = it.videoDetails.keywords.slice(0, 16);
      }
      const itTracks = it.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (Array.isArray(itTracks) && itTracks.length > 0) {
        tracks = itTracks;
      }
    }

    if (watchHtmlResult.status === 'fulfilled' && watchHtmlResult.value) {
      const html = watchHtmlResult.value;
      if (!lengthSeconds) {
        const lenMatch =
          html.match(/"lengthSeconds":"(\d+)"/) ??
          html.match(/"approxDurationMs":"(\d+)"/);
        if (lenMatch?.[1]) {
          const rawNum = Number(lenMatch[1]);
          const parsed = lenMatch[0].includes('approxDurationMs')
            ? Math.round(rawNum / 1000)
            : rawNum;
          if (Number.isFinite(parsed) && parsed > 0) {
            lengthSeconds = parsed;
          }
        }
      }
      if (!lengthSeconds) {
        let maxEndMs = 0;
        const endMsRegex = /"endTimeMs":"(\d+)"/g;
        let endMatch: RegExpExecArray | null;
        while ((endMatch = endMsRegex.exec(html)) !== null) {
          const val = Number(endMatch[1]);
          if (Number.isFinite(val) && val > maxEndMs && val <= 72 * 3600 * 1000) {
            maxEndMs = val;
          }
        }
        if (maxEndMs >= 10_000) {
          lengthSeconds = Math.round(maxEndMs / 1000);
        }
      }
      if (!description || description.length < 250) {
        const shortDescMatch = html.match(/"shortDescription":"((?:\\.|[^"\\])*)"/);
        if (shortDescMatch?.[1]) {
          const decoded = decodeJsonEscapedString(shortDescMatch[1]).trim();
          if (decoded.length > (description?.length ?? 0)) {
            description = decoded;
          }
        }
      }
      if (!description || description.length < 250) {
        const attrDescMatch = html.match(
          /"attributedDescription":\{"content":"((?:\\.|[^"\\])*)"/
        );
        if (attrDescMatch?.[1]) {
          const decoded = decodeJsonEscapedString(attrDescMatch[1]).trim();
          if (decoded.length > (description?.length ?? 0)) {
            description = decoded;
          }
        }
      }
      if (!description) {
        const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
        if (descMatch?.[1]) {
          description = decodeHtmlEntities(descMatch[1]);
        }
      }
      if (!title) {
        const titleMeta = html.match(/<meta\s+name="title"\s+content="([^"]*)"/i);
        if (titleMeta?.[1]) {
          title = decodeHtmlEntities(titleMeta[1]);
        }
      }
      if (tracks.length === 0) {
        const trackMatch = html.match(/"captionTracks":(\[[\s\S]*?\])/);
        if (trackMatch) {
          try {
            tracks = JSON.parse(trackMatch[1]);
          } catch {
            // Ignore malformed caption JSON
          }
        }
      }
      officialChapters = extractChaptersFromYtInitialData(html, lengthSeconds);
    }

    // Fallback: if duration or title is still unknown (e.g. datacenter LOGIN_REQUIRED without macro markers),
    // query InnerTube WEB search endpoint for exact lengthText (e.g. "9:45:58") and title.
    if (!lengthSeconds || !title) {
      try {
        const searchResp = await fetch(
          'https://www.youtube.com/youtubei/v1/search?prettyPrint=false',
          {
            method: 'POST',
            signal: controller.signal,
            redirect: 'manual',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: videoId,
              context: {
                client: {
                  clientName: 'WEB',
                  clientVersion: '2.20250214.01.00',
                },
              },
            }),
          }
        );
        if (searchResp.ok) {
          const searchRaw = await searchResp.text();
          const marker = `"videoRenderer":{"videoId":"${videoId}"`;
          const idx = searchRaw.indexOf(marker);
          if (idx !== -1) {
            const slice = searchRaw.slice(idx, idx + 4500);
            if (!lengthSeconds) {
              const lenTextMatch = slice.match(
                /"lengthText":\{(?:[^{}]|\{[^{}]*\})*?"simpleText":"(\d{1,2}:\d{2}(?::\d{2})?)"/
              );
              if (lenTextMatch?.[1]) {
                const parsedSec = parseTimestampToSeconds(lenTextMatch[1]);
                if (parsedSec > 0) {
                  lengthSeconds = parsedSec;
                }
              }
            }
            if (!title) {
              const titleMatch = slice.match(
                /"title":\{"runs":\[\{"text":"((?:\\.|[^"\\])*)"/
              );
              if (titleMatch?.[1]) {
                title = decodeJsonEscapedString(titleMatch[1]).trim() || title;
              }
            }
            if (!authorName) {
              const ownerMatch = slice.match(
                /"ownerText":\{"runs":\[\{"text":"((?:\\.|[^"\\])*)"/
              );
              if (ownerMatch?.[1]) {
                authorName = decodeJsonEscapedString(ownerMatch[1]).trim() || authorName;
              }
            }
          }
        }
      } catch {
        // Non-fatal fallback
      }
    }

    const descriptionChapters = extractChaptersFromDescription(
      description ?? '',
      lengthSeconds
    );
    const chapters = mergeVideoChapters(officialChapters, descriptionChapters);
    if (lengthSeconds && chapters.length > 0) {
      const lastChapter = chapters[chapters.length - 1];
      if (!lastChapter.endSeconds && lengthSeconds > lastChapter.startSeconds) {
        lastChapter.endSeconds = lengthSeconds;
      }
    }

    const captionSegments =
      tracks.length > 0 ? await fetchCaptionSegments(tracks, controller.signal) : [];

    return {
      captionSegments,
      title,
      authorName,
      description: description?.slice(0, 16000),
      lengthSeconds,
      keywords,
      chapters,
      playabilityStatus,
      playabilityReason,
    };
  } catch {
    return { captionSegments: [], chapters: [] };
  } finally {
    cleanup();
  }
}

const KEY_POINT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    keyword: { type: Type.STRING },
    detail: { type: Type.STRING },
  },
  required: ['keyword', 'detail'],
};

const SUB_NODE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    id: { type: Type.STRING },
    parentId: { type: Type.STRING },
    title: { type: Type.STRING },
    shortSubtitle: { type: Type.STRING },
    timestampLabel: { type: Type.STRING },
    timestampSeconds: { type: Type.INTEGER },
    accent: { type: Type.STRING },
    icon: { type: Type.STRING },
    keyPoints: { type: Type.ARRAY, items: KEY_POINT_SCHEMA },
    realLifeExample: { type: Type.STRING },
    simplifiedAnalogy: { type: Type.STRING },
  },
  required: [
    'id',
    'parentId',
    'title',
    'shortSubtitle',
    'timestampLabel',
    'timestampSeconds',
    'accent',
    'icon',
    'keyPoints',
    'realLifeExample',
    'simplifiedAnalogy',
  ],
};

const WORKSPACE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    channel: { type: Type.STRING },
    durationLabel: { type: Type.STRING },
    videoCategory: { type: Type.STRING },
    tldw: { type: Type.ARRAY, items: { type: Type.STRING } },
    nodes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          title: { type: Type.STRING },
          shortSubtitle: { type: Type.STRING },
          timestampLabel: { type: Type.STRING },
          timestampSeconds: { type: Type.INTEGER },
          isRoot: { type: Type.BOOLEAN },
          accent: { type: Type.STRING },
          icon: { type: Type.STRING },
          keyPoints: { type: Type.ARRAY, items: KEY_POINT_SCHEMA },
          realLifeExample: { type: Type.STRING },
          simplifiedAnalogy: { type: Type.STRING },
          subNodes: { type: Type.ARRAY, items: SUB_NODE_SCHEMA },
        },
        required: [
          'id',
          'title',
          'shortSubtitle',
          'timestampLabel',
          'timestampSeconds',
          'accent',
          'icon',
          'keyPoints',
          'simplifiedAnalogy',
        ],
      },
    },
    cheatSheet: {
      type: Type.OBJECT,
      properties: {
        definitionsTitle: { type: Type.STRING },
        comparisonTableTitle: { type: Type.STRING },
        comparisonColumns: { type: Type.ARRAY, items: { type: Type.STRING } },
        examplesTitle: { type: Type.STRING },
        definitions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              term: { type: Type.STRING },
              summary: { type: Type.STRING },
              formulaOrNote: { type: Type.STRING },
              accent: { type: Type.STRING },
              timestampLabel: { type: Type.STRING },
              timestampSeconds: { type: Type.INTEGER },
              moduleLabel: { type: Type.STRING },
              category: { type: Type.STRING },
            },
            required: ['term', 'summary', 'formulaOrNote', 'accent'],
          },
        },
        complexityRows: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              structureOrAlgo: { type: Type.STRING },
              access: { type: Type.STRING },
              search: { type: Type.STRING },
              insert: { type: Type.STRING },
              space: { type: Type.STRING },
              rating: { type: Type.STRING },
              ratingLabel: { type: Type.STRING },
            },
            required: [
              'structureOrAlgo',
              'access',
              'search',
              'insert',
              'space',
              'rating',
              'ratingLabel',
            ],
          },
        },
        realWorldExamples: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              domain: { type: Type.STRING },
              structure: { type: Type.STRING },
              explanation: { type: Type.STRING },
              timestampSeconds: { type: Type.INTEGER },
              timestampLabel: { type: Type.STRING },
            },
            required: [
              'domain',
              'structure',
              'explanation',
              'timestampSeconds',
              'timestampLabel',
            ],
          },
        },
        keyRulesOrSteps: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              detail: { type: Type.STRING },
              category: { type: Type.STRING },
              codeSnippet: { type: Type.STRING },
              timestampLabel: { type: Type.STRING },
              timestampSeconds: { type: Type.INTEGER },
            },
            required: ['title', 'detail'],
          },
        },
        commonMistakes: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              mistake: { type: Type.STRING },
              correction: { type: Type.STRING },
              timestampLabel: { type: Type.STRING },
              timestampSeconds: { type: Type.INTEGER },
            },
            required: ['mistake', 'correction'],
          },
        },
        quickRevisionPoints: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
      },
      required: ['definitions', 'complexityRows', 'realWorldExamples'],
    },
    transcript: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          nodeId: { type: Type.STRING },
          title: { type: Type.STRING },
          topicTag: { type: Type.STRING },
          startLabel: { type: Type.STRING },
          startSeconds: { type: Type.INTEGER },
          endLabel: { type: Type.STRING },
          endSeconds: { type: Type.INTEGER },
          keyTakeaway: { type: Type.STRING },
          accent: { type: Type.STRING },
          lines: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                timestampLabel: { type: Type.STRING },
                timestampSeconds: { type: Type.INTEGER },
                text: { type: Type.STRING },
              },
              required: ['id', 'timestampLabel', 'timestampSeconds', 'text'],
            },
          },
        },
        required: [
          'id',
          'nodeId',
          'title',
          'topicTag',
          'startLabel',
          'startSeconds',
          'accent',
          'lines',
        ],
      },
    },
  },
  required: [
    'title',
    'channel',
    'durationLabel',
    'videoCategory',
    'tldw',
    'nodes',
    'cheatSheet',
    'transcript',
  ],
};

const VALID_ACCENTS = new Set(['violet', 'cyan', 'emerald', 'indigo']);
const VALID_ICONS = new Set(['cpu', 'book', 'layers', 'git-branch', 'globe']);
const VALID_RATINGS = new Set(['optimal', 'balanced', 'caution']);
const ACCENT_CYCLE = ['violet', 'cyan', 'emerald', 'indigo'] as const;
const ICON_CYCLE = ['book', 'layers', 'git-branch', 'globe'] as const;

const VALID_RULE_CATEGORIES = new Set(['rule', 'process', 'formula', 'code', 'distinction']);

function sanitizeWorkspace(
  raw: Record<string, unknown>,
  meta: {
    videoId: string;
    youtubeUrl: string;
    sourceType?: 'youtube' | 'manual-transcript';
    language: LanguageCode;
    oembed: OEmbedInfo;
    videoDurationSeconds?: number;
    coverageMode?: CoverageMode;
    officialChapters?: VideoChapterMarker[];
  }
): LectureWorkspace {
  const maxDur =
    typeof meta.videoDurationSeconds === 'number' &&
    Number.isFinite(meta.videoDurationSeconds) &&
    meta.videoDurationSeconds > 0
      ? Math.floor(meta.videoDurationSeconds)
      : undefined;

  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const getNodePosition = (idx: number) => {
    if (idx === 0) return { x: 460, y: 280 };
    const row = Math.floor((idx - 1) / 2);
    const isLeft = (idx - 1) % 2 === 0;
    return { x: isLeft ? 162 : 758, y: 120 + row * 160 };
  };

  // Support 1 Root + up to 12 Main Module Nodes (13 total) & up to 6 Sub-Nodes each
  const nodes = rawNodes.slice(0, 13).map((item: Record<string, unknown>, idx: number) => {
    const isRoot = idx === 0 || Boolean(item.isRoot);
    const id =
      typeof item.id === 'string' && item.id.trim()
        ? item.id.trim()
        : idx === 0
          ? 'root'
          : `node-${idx}`;
    const accent = (
      isRoot
        ? 'root'
        : VALID_ACCENTS.has(String(item.accent))
          ? String(item.accent)
          : ACCENT_CYCLE[(idx - 1) % ACCENT_CYCLE.length]
    ) as LectureWorkspace['nodes'][number]['accent'];
    const icon = (
      isRoot
        ? 'cpu'
        : VALID_ICONS.has(String(item.icon))
          ? String(item.icon)
          : ICON_CYCLE[(idx - 1) % ICON_CYCLE.length]
    ) as LectureWorkspace['nodes'][number]['icon'];

    const nodeTs = normalizeTimestampPair(
      item.timestampSeconds,
      item.timestampLabel,
      maxDur
    );

    const subNodesRaw = !isRoot && Array.isArray(item.subNodes) ? item.subNodes : [];
    const subNodes = subNodesRaw.slice(0, 6).map((sub: Record<string, unknown>, sIdx: number) => {
      const subTs = normalizeTimestampPair(
        sub.timestampSeconds ?? nodeTs.seconds,
        sub.timestampLabel ?? nodeTs.label,
        maxDur
      );
      const subAccent = (
        VALID_ACCENTS.has(String(sub.accent))
          ? String(sub.accent)
          : accent === 'root'
            ? 'cyan'
            : accent
      ) as Exclude<LectureWorkspace['nodes'][number]['accent'], 'root'>;
      const subIcon = (
        VALID_ICONS.has(String(sub.icon)) ? String(sub.icon) : icon
      ) as LectureWorkspace['nodes'][number]['icon'];
      const rawSubPoints = Array.isArray(sub.keyPoints)
        ? sub.keyPoints
            .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === 'object')
            .map((p) => ({
              keyword: String(p.keyword ?? '').trim(),
              detail: String(p.detail ?? '').trim(),
            }))
            .filter((p) => p.keyword || p.detail)
        : [];

      return {
        id:
          typeof sub.id === 'string' && sub.id.trim()
            ? sub.id.trim()
            : `${id}-sub-${sIdx + 1}`,
        parentId: id,
        title: String(sub.title ?? `Subtopic ${sIdx + 1}`).trim(),
        shortSubtitle: String(sub.shortSubtitle ?? '').trim(),
        timestampLabel: subTs.label,
        timestampSeconds: subTs.seconds,
        accent: subAccent,
        icon: subIcon,
        keyPoints:
          rawSubPoints.length > 0
            ? rawSubPoints
            : [{ keyword: 'Key Idea', detail: String(sub.shortSubtitle ?? '').trim() }],
        realLifeExample: String(sub.realLifeExample ?? '').trim(),
        simplifiedAnalogy: String(sub.simplifiedAnalogy ?? '').trim(),
      };
    });

    const rawNodePoints = Array.isArray(item.keyPoints)
      ? item.keyPoints
          .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === 'object')
          .map((p) => ({
            keyword: String(p.keyword ?? '').trim(),
            detail: String(p.detail ?? '').trim(),
          }))
          .filter((p) => p.keyword || p.detail)
      : [];

    return {
      id,
      title: String(item.title ?? `Topic ${idx + 1}`).trim(),
      shortSubtitle: String(item.shortSubtitle ?? '').trim(),
      timestampLabel: nodeTs.label,
      timestampSeconds: nodeTs.seconds,
      isRoot,
      accent,
      icon,
      position: getNodePosition(idx),
      keyPoints: rawNodePoints,
      realLifeExample:
        typeof item.realLifeExample === 'string' && item.realLifeExample.trim()
          ? item.realLifeExample.trim()
          : undefined,
      simplifiedAnalogy: String(item.simplifiedAnalogy ?? '').trim(),
      ...(subNodes.length > 0 ? { subNodes } : {}),
    };
  });

  const cs = (raw.cheatSheet ?? {}) as Record<string, unknown>;
  const rawDefs = Array.isArray(cs.definitions) ? cs.definitions : [];
  const rawRows = Array.isArray(cs.complexityRows) ? cs.complexityRows : [];
  const rawExamples = Array.isArray(cs.realWorldExamples) ? cs.realWorldExamples : [];
  const rawRules = Array.isArray(cs.keyRulesOrSteps) ? cs.keyRulesOrSteps : [];
  const rawMistakes = Array.isArray(cs.commonMistakes) ? cs.commonMistakes : [];
  const rawRevisionPoints = Array.isArray(cs.quickRevisionPoints) ? cs.quickRevisionPoints : [];

  const comparisonColumns =
    Array.isArray(cs.comparisonColumns) && cs.comparisonColumns.length === 6
      ? (cs.comparisonColumns.map(String) as [string, string, string, string, string, string])
      : undefined;

  const rawTranscript = Array.isArray(raw.transcript) ? raw.transcript : [];
  const sanitizedSections = rawTranscript
    .slice(0, 36)
    .map((sec: Record<string, unknown>, idx: number) => {
      const startTs = normalizeTimestampPair(sec.startSeconds, sec.startLabel, maxDur);
      const explicitEndSec =
        sec.endSeconds !== undefined || sec.endLabel !== undefined
          ? normalizeTimestampPair(sec.endSeconds, sec.endLabel, maxDur)
          : null;

      const rawLines = Array.isArray(sec.lines) ? sec.lines : [];
      const lines = rawLines
        .map((line: Record<string, unknown>, lIdx: number) => {
          const lineTs = normalizeTimestampPair(
            line.timestampSeconds ?? startTs.seconds,
            line.timestampLabel ?? startTs.label,
            maxDur
          );
          return {
            id:
              typeof line.id === 'string' && line.id.trim()
                ? line.id.trim()
                : `sec-${idx + 1}-line-${lIdx + 1}`,
            timestampLabel: lineTs.label,
            timestampSeconds: lineTs.seconds,
            text: String(line.text ?? '').trim(),
          };
        })
        .filter((l) => l.text.length > 0);

      const accent = (
        sec.accent === 'root'
          ? 'root'
          : VALID_ACCENTS.has(String(sec.accent))
            ? String(sec.accent)
            : ACCENT_CYCLE[idx % ACCENT_CYCLE.length]
      ) as LectureWorkspace['transcript'][number]['accent'];

      return {
        id:
          typeof sec.id === 'string' && sec.id.trim()
            ? sec.id.trim()
            : `chapter-${idx + 1}`,
        nodeId:
          typeof sec.nodeId === 'string' && sec.nodeId.trim()
            ? sec.nodeId.trim()
            : nodes[Math.min(idx + 1, nodes.length - 1)]?.id ?? 'root',
        title: String(sec.title ?? `Chapter ${idx + 1}`).trim(),
        topicTag: String(sec.topicTag ?? `Module ${idx + 1}`).trim(),
        startLabel: startTs.label,
        startSeconds: startTs.seconds,
        endSeconds:
          explicitEndSec && explicitEndSec.seconds > startTs.seconds
            ? explicitEndSec.seconds
            : undefined,
        endLabel:
          explicitEndSec && explicitEndSec.seconds > startTs.seconds
            ? explicitEndSec.label
            : undefined,
        keyTakeaway:
          typeof sec.keyTakeaway === 'string' && sec.keyTakeaway.trim()
            ? sec.keyTakeaway.trim()
            : undefined,
        accent,
        lines,
      };
    })
    .sort((a, b) => a.startSeconds - b.startSeconds);

  // Fill in clean endSeconds / endLabel spans from next chapter or total video duration
  for (let i = 0; i < sanitizedSections.length; i++) {
    const current = sanitizedSections[i];
    if (current.endSeconds === undefined) {
      const next = sanitizedSections[i + 1];
      const lastLineSec =
        current.lines.length > 0
          ? current.lines[current.lines.length - 1].timestampSeconds
          : current.startSeconds;
      const derivedEnd = next
        ? Math.max(current.startSeconds, next.startSeconds)
        : maxDur
          ? Math.max(lastLineSec, maxDur)
          : lastLineSec;
      if (derivedEnd > current.startSeconds) {
        current.endSeconds = derivedEnd;
        current.endLabel = formatSecondsToTimestamp(derivedEnd);
      }
    }
  }

  // Derive final durationSeconds from known metadata or highest valid timestamp
  const highestTimestamp = Math.max(
    maxDur ?? 0,
    ...nodes.map((n) => n.timestampSeconds),
    ...sanitizedSections.map((s) => s.endSeconds ?? s.startSeconds),
    parseTimestampToSeconds(String(raw.durationLabel ?? ''))
  );
  const resolvedDurationSeconds = highestTimestamp > 0 ? highestTimestamp : undefined;
  const resolvedDurationLabel = resolvedDurationSeconds
    ? formatSecondsToTimestamp(resolvedDurationSeconds)
    : String(raw.durationLabel || 'Video');

  const resolvedSourceType: 'youtube' | 'manual-transcript' =
    meta.sourceType ?? (isValidYouTubeId(meta.videoId) ? 'youtube' : 'manual-transcript');

  const keyRulesOrSteps = rawRules
    .slice(0, 10)
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object')
    .map((r) => {
      const hasTs = r.timestampSeconds !== undefined || r.timestampLabel !== undefined;
      const ts = hasTs
        ? normalizeTimestampPair(r.timestampSeconds, r.timestampLabel, maxDur)
        : null;
      const rawCat = String(r.category ?? '').trim().toLowerCase();
      return {
        title: String(r.title ?? '').trim(),
        detail: String(r.detail ?? '').trim(),
        category: VALID_RULE_CATEGORIES.has(rawCat)
          ? (rawCat as 'rule' | 'process' | 'formula' | 'code' | 'distinction')
          : undefined,
        ...(typeof r.codeSnippet === 'string' && r.codeSnippet.trim()
          ? { codeSnippet: r.codeSnippet.trim() }
          : {}),
        ...(ts ? { timestampLabel: ts.label, timestampSeconds: ts.seconds } : {}),
      };
    })
    .filter((r) => r.title && r.detail);

  const commonMistakes = rawMistakes
    .slice(0, 8)
    .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === 'object')
    .map((m) => {
      const hasTs = m.timestampSeconds !== undefined || m.timestampLabel !== undefined;
      const ts = hasTs
        ? normalizeTimestampPair(m.timestampSeconds, m.timestampLabel, maxDur)
        : null;
      return {
        mistake: String(m.mistake ?? '').trim(),
        correction: String(m.correction ?? '').trim(),
        ...(ts ? { timestampLabel: ts.label, timestampSeconds: ts.seconds } : {}),
      };
    })
    .filter((m) => m.mistake && m.correction);

  const quickRevisionPoints = rawRevisionPoints
    .slice(0, 10)
    .map((p) => String(p ?? '').trim())
    .filter((p) => p.length > 3);

  const assembled: LectureWorkspace = {
    id: `analyzed-${meta.videoId}-${meta.language}`,
    title: String(
      raw.title ||
        meta.oembed.title ||
        (resolvedSourceType === 'manual-transcript'
          ? 'Manual Transcript Notes'
          : 'YouTube Video Breakdown')
    ),
    channel: String(
      raw.channel ||
        meta.oembed.authorName ||
        (resolvedSourceType === 'manual-transcript' ? 'Manual Transcript' : 'YouTube Creator')
    ),
    youtubeUrl: resolvedSourceType === 'youtube' ? meta.youtubeUrl : '',
    videoId: meta.videoId,
    sourceType: resolvedSourceType,
    durationLabel: resolvedDurationLabel,
    ...(resolvedDurationSeconds ? { videoDurationSeconds: resolvedDurationSeconds } : {}),
    ...(meta.coverageMode ? { coverageMode: meta.coverageMode } : {}),
    videoCategory: String(raw.videoCategory || 'Explainer'),
    language: meta.language,
    tldw: Array.isArray(raw.tldw) ? raw.tldw.slice(0, 6).map(String) : [],
    nodes,
    cheatSheet: {
      definitionsTitle:
        typeof cs.definitionsTitle === 'string' && cs.definitionsTitle.trim()
          ? cs.definitionsTitle.trim()
          : '01. Core Modules & Key Concepts',
      comparisonTableTitle:
        typeof cs.comparisonTableTitle === 'string' && cs.comparisonTableTitle.trim()
          ? cs.comparisonTableTitle.trim()
          : '02. Structured Comparison Matrix',
      comparisonColumns,
      examplesTitle:
        typeof cs.examplesTitle === 'string' && cs.examplesTitle.trim()
          ? cs.examplesTitle.trim()
          : '03. Real-World Examples & Applications',
      definitions: rawDefs.slice(0, 18).map((d: Record<string, unknown>, i: number) => {
        const hasTs = d.timestampSeconds !== undefined || d.timestampLabel !== undefined;
        const ts = hasTs
          ? normalizeTimestampPair(d.timestampSeconds, d.timestampLabel, maxDur)
          : null;
        return {
          term: String(d.term ?? `Point ${i + 1}`).trim(),
          summary: String(d.summary ?? '').trim(),
          formulaOrNote: String(d.formulaOrNote ?? '').trim(),
          accent: (VALID_ACCENTS.has(String(d.accent))
            ? String(d.accent)
            : ACCENT_CYCLE[i % ACCENT_CYCLE.length]) as Exclude<
            LectureWorkspace['nodes'][number]['accent'],
            'root'
          >,
          ...(ts ? { timestampLabel: ts.label, timestampSeconds: ts.seconds } : {}),
          ...(typeof d.moduleLabel === 'string' && d.moduleLabel.trim()
            ? { moduleLabel: d.moduleLabel.trim() }
            : {}),
          ...(typeof d.category === 'string' && d.category.trim()
            ? { category: d.category.trim().slice(0, 32) }
            : {}),
        };
      }),
      complexityRows: rawRows.slice(0, 14).map((r: Record<string, unknown>) => ({
        structureOrAlgo: String(r.structureOrAlgo ?? '').trim(),
        access: String(r.access ?? '—').trim(),
        search: String(r.search ?? '—').trim(),
        insert: String(r.insert ?? '—').trim(),
        space: String(r.space ?? '—').trim(),
        rating: (VALID_RATINGS.has(String(r.rating))
          ? String(r.rating)
          : 'balanced') as 'optimal' | 'balanced' | 'caution',
        ratingLabel: String(r.ratingLabel ?? 'Notable').trim(),
      })).filter((r) => r.structureOrAlgo.length > 0),
      realWorldExamples: rawExamples.slice(0, 12).map((ex: Record<string, unknown>) => {
        const ts = normalizeTimestampPair(
          ex.timestampSeconds,
          ex.timestampLabel,
          maxDur
        );
        return {
          domain: String(ex.domain ?? '').trim(),
          structure: String(ex.structure ?? '').trim(),
          explanation: String(ex.explanation ?? '').trim(),
          timestampSeconds: ts.seconds,
          timestampLabel: ts.label,
        };
      }).filter((ex) => ex.domain && ex.explanation),
      ...(keyRulesOrSteps.length > 0 ? { keyRulesOrSteps } : {}),
      ...(commonMistakes.length > 0 ? { commonMistakes } : {}),
      ...(quickRevisionPoints.length > 0 ? { quickRevisionPoints } : {}),
    },
    transcript: sanitizedSections,
  };

  const normalized = normalizeAndDeduplicateWorkspace(assembled);
  return ensureFullTimelineCoverage(normalized, {
    officialChapters: meta.officialChapters,
    expectedDurationSeconds: resolvedDurationSeconds,
  });
}

interface RawGroundingChunk {
  web?: {
    uri?: string;
    title?: string;
  };
}

function extractGroundingSources(
  chunks: RawGroundingChunk[] | undefined
): Array<{ title: string; uri: string }> {
  if (!Array.isArray(chunks)) return [];
  const seen = new Set<string>();
  const sources: Array<{ title: string; uri: string }> = [];

  for (const chunk of chunks) {
    const uri = chunk?.web?.uri?.trim();
    if (!uri || seen.has(uri) || !isSafeHttpUrl(uri)) continue;
    try {
      const parsed = new URL(uri);
      seen.add(uri);
      sources.push({
        title: chunk.web?.title?.trim() || parsed.hostname,
        uri,
      });
    } catch {
      // Skip malformed URLs cleanly
    }
  }
  return sources.slice(0, 6);
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', resolveTrustProxySetting(process.env));

  // Fair-use limits for the shared server key (no login). Visitors who add their own free
  // Gemini key (x-user-gemini-key) are never counted against these limits.
  const usagePolicy = {
    analysisLimit: Math.min(
      50,
      Math.max(1, Number.parseInt(process.env.MINDFLOW_DAILY_ANALYSIS_LIMIT ?? '5', 10) || 5)
    ),
    aiActionLimit: Math.min(
      500,
      Math.max(1, Number.parseInt(process.env.MINDFLOW_DAILY_AI_ACTION_LIMIT ?? '40', 10) || 40)
    ),
    globalDailyLimit: Math.min(
      100_000,
      Math.max(1, Number.parseInt(process.env.MINDFLOW_AI_DAILY_GLOBAL_LIMIT ?? '150', 10) || 150)
    ),
  };

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  // Origin protection for state-changing /api/* requests (protects shared backend Gemini key against cross-site abuse)
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }
    if (
      !isAllowedApiOrigin(req.headers.origin, req.headers.host, process.env.ALLOWED_ORIGINS, {
        forwardedHost: req.headers['x-forwarded-host'],
        secFetchSite: req.headers['sec-fetch-site'],
        appUrl: process.env.APP_URL,
      })
    ) {
      res.status(403).json({
        error: 'Cross-origin API requests are not permitted from this origin.',
        code: 'ORIGIN_NOT_ALLOWED',
        retryable: false,
      });
      return;
    }
    const requiredToken = process.env.MINDFLOW_API_ACCESS_TOKEN?.trim();
    if (requiredToken) {
      const headerToken =
        req.headers['x-mindflow-token'] ?? req.headers['x-mindflow-access-token'];
      const rawProvided =
        typeof headerToken === 'string'
          ? headerToken.trim()
          : typeof req.headers.authorization === 'string' &&
              req.headers.authorization.startsWith('Bearer ')
            ? req.headers.authorization.slice(7).trim()
            : '';
      const a = Buffer.from(rawProvided, 'utf8');
      const b = Buffer.from(requiredToken, 'utf8');
      if (!(a.length === b.length && timingSafeEqual(a, b))) {
        res.status(401).json({
          error: 'A valid access token is required.',
          code: 'ACCESS_TOKEN_REQUIRED',
          retryable: false,
        });
        return;
      }
    }
    next();
  });

  // Per-endpoint rate limiters + sustained hourly AI budget to protect shared backend Gemini quotas
  const hourlyAiBudgetLimiter = new SlidingWindowRateLimiter({
    windowMs: 60 * 60_000,
    maxRequests: Math.max(20, Number(process.env.AI_HOURLY_IP_LIMIT ?? 120) || 120),
  });
  const rateLimiters = {
    analyze: new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 10 }),
    translate: new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 15 }),
    simplify: new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 35 }),
    grounding: new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 25 }),
    visualGuide: new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 8 }),
    chat: new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 30 }),
    imageProxy: new SlidingWindowRateLimiter({ windowMs: 60_000, maxRequests: 120 }),
  };

  // Global + per-client concurrency guard for expensive AI operations
  const aiConcurrency = new ConcurrencyLimiter({ maxGlobal: 10, maxPerClient: 3 });

  // Bounded TTL caches + in-flight deduplicator to avoid redundant Gemini token spend
  const analyzeCache = new TtlLruCache<Record<string, unknown>>({
    maxEntries: 60,
    ttlMs: 60 * 60_000,
  });
  const translateCache = new TtlLruCache<Record<string, unknown>>({
    maxEntries: 80,
    ttlMs: 60 * 60_000,
  });
  const simplifyCache = new TtlLruCache<Record<string, unknown>>({
    maxEntries: 160,
    ttlMs: 60 * 60_000,
  });
  const groundingCache = new TtlLruCache<Record<string, unknown>>({
    maxEntries: 160,
    ttlMs: 60 * 60_000,
  });
  const visualGuideCache = new TtlLruCache<Record<string, unknown>>({
    maxEntries: 40,
    ttlMs: 60 * 60_000,
  });
  const chatCache = new TtlLruCache<Record<string, unknown>>({
    maxEntries: 160,
    ttlMs: 15 * 60_000,
  });
  const inFlight = new InFlightDeduplicator();

  const getClientKey = (req: express.Request): string => {
    return req.ip || req.socket.remoteAddress || 'unknown';
  };

  const withRateLimit = (
    limiter: SlidingWindowRateLimiter,
    endpointName: string,
    enforceHourlyAiBudget = true
  ): express.RequestHandler => {
    return (req, res, next) => {
      const clientKey = getClientKey(req);
      const decision = limiter.check(`${endpointName}:${clientKey}`);
      res.setHeader('X-RateLimit-Limit', String(decision.limit));
      res.setHeader('X-RateLimit-Remaining', String(decision.remaining));
      if (!decision.allowed) {
        res.setHeader('Retry-After', String(decision.resetAfterSeconds));
        res.status(429).json({
          error: `Too many requests right now. Please wait ${decision.resetAfterSeconds}s and try again.`,
          code: 'RATE_LIMITED',
          retryable: true,
          retryAfterSeconds: decision.resetAfterSeconds,
        });
        return;
      }
      if (enforceHourlyAiBudget) {
        const hourlyDecision = hourlyAiBudgetLimiter.check(`ai-hourly:${clientKey}`);
        if (!hourlyDecision.allowed) {
          res.setHeader('Retry-After', String(hourlyDecision.resetAfterSeconds));
          res.status(429).json({
            error: 'Hourly AI usage budget reached for this connection. Please try again later.',
            code: 'AI_HOURLY_BUDGET_EXCEEDED',
            retryable: true,
            retryAfterSeconds: hourlyDecision.resetAfterSeconds,
          });
          return;
        }
      }
      next();
    };
  };

  /** Binds the visitor's own Gemini key (if any) to this request. Must run AFTER express.json(). */
  const bindUserKey: express.RequestHandler = (req, _res, next) => {
    const raw = req.headers['x-user-gemini-key'];
    const key = typeof raw === 'string' ? raw.trim() : '';
    if (key && /^[A-Za-z0-9_.-]{20,160}$/.test(key)) {
      requestKeyStorage.run(key, () => next());
      return;
    }
    next();
  };

  // In-memory daily counters (reset at UTC midnight or server restart). No accounts, no cookies.
  const usageDay = { key: '', global: 0, perClient: new Map<string, { analyses: number; ai: number }>() };
  const rollUsageDay = () => {
    const today = new Date().toISOString().slice(0, 10);
    if (usageDay.key !== today) {
      usageDay.key = today;
      usageDay.global = 0;
      usageDay.perClient.clear();
    }
  };
  const attachCurrentUsageHeaders = async (
    _req: express.Request,
    _res: express.Response
  ): Promise<void> => {
    // Cached results are free; nothing to attach.
  };

  const enforceAiUsage = async (
    req: express.Request,
    res: express.Response,
    kind: 'analysis' | 'ai'
  ): Promise<boolean> => {
    if (requestKeyStorage.getStore()) return true; // visitor's own key: not counted
    rollUsageDay();
    const clientKey = getClientKey(req);
    const entry = usageDay.perClient.get(clientKey) ?? { analyses: 0, ai: 0 };
    let reason: 'analysis_limit' | 'user_daily_limit' | 'global_daily_limit' | null = null;
    if (usageDay.global >= usagePolicy.globalDailyLimit) reason = 'global_daily_limit';
    else if (kind === 'analysis' && entry.analyses >= usagePolicy.analysisLimit) reason = 'analysis_limit';
    else if (entry.ai >= usagePolicy.aiActionLimit) reason = 'user_daily_limit';

    if (reason) {
      const nextMidnight = new Date();
      nextMidnight.setUTCHours(24, 0, 0, 0);
      const retryAfterSeconds = Math.max(1, Math.ceil((nextMidnight.getTime() - Date.now()) / 1000));
      const messages = {
        analysis_limit: `Free video-analysis limit reached (${usagePolicy.analysisLimit}/day). Add your own free Gemini API key for unlimited use, or try again after the daily reset.`,
        user_daily_limit: `Free AI limit reached (${usagePolicy.aiActionLimit} requests/day). Add your own free Gemini API key to keep going, or try again after the daily reset.`,
        global_daily_limit:
          'The shared free budget for today is used up. Add your own free Gemini API key to continue, or try again after the daily reset.',
      };
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        error: messages[reason],
        code: reason === 'global_daily_limit' ? 'GLOBAL_DAILY_LIMIT' : reason === 'analysis_limit' ? 'ANALYSIS_DAILY_LIMIT' : 'USER_DAILY_LIMIT',
        retryAfterSeconds,
        retryable: false,
        canUseOwnKey: true,
      });
      return false;
    }
    entry.ai += 1;
    if (kind === 'analysis') entry.analyses += 1;
    usageDay.perClient.set(clientKey, entry);
    usageDay.global += 1;
    return true;
  };

  const refundAiUsage = async (
    req: express.Request,
    _res: express.Response,
    kind: 'analysis' | 'ai'
  ): Promise<void> => {
    if (requestKeyStorage.getStore()) return;
    rollUsageDay();
    const entry = usageDay.perClient.get(getClientKey(req));
    if (entry) {
      entry.ai = Math.max(0, entry.ai - 1);
      if (kind === 'analysis') entry.analyses = Math.max(0, entry.analyses - 1);
    }
    usageDay.global = Math.max(0, usageDay.global - 1);
  };

  const acquireAiSlot = (
    req: express.Request,
    res: express.Response
  ): (() => void) | null => {
    const slot = aiConcurrency.acquire(getClientKey(req));
    if (!slot.acquired) {
      const retryAfterSeconds = slot.reason === 'client_limit' ? 5 : 10;
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(slot.reason === 'client_limit' ? 429 : 503).json({
        error:
          slot.reason === 'client_limit'
            ? 'You already have multiple AI tasks running. Please wait a moment for one to finish.'
            : 'The server is handling several AI requests right now. Please retry in a few seconds.',
        code: slot.reason === 'client_limit' ? 'CONCURRENCY_LIMIT' : 'SERVER_BUSY',
        retryable: true,
        retryAfterSeconds,
      });
      return null;
    }
    return slot.release;
  };

  /**
   * Lightweight health check (never exposes secrets).
   * Explicitly distinguishes API key configuration from live provider quota availability.
   */
  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const aiConfigured = Boolean(createGeminiClient());
    res.json({
      status: 'ok',
      aiConfigured,
      quotaVerified: false,
      models: [...FREE_TIER_MODELS],
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * PHASE 2: Resilient 3-layer universal YouTube video analyzer using free-tier Gemini models.
   * Layer 1: Public oEmbed metadata (safe timeout)
   * Layer 2: Server-side caption extraction (or user-provided manualTranscript)
   * Layer 3: Structured JSON (transcript OR direct YouTube multimodal fileData)
   */
  app.post(
    '/api/analyze',
    withRateLimit(rateLimiters.analyze, 'analyze'),
    express.json({ limit: '2mb' }),
    bindUserKey,
    async (req, res) => {
      const {
        videoId,
        youtubeUrl,
        language = 'en',
        manualTranscript,
      } = (req.body ?? {}) as {
        videoId?: string;
        youtubeUrl?: string;
        language?: LanguageCode;
        manualTranscript?: string;
      };

      const rawVideoId = typeof videoId === 'string' ? videoId.trim() : '';
      const safeVideoId = isValidYouTubeId(rawVideoId) ? rawVideoId : '';
      const boundedManualTranscript = sanitizeUserText(manualTranscript, 250_000);
      const safeLang: LanguageCode =
        language === 'hi' || language === 'hinglish' ? language : 'en';

      if (
        typeof youtubeUrl === 'string' &&
        youtubeUrl.trim().length > 0 &&
        !isAllowedYouTubeUserUrl(youtubeUrl, safeVideoId || undefined)
      ) {
        res.status(400).json({
          error:
            'Only valid YouTube links (youtube.com, youtu.be, Shorts, or Live) are supported.',
          code: 'INVALID_YOUTUBE_URL',
          retryable: false,
          canPasteTranscript: true,
        });
        return;
      }

      if (!safeVideoId && !boundedManualTranscript) {
        res.status(400).json({
          error: rawVideoId
            ? 'Invalid YouTube video ID. Please paste a valid YouTube link or 11-character ID.'
            : 'Please provide a valid YouTube URL or paste a transcript.',
          code: 'INVALID_INPUT',
          retryable: false,
          canPasteTranscript: true,
        });
        return;
      }

      const ai = createGeminiClient();
      if (!ai) {
        res.status(503).json({
          error:
            'No Gemini key is configured on the server. Tap the key icon and add your own free Gemini API key (aistudio.google.com/apikey) to analyze any YouTube video.',
          code: 'AI_NOT_CONFIGURED',
          retryable: false,
          canPasteTranscript: true,
        });
        return;
      }

      const normalizedUrl = safeVideoId ? `https://www.youtube.com/watch?v=${safeVideoId}` : '';
      const cacheKey = `analyze:${safeVideoId || 'manual'}:${safeLang}:${
        boundedManualTranscript ? hashCacheKey(boundedManualTranscript) : 'yt'
      }`;
      const cached = analyzeCache.get(cacheKey);
      if (cached) {
        await attachCurrentUsageHeaders(req, res);
        res.setHeader('X-MindFlow-Cache', 'HIT');
        res.json(cached);
        return;
      }

      if (!(await enforceAiUsage(req, res, 'analysis'))) return;

      const releaseSlot = acquireAiSlot(req, res);
      if (!releaseSlot) {
        await refundAiUsage(req, res, 'analysis');
        return;
      }

      const { controller: clientAbort, cleanup: cleanupAbort } =
        createClientAbortController(res);

      try {
        const result = await inFlight.run(
          cacheKey,
          async (sharedSignal) => {
            const hasManualTranscript = Boolean(boundedManualTranscript);

            // Layer 1 & Layer 2 in parallel when analyzing by URL
            const [oembed, ytBundle] = await Promise.all([
              safeVideoId
                ? fetchYouTubeOEmbed(safeVideoId, sharedSignal)
                : Promise.resolve<OEmbedInfo>({}),
              safeVideoId
                ? fetchYouTubeBundle(safeVideoId, sharedSignal)
                : Promise.resolve<YouTubeExtractedBundle>({ captionSegments: [], chapters: [] }),
            ]);

          // Detect unavailable / private / deleted YouTube videos before spending AI quota
          if (safeVideoId && !hasManualTranscript) {
            const badPlayability =
              ytBundle.playabilityStatus &&
              ['ERROR', 'LOGIN_REQUIRED', 'UNPLAYABLE', 'LIVE_STREAM_OFFLINE'].includes(
                ytBundle.playabilityStatus
              );
            if (
              badPlayability &&
              !oembed.title &&
              !ytBundle.title &&
              ytBundle.captionSegments.length === 0
            ) {
              const unavailableErr = new Error('YOUTUBE_VIDEO_UNAVAILABLE');
              (unavailableErr as Error & { userReason?: string }).userReason =
                ytBundle.playabilityReason ||
                'This YouTube video appears to be private, deleted, or unavailable.';
              throw unavailableErr;
            }
            if (
              oembed.unavailable &&
              !ytBundle.title &&
              ytBundle.captionSegments.length === 0 &&
              ytBundle.chapters.length === 0
            ) {
              const unavailableErr = new Error('YOUTUBE_VIDEO_UNAVAILABLE');
              (unavailableErr as Error & { userReason?: string }).userReason =
                oembed.httpStatus === 401 || oembed.httpStatus === 403
                  ? 'This YouTube video is private or embedding is restricted. Paste its transcript below to analyze it.'
                  : 'This YouTube video could not be found. Check the link or paste its transcript manually.';
              throw unavailableErr;
            }
          }

          const mergedOembed: OEmbedInfo = {
            title: oembed.title || ytBundle.title,
            authorName: oembed.authorName || ytBundle.authorName,
          };

          // Prepare full-timeline transcript payload (never blindly truncate early!)
          let preparedTranscript: string | null = null;
          let coverageMode: CoverageMode = 'chapters-metadata';
          let totalDurationSeconds = ytBundle.lengthSeconds ?? 0;

      if (hasManualTranscript) {
        const rawManual = boundedManualTranscript;
        // Parse timestamped lines from manual transcript if present so stratified compression works on massive pastes too
        const manualLines = rawManual.split(/\r?\n/);
        const parsedManualSegments: TranscriptCaptionSegment[] = [];
        let lastSeenSec = 0;
        for (const line of manualLines) {
          const tsMatch = line.match(/^\s*[\[\(]?(\d{1,2}:\d{2}(?::\d{2})?)[\]\)]?\s*(.*)$/);
          if (tsMatch) {
            const sec = parseTimestampToSeconds(tsMatch[1]);
            lastSeenSec = Math.max(lastSeenSec, sec);
            const text = tsMatch[2].trim();
            if (text) parsedManualSegments.push({ startSeconds: sec, text });
          } else if (line.trim()) {
            parsedManualSegments.push({ startSeconds: lastSeenSec, text: line.trim() });
          }
        }
        if (parsedManualSegments.length >= 10 && lastSeenSec > 0) {
          const stratified = compressTranscriptStratified(
            parsedManualSegments,
            Math.max(totalDurationSeconds, lastSeenSec),
            ytBundle.chapters,
            120000
          );
          preparedTranscript = stratified.text;
          coverageMode = stratified.coverageMode;
          totalDurationSeconds = Math.max(
            totalDurationSeconds,
            stratified.effectiveDurationSeconds
          );
        } else {
          const stratifiedPlain = compressPlainTextStratified(rawManual, 120000);
          preparedTranscript = stratifiedPlain.text;
          coverageMode = stratifiedPlain.coverageMode;
        }
      } else if (ytBundle.captionSegments.length > 0) {
        const stratified = compressTranscriptStratified(
          ytBundle.captionSegments,
          ytBundle.lengthSeconds,
          ytBundle.chapters,
          120000
        );
        preparedTranscript = stratified.text;
        coverageMode = stratified.coverageMode;
        totalDurationSeconds = Math.max(
          totalDurationSeconds,
          stratified.effectiveDurationSeconds
        );
      } else if (ytBundle.chapters.length > 0) {
        const maxChapterSec = ytBundle.chapters[ytBundle.chapters.length - 1].startSeconds;
        totalDurationSeconds = Math.max(totalDurationSeconds, maxChapterSec);
      }

      const contentDomain = detectContentDomain({
        title: mergedOembed.title,
        description: ytBundle.description,
        keywords: ytBundle.keywords,
        transcriptSample: preparedTranscript ?? undefined,
      });

      const scaleProfile = getAdaptiveScaleProfile({
        durationSeconds: totalDurationSeconds > 0 ? totalDurationSeconds : undefined,
        chapterCount: ytBundle.chapters.length,
        transcriptCharLength: preparedTranscript?.length ?? 0,
        domain: contentDomain,
      });
      const totalDurationFormatted =
        totalDurationSeconds > 0
          ? formatSecondsToTimestamp(totalDurationSeconds)
          : 'Estimate from video content';
      const finalTenPercentSec =
        totalDurationSeconds > 0 ? Math.floor(totalDurationSeconds * 0.88) : 0;
      const finalTenPercentLabel =
        finalTenPercentSec > 0 ? formatSecondsToTimestamp(finalTenPercentSec) : '';

      const sampledChapters = sampleItemsEvenly(ytBundle.chapters, 55);
      const chaptersBlock =
        sampledChapters.length > 0
          ? `\nOFFICIAL YOUTUBE CHAPTERS / TIMELINE BACKBONE (${ytBundle.chapters.length} total chapters, ${sampledChapters.length} evenly represented 0%–100%):\n${sampledChapters
              .map((ch) => `- [${ch.timestampLabel}] (${ch.startSeconds}s) ${ch.title}`)
              .join('\n')}`
          : '';

      const promptInstructions = `You are MindFlow AI, an expert educational knowledge architect that transforms YouTube lectures, courses, tutorials, documentaries, and technical talks into high-depth, accurate, student-ready learning workspaces.

${getLanguageInstruction(safeLang)}

VIDEO METADATA:
- Video Title: ${mergedOembed.title ?? 'Detect from video/transcript'}
- Channel: ${mergedOembed.authorName ?? 'Detect from video/transcript'}
- Exact Total Duration: ${totalDurationFormatted}${totalDurationSeconds > 0 ? ` (${totalDurationSeconds} seconds)` : ''}
- Detected Subject Domain: ${contentDomain}
- Duration / Complexity Profile: ${scaleProfile.tierLabel}
- Coverage Source: ${coverageMode}
- URL: ${normalizedUrl}${chaptersBlock}${
        ytBundle.description
          ? `\n- Video Description:\n${ytBundle.description.slice(0, 5000)}`
          : ''
      }${
        ytBundle.keywords?.length
          ? `\n- Keywords: ${ytBundle.keywords.join(', ')}`
          : ''
      }

ACCURACY & ANTI-HALLUCINATION MANDATE:
- Ground EVERY concept, example, formula, code snippet, and timestamp strictly in the provided transcript, chapters, and video content.
- NEVER invent video segments, quotes, formulas, APIs, or timestamps beyond ${totalDurationSeconds > 0 ? `${totalDurationSeconds}s` : 'the actual video runtime'}.
- Prioritize genuine educational clarity and meaningful information coverage over artificial verbosity or filler repetition.

COMPREHENSIVE 0%–100% EDUCATIONAL COVERAGE RULES:
1. FULL-TIMELINE UNDERSTANDING: Cover the ENTIRE video chronologically — introduction, main chapters, core concepts, subtopics, concrete examples, explanations, key terminology, practical applications, and conclusions${finalTenPercentLabel ? ` (ensure final modules & script chapters reach >= ${finalTenPercentLabel})` : ''}. Never concentrate only on the opening minutes.
2. EXACT TIMESTAMP FORMAT: Use MM:SS under 1 hour (e.g., "14:35") and H:MM:SS for >= 1 hour (e.g., "1:45:20"). Always match integer "timestampSeconds" / "startSeconds" / "endSeconds" to the label.
3. Auto-detect "videoCategory" (e.g., "Full Course", "Tutorial", "Computer Science", "Science & STEM", "Tech Review", "Podcast", "Documentary", "Finance", "Explainer").
4. "tldw" (Key Takeaways): Provide ${scaleProfile.tldwMin} to ${scaleProfile.tldwMax} high-signal, non-redundant executive takeaways that together cover: (a) the central thesis/core idea, (b) major lessons & frameworks taught, (c) critical facts/principles, (d) practical applications/insights, and (e) the video's conclusion. Zero filler or near-duplicate bullets.
5. "nodes" (3-Level Hierarchical Mindmap — proportional to topic complexity):
   - Level 1 (Node 0): Central Root node (isRoot: true, id: "root", accent: "root", icon: "cpu", timestampLabel: "00:00", timestampSeconds: 0) with a crisp topic title and 3-4 foundational overview keyPoints.
   - Level 2 (Nodes 1..N): ${scaleProfile.mainNodesMin} to ${scaleProfile.mainNodesMax} distinct Major Modules/Chapters spanning 0% to 100% chronologically. Keep node titles short, clean, and scannable (2–6 words). Cycle accents: "violet", "cyan", "emerald", "indigo". Icons from: "book", "layers", "git-branch", "globe". Zero duplicate branches.
   - Level 3 ("subNodes"): Under EVERY Level-2 module, include ${scaleProfile.subNodesMin} to ${scaleProfile.subNodesMax} distinct, non-redundant subconcepts/supporting details (never just 1 subNode). Each subNode needs an accurate timestampLabel/timestampSeconds, 2–3 substantive keyPoints (keyword + concrete explanation), a realistic realLifeExample, and a clear beginner-friendly simplifiedAnalogy.
6. "cheatSheet" (Complete Subject-Adapted Revision Document):
${getDomainCheatSheetGuidance(contentDomain)}
   - "definitions": ${scaleProfile.cheatSheetCardsMin} to ${scaleProfile.cheatSheetCardsMax} high-value Core Concept / Terminology / Formula Cards spanning early, middle, and late chapters. Include "moduleLabel", "category" (e.g., "Definition", "Formula", "Principle", "Architecture", "Term"), exact "timestampLabel" & "timestampSeconds", a crisp "summary", and a concrete "formulaOrNote" (key rule, syntax, equation, or memory cue).
   - "complexityRows": 5 to 10 comparison / trade-off / reference rows (customize "comparisonColumns" to 6 natural subject-fitting headers; set "rating" to "optimal", "balanced", or "caution" with a descriptive "ratingLabel").
   - "keyRulesOrSteps": 3 to 7 key rules, principles, formulas, step-by-step processes, or concise source-supported code patterns (set "category" to "rule" | "formula" | "process" | "code"; include "codeSnippet" ONLY if the video actually demonstrates code/syntax/commands — never invent code).
   - "commonMistakes": 2 to 5 common mistakes, misconceptions, or important distinctions explicitly highlighted or implied by the lesson ("mistake" vs "correction").
   - "realWorldExamples": 4 to 7 concrete Real-World Examples / Practical Applications from across the video with clickable timestamps.
   - "quickRevisionPoints": 5 to 8 rapid exam/interview revision bullets for 60-second recall.
7. "transcript" (Chronological Study Script & Timeline):
   - Provide ${scaleProfile.scriptChaptersMin} to ${scaleProfile.scriptChaptersMax} chronological chapters evenly spanning 00:00 to ${totalDurationFormatted}.
   - Every chapter MUST have a valid "nodeId" matching one of your Level-2 module IDs, clear heading, "topicTag", exact "startLabel"/"startSeconds"/"endLabel"/"endSeconds", a high-value 1-sentence "keyTakeaway", and 3–4 substantive timestamped lines summarizing concrete explanations, terminology, examples, and takeaways (zero empty or repeated chapters).`;

      let parsed: Record<string, unknown> | null = null;
      let analysisMode: 'transcript' | 'multimodal' | 'search-grounded' = 'transcript';
      let repairSourceContext = '';

      if (preparedTranscript) {
        // Layer 2 Path: Full or stratified 0%..100% transcript analysis
        analysisMode = 'transcript';
        repairSourceContext = preparedTranscript;
        const response = await generateWithFreeTierFallback(
          ai,
          {
            contents: `${promptInstructions}\n\nVIDEO TRANSCRIPT (${coverageMode === 'timeline-sampled' ? 'Stratified 0%–100% Full-Timeline Samples' : 'Full Verbatim Transcript'}):\n${preparedTranscript}`,
            config: {
              responseMimeType: 'application/json',
              responseSchema: WORKSPACE_RESPONSE_SCHEMA,
              maxOutputTokens: scaleProfile.maxOutputTokens,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          },
          scaleProfile.timeoutMs,
          2,
          { parentSignal: sharedSignal }
        );
        parsed = extractJsonObject(response.text ?? '');
      } else {
        // Gemini Video Limit Guard:
        // NEVER send raw video fileData for videos > 45 minutes (> 2700s) or unknown long courses.
        // Only attempt quick multimodal ingest on confirmed short videos (<= 10 min / 600s).
        const isConfirmedShortVideo =
          typeof totalDurationSeconds === 'number' &&
          totalDurationSeconds > 0 &&
          totalDurationSeconds <= 600;

        if (isConfirmedShortVideo && normalizedUrl) {
          const mmAbort = createLinkedTimeoutController(
            10_000,
            'Multimodal YouTube ingest',
            sharedSignal
          );
          try {
            const mmResponse = await ai.models.generateContent({
              model: FREE_TIER_MODELS[0],
              contents: [
                {
                  fileData: {
                    fileUri: normalizedUrl,
                    mimeType: 'video/mp4',
                  },
                },
                {
                  text: promptInstructions,
                },
              ],
              config: {
                responseMimeType: 'application/json',
                responseSchema: WORKSPACE_RESPONSE_SCHEMA,
                maxOutputTokens: scaleProfile.maxOutputTokens,
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                abortSignal: mmAbort.controller.signal,
              },
            });
            const candidate = extractJsonObject(mmResponse.text ?? '');
            if (Array.isArray(candidate.nodes) && candidate.nodes.length >= 3) {
              parsed = candidate;
              analysisMode = 'multimodal';
            }
          } catch (mmErr) {
            if (sharedSignal.aborted) {
              throw sharedSignal.reason ?? mmErr;
            }
            // Gracefully fall through to Layer 4 Chapters + Search-Grounded Synthesis
          } finally {
            mmAbort.cleanup();
          }
        }

        // Layer 4 Path (Safe Long-Video & No-Captions Fallback):
        // Official YouTube Chapters + Full Description (+ Google Search Grounding only when chapter/description metadata is sparse)
        if (!parsed) {
          analysisMode = 'search-grounded';
          coverageMode = 'chapters-metadata';
          const hasRichChapterMetadata =
            ytBundle.chapters.length >= 4 && (ytBundle.description?.length ?? 0) >= 200;

          let groundedNotes = '';
          if (hasRichChapterMetadata) {
            groundedNotes = [
              `Title: ${mergedOembed.title ?? safeVideoId}`,
              `Channel: ${mergedOembed.authorName ?? 'YouTube Creator'}`,
              `Total Duration: ${totalDurationFormatted} (${totalDurationSeconds}s)`,
              chaptersBlock,
              ytBundle.description ? `Full Video Description:\n${ytBundle.description}` : '',
            ]
              .filter(Boolean)
              .join('\n\n');
          } else {
            const researchPrompt = `Research the exact YouTube video "${mergedOembed.title ?? safeVideoId}" by "${mergedOembed.authorName ?? 'YouTube Creator'}" (${normalizedUrl}, exact duration: ${totalDurationFormatted}) using Google Search.
${chaptersBlock}
${ytBundle.description ? `Video description:\n${ytBundle.description.slice(0, 6000)}\n` : ''}
Provide accurate, end-to-end educational study notes covering the ENTIRE ${totalDurationFormatted} runtime (from introduction through middle concepts to final conclusions). Do NOT invent facts not verifiable from the video or search results:
1. Video category/genre, core thesis, and ${scaleProfile.tldwMin}–${scaleProfile.tldwMax} distinct executive takeaways
2. Complete chronological outline of ${scaleProfile.mainNodesMin}–${scaleProfile.mainNodesMax} major modules across 0%–100% of the runtime (using exact H:MM:SS timestamps from official chapters when available), with ${scaleProfile.subNodesMin}–${scaleProfile.subNodesMax} concrete subtopics per module
3. Accurate definitions, rules/formulas/steps, comparisons/trade-offs, common mistakes, and real-world examples covered across early, middle, and final sections.`;

            try {
              const searchResp = await generateWithFreeTierFallback(
                ai,
                {
                  contents: researchPrompt,
                  config: {
                    tools: [{ googleSearch: {} }],
                  },
                },
                18000,
                2,
                { parentSignal: sharedSignal }
              );
              groundedNotes = (searchResp.text ?? '').trim();
            } catch (searchErr) {
              if (sharedSignal.aborted) {
                throw sharedSignal.reason ?? searchErr;
              }
              groundedNotes = ytBundle.description || mergedOembed.title || normalizedUrl;
            }
          }

          repairSourceContext = groundedNotes.slice(0, 24000);
          const structuredResp = await generateWithFreeTierFallback(
            ai,
            {
              contents: `${promptInstructions}\n\nGROUNDED RESEARCH, CHAPTERS & VIDEO NOTES:\n${repairSourceContext}`,
              config: {
                responseMimeType: 'application/json',
                responseSchema: WORKSPACE_RESPONSE_SCHEMA,
                maxOutputTokens: scaleProfile.maxOutputTokens,
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              },
            },
            scaleProfile.timeoutMs,
            2,
            { parentSignal: sharedSignal }
          );
          parsed = extractJsonObject(structuredResp.text ?? '');
        }
      }

      if (!parsed || !Array.isArray(parsed.nodes) || parsed.nodes.length === 0) {
        throw new Error('Could not extract structured nodes for this video.');
      }

      const resolvedSourceType: 'youtube' | 'manual-transcript' = safeVideoId
        ? 'youtube'
        : 'manual-transcript';
      const resolvedVideoId = safeVideoId || createManualTranscriptId(boundedManualTranscript);

      const sanitizeOptions = {
        videoId: resolvedVideoId,
        youtubeUrl: resolvedSourceType === 'youtube' ? normalizedUrl : '',
        sourceType: resolvedSourceType,
        language: safeLang,
        oembed: mergedOembed,
        videoDurationSeconds: totalDurationSeconds > 0 ? totalDurationSeconds : undefined,
        coverageMode,
        officialChapters: ytBundle.chapters,
      };

      let workspace: LectureWorkspace = sanitizeWorkspace(parsed, sanitizeOptions);
      let qualityReport = validateWorkspaceQuality(workspace, {
        expectedDurationSeconds: totalDurationSeconds > 0 ? totalDurationSeconds : undefined,
        officialChapters: ytBundle.chapters,
        minModules: Math.max(3, scaleProfile.mainNodesMin - 1),
        minChapters: Math.max(3, Math.floor(scaleProfile.scriptChaptersMin * 0.7)),
      });

      // Automated 1-pass coverage & quality repair only if critical gaps remain after deterministic timeline coverage
      if (qualityReport.needsAiRepair && qualityReport.score < 68 && repairSourceContext) {
        try {
          const issuesSummary = qualityReport.issues
            .map((iss) => `- [${iss.severity.toUpperCase()}] ${iss.message}`)
            .join('\n');
          const missingChaptersNote =
            qualityReport.missingChapterHints.length > 0
              ? `\nUNCOVERED OFFICIAL CHAPTERS TO INCLUDE:\n${qualityReport.missingChapterHints.join('\n')}`
              : '';

          const repairPrompt = `You previously generated a MindFlow AI workspace, but automated coverage validation detected critical gaps:
${issuesSummary}${missingChaptersNote}

Regenerate a COMPLETE, corrected workspace JSON that fixes ALL issues above while strictly adhering to the source material (do NOT fabricate facts or out-of-range timestamps). Ensure balanced 0%–100% coverage across introduction, middle chapters, and final conclusions, plus complete Cheat Sheet and chronological Script sections.

${promptInstructions}

SOURCE MATERIAL:
${repairSourceContext.slice(0, 75000)}`;

          const repairResp = await generateWithFreeTierFallback(
            ai,
            {
              contents: repairPrompt,
              config: {
                responseMimeType: 'application/json',
                responseSchema: WORKSPACE_RESPONSE_SCHEMA,
                maxOutputTokens: scaleProfile.maxOutputTokens,
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              },
            },
            26000,
            2,
            { parentSignal: sharedSignal }
          );

          const repairedParsed = extractJsonObject(repairResp.text ?? '');
          if (Array.isArray(repairedParsed.nodes) && repairedParsed.nodes.length >= 3) {
            const candidateWorkspace = sanitizeWorkspace(repairedParsed, sanitizeOptions);
            const candidateReport = validateWorkspaceQuality(candidateWorkspace, {
              expectedDurationSeconds:
                totalDurationSeconds > 0 ? totalDurationSeconds : undefined,
              officialChapters: ytBundle.chapters,
              minModules: Math.max(3, scaleProfile.mainNodesMin - 1),
              minChapters: Math.max(3, Math.floor(scaleProfile.scriptChaptersMin * 0.7)),
            });

            if (candidateReport.score >= qualityReport.score) {
              workspace = candidateWorkspace;
              qualityReport = candidateReport;
            }
          }
        } catch (repairErr) {
          if (sharedSignal.aborted) {
            throw sharedSignal.reason ?? repairErr;
          }
          // Keep the already-normalized workspace cleanly if repair times out or hits quota
        }
      }

          const payload = {
            workspace,
            analysisMode,
            coverageMode,
            qualityScore: qualityReport.score,
          };
          analyzeCache.set(cacheKey, payload);
          return payload;
        },
        { signal: clientAbort.signal }
        );

        res.setHeader('X-MindFlow-Cache', 'MISS');
        res.json(result);
      } catch (error) {
        await refundAiUsage(req, res, 'analysis');
        if (error instanceof Error && error.message === 'YOUTUBE_VIDEO_UNAVAILABLE') {
          const reason = (error as Error & { userReason?: string }).userReason;
          if (!res.headersSent && !res.writableEnded) {
            res.status(422).json({
              error:
                reason ||
                'This YouTube video is private, unavailable, or cannot be reached. Paste its transcript to continue.',
              code: 'VIDEO_UNAVAILABLE',
              retryable: false,
              canPasteTranscript: true,
            });
          }
          return;
        }
        sendClassifiedApiError(
          res,
          error,
          'Could not analyze this video right now. You can retry or paste the transcript manually.',
          'analyze',
          { canPasteTranscript: true }
        );
      } finally {
        cleanupAbort();
        releaseSlot();
      }
    }
  );

  /**
   * PHASE 2: Fast language translator (/api/translate) for English / Hindi / Hinglish
   * Preserves all IDs, timestamps, icons, accents, and tree structure.
   */
  app.post(
    '/api/translate',
    withRateLimit(rateLimiters.translate, 'translate'),
    express.json({ limit: '1mb' }),
    bindUserKey,
    async (req, res) => {
      const { workspace, targetLanguage } = (req.body ?? {}) as {
        workspace?: Record<string, unknown>;
        targetLanguage?: LanguageCode;
      };

      if (
        !workspace ||
        typeof workspace !== 'object' ||
        !Array.isArray(workspace.nodes) ||
        workspace.nodes.length === 0 ||
        workspace.nodes.length > 100 ||
        (targetLanguage !== 'en' && targetLanguage !== 'hi' && targetLanguage !== 'hinglish')
      ) {
        res.status(400).json({
          error: 'A valid workspace and targetLanguage (en, hi, or hinglish) are required.',
          code: 'INVALID_INPUT',
          retryable: false,
        });
        return;
      }

      const ai = createGeminiClient();
      if (!ai) {
        res.status(503).json({
          error:
            'GEMINI_API_KEY is not configured in Settings > Secrets. Pre-seeded DSA language previews remain instant.',
          code: 'AI_NOT_CONFIGURED',
          retryable: false,
        });
        return;
      }

      const sourceVideoId = sanitizeUserText(workspace.videoId, 64) || 'video';
      const translateCacheKey = `translate:${sourceVideoId}:${targetLanguage}:${computeWorkspaceContentFingerprint(
        workspace
      )}`;
      const cached = translateCache.get(translateCacheKey);
      if (cached) {
        res.setHeader('X-MindFlow-Cache', 'HIT');
        res.json(cached);
        return;
      }

      if (!(await enforceAiUsage(req, res, 'ai'))) return;

      const releaseSlot = acquireAiSlot(req, res);
      if (!releaseSlot) return;

      const { controller: clientAbort, cleanup: cleanupAbort } =
        createClientAbortController(res);

      try {
        const result = await inFlight.run(
          translateCacheKey,
          async (sharedSignal) => {
            const existingDur =
              typeof workspace.videoDurationSeconds === 'number'
                ? workspace.videoDurationSeconds
                : parseTimestampToSeconds(String(workspace.durationLabel ?? ''));
            const translateProfile = getDurationScaleProfile(existingDur > 0 ? existingDur : undefined);
            const existingCoverage =
              workspace.coverageMode === 'full-transcript' ||
              workspace.coverageMode === 'timeline-sampled' ||
              workspace.coverageMode === 'chapters-metadata'
                ? workspace.coverageMode
                : undefined;

            const prompt = `Translate the following MindFlow AI educational JSON workspace into the target language.
${getLanguageInstruction(targetLanguage)}

STRICT RULES:
- Preserve EVERY exact "id", "parentId", "nodeId", "videoId", "youtubeUrl", "timestampLabel", "timestampSeconds", "startLabel", "startSeconds", "endLabel", "endSeconds", "accent", "icon", "rating", "isRoot", "position", and "category" enum ("rule" | "formula" | "process" | "code") unchanged.
- Do NOT drop any nodes, subNodes, definitions, keyRulesOrSteps, commonMistakes, quickRevisionPoints, or transcript chapters.
- Keep any "codeSnippet" syntactically valid (do not translate keywords, identifiers, or operators; only translate natural-language comments if present).
- Translate ONLY human-readable text fields cleanly and naturally (title, videoCategory, tldw, shortSubtitle, keyPoints, realLifeExample, simplifiedAnalogy, cheatSheet text fields including definitions/rules/mistakes/revision points, transcript titles/topicTags/keyTakeaway/lines).
- Return valid JSON matching the exact schema.

SOURCE JSON:
${JSON.stringify(workspace)}`;

            const response = await generateWithFreeTierFallback(
              ai,
              {
                contents: prompt,
                config: {
                  responseMimeType: 'application/json',
                  responseSchema: WORKSPACE_RESPONSE_SCHEMA,
                  maxOutputTokens: translateProfile.maxOutputTokens,
                  thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                },
              },
              translateProfile.timeoutMs,
              2,
              { parentSignal: sharedSignal }
            );

            const parsed = extractJsonObject(response.text ?? '{}');
            const existingSourceType: 'youtube' | 'manual-transcript' =
              workspace.sourceType === 'manual-transcript' || !isValidYouTubeId(sourceVideoId)
                ? 'manual-transcript'
                : 'youtube';
            const translated = sanitizeWorkspace(parsed, {
              videoId: sourceVideoId,
              youtubeUrl: existingSourceType === 'youtube' ? String(workspace.youtubeUrl ?? '') : '',
              sourceType: existingSourceType,
              language: targetLanguage,
              oembed: {
                title: String(workspace.title ?? ''),
                authorName: String(workspace.channel ?? ''),
              },
              videoDurationSeconds: existingDur > 0 ? existingDur : undefined,
              coverageMode: existingCoverage,
            });

            const payload = { workspace: translated };
            translateCache.set(translateCacheKey, payload);
            return payload;
          },
          { signal: clientAbort.signal }
        );

        res.setHeader('X-MindFlow-Cache', 'MISS');
        res.json(result);
      } catch (error) {
        sendClassifiedApiError(
          res,
          error,
          'Unable to translate workspace right now. Please try again.',
          'translate'
        );
      } finally {
        cleanupAbort();
        releaseSlot();
      }
    }
  );

  const SIMPLIFY_RESPONSE_SCHEMA: Schema = {
    type: Type.OBJECT,
    properties: {
      simpleDefinition: { type: Type.STRING },
      easyExplanation: { type: Type.STRING },
      realLifeAnalogy: { type: Type.STRING },
      relevantExample: { type: Type.STRING },
      oneLineTakeaway: { type: Type.STRING },
    },
    required: [
      'simpleDefinition',
      'easyExplanation',
      'realLifeAnalogy',
      'relevantExample',
      'oneLineTakeaway',
    ],
  };

  /**
   * Structured 5-part beginner simplification endpoint (/api/simplify):
   * 1. Simple definition
   * 2. Easy explanation
   * 3. Accurate, mature real-life analogy
   * 4. One relevant concrete example
   * 5. One-line takeaway
   */
  app.post(
    '/api/simplify',
    withRateLimit(rateLimiters.simplify, 'simplify'),
    express.json({ limit: '128kb' }),
    bindUserKey,
    async (req, res) => {
      const {
        nodeTitle,
        videoTitle,
        shortSubtitle,
        realLifeExample,
        transcriptExcerpt,
        keyPoints,
        language = 'en',
      } = (req.body ?? {}) as {
        nodeTitle?: string;
        videoTitle?: string;
        shortSubtitle?: string;
        realLifeExample?: string;
        transcriptExcerpt?: string;
        keyPoints?: Array<{ keyword?: string; detail?: string }>;
        language?: LanguageCode;
      };

      const cleanNodeTitle = sanitizeUserText(nodeTitle, 240);
      const cleanVideoTitle = sanitizeUserText(videoTitle, 300) || 'YouTube Video';
      const cleanSubtitle = sanitizeUserText(shortSubtitle, 240);
      const cleanExample = sanitizeUserText(realLifeExample, 360);
      const cleanExcerpt = sanitizeUserText(transcriptExcerpt, 1200);

      if (!cleanNodeTitle) {
        res.status(400).json({
          error: 'nodeTitle is required.',
          code: 'INVALID_INPUT',
          retryable: false,
        });
        return;
      }

      const ai = createGeminiClient();
      if (!ai) {
        res.status(503).json({
          error: 'GEMINI_API_KEY is required for live AI simplification.',
          code: 'AI_NOT_CONFIGURED',
          retryable: false,
        });
        return;
      }

      const safeLang: LanguageCode =
        language === 'hi' || language === 'hinglish' ? language : 'en';

      const simplifyKey = `simplify:${safeLang}:${hashCacheKey(
        `${cleanNodeTitle}|${cleanVideoTitle}|${cleanSubtitle}`
      )}`;
      const cached = simplifyCache.get(simplifyKey);
      if (cached) {
        res.setHeader('X-MindFlow-Cache', 'HIT');
        res.json(cached);
        return;
      }

      if (!(await enforceAiUsage(req, res, 'ai'))) return;

      const releaseSlot = acquireAiSlot(req, res);
      if (!releaseSlot) return;

      const { controller: clientAbort, cleanup: cleanupAbort } =
        createClientAbortController(res);

      try {
        const result = await inFlight.run(
          simplifyKey,
          async (sharedSignal) => {
            const context = Array.isArray(keyPoints)
              ? keyPoints
                  .slice(0, 5)
                  .map(
                    (kp) =>
                      `${sanitizeUserText(kp.keyword, 80)}: ${sanitizeUserText(kp.detail, 260)}`
                  )
                  .join('\n- ')
              : '';

            const prompt = `You are an expert university tutor explaining a concept clearly to a bright beginner who wants genuine understanding without jargon or condescension.

${getLanguageInstruction(safeLang)}

CONCEPT TO SIMPLIFY: "${cleanNodeTitle}"
VIDEO CONTEXT: "${cleanVideoTitle}"${cleanSubtitle ? `\nSUBTITLE: ${cleanSubtitle}` : ''}${
              context ? `\nKEY NOTES FROM VIDEO:\n- ${context}` : ''
            }${cleanExample ? `\nEXISTING VIDEO EXAMPLE: ${cleanExample}` : ''}${
              cleanExcerpt ? `\nNEAREST VIDEO EXCERPT:\n${cleanExcerpt}` : ''
            }

REQUIREMENTS (Return valid JSON with all 5 fields):
1. "simpleDefinition": A crisp 1-sentence plain-language definition accurately stating what this concept is.
2. "easyExplanation": 2 clear sentences explaining HOW or WHY it works in simple terms, faithful to the video context.
3. "realLifeAnalogy": 1–2 sentences giving a mature, accurate, relatable everyday analogy (NEVER childish, silly, or technically misleading).
4. "relevantExample": 1–2 sentences with one concrete, relevant practical example applying this concept.
5. "oneLineTakeaway": One memorable, exam-ready sentence summarizing the core takeaway.
Never invent technical claims that contradict the video notes.`;

            const response = await generateWithFreeTierFallback(
              ai,
              {
                contents: prompt,
                config: {
                  responseMimeType: 'application/json',
                  responseSchema: SIMPLIFY_RESPONSE_SCHEMA,
                  thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                },
              },
              20_000,
              2,
              { parentSignal: sharedSignal }
            );

            const rawText = (response.text ?? '').trim();
            let payload: Record<string, unknown>;
            try {
              const parsedRaw = extractJsonObject(rawText);
              const structured = parseStructuredSimplification(parsedRaw);
              payload = structured
                ? { structured, analogy: formatStructuredSimplification(structured) }
                : { analogy: rawText, structured: null };
            } catch {
              if (!rawText) {
                throw new Error('Empty JSON response.');
              }
              payload = { analogy: rawText, structured: null };
            }

            simplifyCache.set(simplifyKey, payload);
            return payload;
          },
          { signal: clientAbort.signal }
        );

        res.setHeader('X-MindFlow-Cache', 'MISS');
        res.json(result);
      } catch (error) {
        sendClassifiedApiError(
          res,
          error,
          'Unable to simplify this concept right now. Please try again.',
          'simplify'
        );
      } finally {
        cleanupAbort();
        releaseSlot();
      }
    }
  );

  /**
   * Google Search Grounding endpoint for enriching any selected mindmap node
   * with up-to-date real-world engineering facts and verifiable web citations.
   */
  app.post(
    '/api/grounding/node',
    withRateLimit(rateLimiters.grounding, 'grounding'),
    express.json({ limit: '128kb' }),
    bindUserKey,
    async (req, res) => {
      const { nodeTitle, lectureTitle, keyPoints } = req.body ?? {};
      const cleanNodeTitle = sanitizeUserText(nodeTitle, 240);
      const cleanLectureTitle = sanitizeUserText(lectureTitle, 300) || 'General';
      if (!cleanNodeTitle) {
        res.status(400).json({
          error: 'nodeTitle is required.',
          code: 'INVALID_INPUT',
          retryable: false,
        });
        return;
      }

      const ai = createGeminiClient();
      if (!ai) {
        res.status(503).json({
          error:
            'Google Search grounding requires GEMINI_API_KEY in Settings > Secrets. Offline study notes remain fully available.',
          code: 'AI_NOT_CONFIGURED',
          retryable: false,
        });
        return;
      }

      const groundingKey = `grounding:${hashCacheKey(`${cleanLectureTitle}|${cleanNodeTitle}`)}`;
      const cached = groundingCache.get(groundingKey);
      if (cached) {
        res.setHeader('X-MindFlow-Cache', 'HIT');
        res.json(cached);
        return;
      }

      if (!(await enforceAiUsage(req, res, 'ai'))) return;

      const releaseSlot = acquireAiSlot(req, res);
      if (!releaseSlot) return;

      const { controller: clientAbort, cleanup: cleanupAbort } =
        createClientAbortController(res);

      try {
        const result = await inFlight.run(
          groundingKey,
          async (sharedSignal) => {
            const pointContext = Array.isArray(keyPoints)
              ? keyPoints
                  .slice(0, 4)
                  .map(
                    (p: { keyword?: string; detail?: string }) =>
                      `${sanitizeUserText(p.keyword, 80)}: ${sanitizeUserText(p.detail, 220)}`
                  )
                  .join('; ')
              : '';

            const prompt = [
              `You are a concise study assistant for MindFlow AI.`,
              `Video topic: "${cleanLectureTitle}".`,
              `Selected mindmap node: "${cleanNodeTitle}".`,
              pointContext ? `Existing notes: ${pointContext}` : '',
              `Use Google Search to gather up-to-date, accurate real-world context or recent facts for "${cleanNodeTitle}".`,
              `Respond cleanly in this exact format:`,
              `SUMMARY: <2 crisp sentences>`,
              `- <highlight 1>`,
              `- <highlight 2>`,
              `- <highlight 3>`,
            ]
              .filter(Boolean)
              .join('\n');

            const response = await generateWithFreeTierFallback(
              ai,
              {
                contents: prompt,
                config: {
                  tools: [{ googleSearch: {} }],
                },
              },
              22_000,
              2,
              { parentSignal: sharedSignal }
            );

            const rawText = (response.text ?? '').trim();
            const lines = rawText
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean);

            let summary = '';
            const highlights: string[] = [];

            for (const line of lines) {
              if (line.toUpperCase().startsWith('SUMMARY:')) {
                summary = line.slice(8).trim();
              } else if (line.startsWith('- ') || line.startsWith('* ')) {
                highlights.push(line.slice(2).trim());
              } else if (!summary) {
                summary = line;
              }
            }

            const chunks = response.candidates?.[0]?.groundingMetadata
              ?.groundingChunks as RawGroundingChunk[] | undefined;
            const sources = extractGroundingSources(chunks);

            const payload = {
              summary: summary || rawText.slice(0, 280),
              highlights: highlights.slice(0, 4),
              sources,
              fetchedAt: new Date().toISOString(),
            };
            groundingCache.set(groundingKey, payload);
            return payload;
          },
          { signal: clientAbort.signal }
        );

        res.setHeader('X-MindFlow-Cache', 'MISS');
        res.json(result);
      } catch (error) {
        sendClassifiedApiError(
          res,
          error,
          'Failed to fetch search-grounded insights. Please try again.',
          'grounding'
        );
      } finally {
        cleanupAbort();
        releaseSlot();
      }
    }
  );

  /**
   * PHASE 3: Safe allowlisted HTTPS raster image proxy (/api/image-proxy)
   * Enables CORS-safe YouTube video frames and Wikimedia reference thumbnails
   * inside the Visual PDF Studio preview and print-to-PDF export.
   */
  app.get(
    '/api/image-proxy',
    withRateLimit(rateLimiters.imageProxy, 'image-proxy', false),
    async (req, res) => {
      const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
      if (!rawUrl || !isAllowedRemoteImageUrl(rawUrl)) {
        res.status(400).json({
          error: 'Image URL is missing or not on the allowed image host list.',
          code: 'INVALID_IMAGE_URL',
          retryable: false,
        });
        return;
      }

      const { controller: clientAbort, cleanup: cleanupClientAbort } =
        createClientAbortController(res);
      const { controller, cleanup: cleanupTimeout } = createLinkedTimeoutController(
        6000,
        'Image proxy fetch',
        clientAbort.signal
      );

      try {
        let currentUrl = rawUrl;
        let upstream: globalThis.Response | null = null;

        for (let hop = 0; hop < 3; hop++) {
          const resp = await fetch(currentUrl, {
            signal: controller.signal,
            redirect: 'manual',
            headers: {
              'User-Agent': 'MindFlowAI/1.0 (https://mindflow.app; educational-study-app)',
              Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif',
            },
          });

          if (resp.status >= 300 && resp.status < 400) {
            const location = resp.headers.get('location');
            if (!location) break;
            const nextUrl = new URL(location, currentUrl).toString();
            if (!isAllowedRemoteImageUrl(nextUrl)) {
              res.status(403).json({
                error: 'Redirect target is not an allowed image host.',
                code: 'DISALLOWED_REDIRECT',
                retryable: false,
              });
              return;
            }
            currentUrl = nextUrl;
            continue;
          }

          upstream = resp;
          break;
        }

        if (!upstream || !upstream.ok) {
          // Fallback for missing YouTube maxresdefault.jpg -> hqdefault.jpg
          if (/i\.ytimg\.com\/vi\/([A-Za-z0-9_-]{11})\/maxresdefault\.jpg$/i.test(rawUrl)) {
            const fallbackUrl = rawUrl.replace(/maxresdefault\.jpg$/i, 'hqdefault.jpg');
            const fallbackResp = await fetch(fallbackUrl, {
              signal: controller.signal,
              redirect: 'manual',
            });
            if (fallbackResp.ok) {
              upstream = fallbackResp;
            }
          }
        }

        if (!upstream || !upstream.ok) {
          res.status(404).end();
          return;
        }

        const contentType = upstream.headers.get('content-type') ?? '';
        if (!isAllowedRasterImageMime(contentType)) {
          res.status(415).json({
            error: 'Upstream resource is not a supported raster image.',
            code: 'UNSUPPORTED_MEDIA_TYPE',
            retryable: false,
          });
          return;
        }

        const buffer = await readResponseBufferWithLimit(upstream, 5 * 1024 * 1024);

        res.setHeader('Content-Type', contentType.split(';')[0].trim());
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.send(buffer);
      } catch (error) {
        if (res.headersSent || res.writableEnded || res.destroyed) return;
        if (error instanceof Error && error.message === 'RESPONSE_TOO_LARGE') {
          res.status(413).json({
            error: 'Image exceeds 5MB limit.',
            code: 'IMAGE_TOO_LARGE',
            retryable: false,
          });
          return;
        }
        res.status(502).end();
      } finally {
        cleanupTimeout();
        cleanupClientAbort();
      }
    }
  );

  const VISUAL_GUIDE_RESPONSE_SCHEMA: Schema = {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING },
      subtitle: { type: Type.STRING },
      category: { type: Type.STRING },
      estimatedReadTime: { type: Type.STRING },
      heroTakeaways: { type: Type.ARRAY, items: { type: Type.STRING } },
      chapters: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            timestamp: { type: Type.STRING },
            timestampSeconds: { type: Type.INTEGER },
            heading: { type: Type.STRING },
            accent: { type: Type.STRING },
            videoExplanation: { type: Type.ARRAY, items: { type: Type.STRING } },
            keyTerms: { type: Type.ARRAY, items: { type: Type.STRING } },
            practicalExample: { type: Type.STRING },
            chapterSummary: { type: Type.STRING },
            insightLabel: { type: Type.STRING },
            extraAiInsight: { type: Type.STRING },
            webImageQuery: { type: Type.STRING },
            includeDiagram: { type: Type.BOOLEAN },
            svgDiagram: { type: Type.STRING },
          },
          required: [
            'id',
            'timestamp',
            'timestampSeconds',
            'heading',
            'accent',
            'videoExplanation',
            'keyTerms',
            'practicalExample',
            'chapterSummary',
            'insightLabel',
            'extraAiInsight',
            'webImageQuery',
            'includeDiagram',
            'svgDiagram',
          ],
        },
      },
      quickRecall: {
        type: Type.OBJECT,
        properties: {
          terms: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                term: { type: Type.STRING },
                definition: { type: Type.STRING },
                note: { type: Type.STRING },
              },
              required: ['term', 'definition', 'note'],
            },
          },
          checklist: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['terms', 'checklist'],
      },
    },
    required: [
      'title',
      'subtitle',
      'category',
      'estimatedReadTime',
      'heroTakeaways',
      'chapters',
      'quickRecall',
    ],
  };

  async function fetchWikipediaThumbnail(
    query: string,
    parentSignal?: AbortSignal
  ): Promise<{ url?: string; caption?: string }> {
    const cleanQuery = query.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!cleanQuery) return {};

    const { controller, cleanup } = createLinkedTimeoutController(
      3500,
      'Wikipedia thumbnail',
      parentSignal
    );

    try {
      const endpoint = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
        cleanQuery
      )}`;
      const resp = await fetch(endpoint, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'MindFlowAI/1.0 (https://mindflow.app; educational-study-app)',
        },
      });
      if (!resp.ok) return {};
      const data = (await resp.json()) as {
        title?: string;
        thumbnail?: { source?: string };
      };
      const source = data?.thumbnail?.source;
      if (source && isAllowedRemoteImageUrl(source)) {
        return {
          url: buildProxyImageUrl(source),
          caption: data.title ? `${data.title} (Wikimedia)` : undefined,
        };
      }
      return {};
    } catch {
      return {};
    } finally {
      cleanup();
    }
  }

  /**
   * PHASE 3: Smart Visual PDF Guide Generator (/api/generate-visual-guide)
   * Crafts a high-depth editorial study guide with micro-paragraphs, practical examples,
   * revision summaries, conditional meaningful SVG diagrams, and accurate rapid recall.
   */
  app.post(
    '/api/generate-visual-guide',
    withRateLimit(rateLimiters.visualGuide, 'visual-guide'),
    express.json({ limit: '1mb' }),
    bindUserKey,
    async (req, res) => {
      const {
        videoId,
        analysisData,
        language = 'en',
        guideLength = 'long',
        includeDiagrams = true,
      } = (req.body ?? {}) as {
        videoId?: string;
        analysisData?: Record<string, unknown>;
        language?: LanguageCode;
        guideLength?: 'standard' | 'long';
        includeDiagrams?: boolean;
      };

      const safeVideoId = typeof videoId === 'string' ? videoId.trim() : '';
      const safeLang: LanguageCode =
        language === 'hi' || language === 'hinglish' ? language : 'en';
      const isLong = guideLength !== 'standard';
      const allowDiagrams = includeDiagrams !== false;

      if (!analysisData || typeof analysisData !== 'object') {
        res.status(400).json({
          error: 'analysisData is required to build a Visual PDF Guide.',
          code: 'INVALID_INPUT',
          retryable: false,
        });
        return;
      }

      const ai = createGeminiClient();
      if (!ai) {
        res.status(503).json({
          error: 'GEMINI_API_KEY is required in Settings > Secrets to generate new Visual PDF Guides.',
          code: 'AI_NOT_CONFIGURED',
          retryable: false,
        });
        return;
      }

      const hasValidYtId = isValidYouTubeId(safeVideoId);
      const contentFingerprint = computeWorkspaceContentFingerprint(analysisData);
      const guideCacheKey = `vguide:${hasValidYtId ? safeVideoId : 'manual'}:${contentFingerprint}:${safeLang}:${isLong ? 'long' : 'standard'}:${allowDiagrams ? 'diag1' : 'diag0'}`;
      const cachedGuide = visualGuideCache.get(guideCacheKey);
      if (cachedGuide) {
        res.setHeader('X-MindFlow-Cache', 'HIT');
        res.json(cachedGuide);
        return;
      }

      if (!(await enforceAiUsage(req, res, 'ai'))) return;

      const releaseSlot = acquireAiSlot(req, res);
      if (!releaseSlot) return;

      const { controller: clientAbort, cleanup: cleanupAbort } =
        createClientAbortController(res);

      try {
        const result = await inFlight.run(
          guideCacheKey,
          async (sharedSignal) => {
            const guideMaxDuration =
              typeof analysisData.videoDurationSeconds === 'number' &&
              analysisData.videoDurationSeconds > 0
                ? analysisData.videoDurationSeconds
                : undefined;

            const visualGuideContext = buildVisualGuideContext(analysisData, {
              maxChars: 24000,
            });

            const diagramPromptRule = allowDiagrams
              ? `   - "includeDiagram" & "svgDiagram": Set "includeDiagram": true ONLY when a visual diagram (flowchart, hierarchy, comparison, architecture, or step sequence) genuinely helps explain this chapter's concept; set "includeDiagram": false and "svgDiagram": "" for purely narrative/introductory chapters so there are zero filler diagrams.
     When "includeDiagram" is true, output a clean, meaningful inline <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 220" width="100%"> using dark slate background #0b1120, rounded nodes (#131c35), crisp arrows/connectors, high-contrast labels (#f8fafc / #cbd5e1), and accent strokes (#8b5cf6, #22d3ee, #10b981, #818cf8) that our renderer automatically adapts to Obsidian, Warm, and Blueprint themes. NEVER include height="auto", <script>, <style>, <foreignObject>, or external images.`
              : `   - "includeDiagram" & "svgDiagram": Diagrams are explicitly DISABLED by the user for this guide. Set "includeDiagram": false and "svgDiagram": "" on EVERY chapter.`;

            const prompt = `You are an expert educational textbook author & instructional designer creating a structured, genuinely useful Visual PDF Study Guide from a YouTube video so a student can thoroughly study and revise the ENTIRE topic.

${getLanguageInstruction(safeLang)}

FULL-VIDEO STRUCTURED ANALYSIS CONTEXT (BALANCED 0% TO 100% COVERAGE):
${visualGuideContext}

EDUCATIONAL QUALITY & DESIGN RULES (${isLong ? 'COMPREHENSIVE MULTI-PAGE EDITION' : 'CONCISE EDITION'}):
- STRICT GROUNDING: Base every fact, concept, formula, and timestamp on the structured context above. Never invent video claims or fake timestamps.
1. Hero Summary:
   - Clear editorial "title" and informative "subtitle"
   - "category" matching the video subject
   - "estimatedReadTime" (e.g., "${isLong ? '8–10 min' : '4 min'}" / "${isLong ? '8–10 मिनट' : '4 मिनट'}")
   - "heroTakeaways": ${isLong ? '4 to 6' : '3 to 4'} high-signal, non-redundant executive takeaways spanning the entire video arc (core thesis, key lessons, practical insight, conclusion).
2. "chapters": Generate ${isLong ? '6 to 8 well-organized chronological chapters' : '4 to 5 well-paced chronological chapters'} covering early, middle, AND concluding sections of the video:
   - "timestamp" (exact MM:SS or H:MM:SS from context) & integer "timestampSeconds"
   - "heading": Clear, descriptive chapter heading
   - "accent": one of "violet", "cyan", "emerald", "indigo"
   - "videoExplanation": Array of ${isLong ? '3 to 4 crisp, readable micro-paragraphs (2–3 sentences each covering the core idea, how it works step-by-step, relevant facts/rules, and nuances — no unbroken walls of text)' : '2 crisp micro-paragraphs'}.
   - "keyTerms": 3–5 essential concepts or terminology items from this chapter.
   - "practicalExample": One concrete, source-supported practical example or real-world application (1–2 crisp sentences).
   - "chapterSummary": A concise 1-sentence revision takeaway summarizing what the student should remember from this chapter.
   - "insightLabel": Short badge label (e.g., "Key Distinction", "Mental Model", "Exam Tip", "Worked Application").
   - "extraAiInsight": Helpful memory model, common pitfall warning, or clarifying connection (2 crisp sentences; if adding a supplementary analogy beyond the video, keep it accurate and clearly framed).
   - "webImageQuery": ONLY provide a 2–3 word ENGLISH Wikipedia phrase if a concrete scientific, anatomical, historical, or technical photo genuinely improves understanding; otherwise return an empty string "" (NEVER request irrelevant decorative images).
${diagramPromptRule}
3. "quickRecall":
   - "terms": ${isLong ? '8 to 10' : '5 to 6'} essential terms/formulas/rules with accurate "definition" and practical "note".
   - "checklist": ${isLong ? '6 to 8' : '5'} focused active-recall revision questions/checkpoints covering early through late chapters.`;

            const response = await generateWithFreeTierFallback(
              ai,
              {
                contents: prompt,
                config: {
                  responseMimeType: 'application/json',
                  responseSchema: VISUAL_GUIDE_RESPONSE_SCHEMA,
                  maxOutputTokens: 16384,
                  thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                },
              },
              36000,
              2,
              { parentSignal: sharedSignal }
            );

            const parsed = extractJsonObject(response.text ?? '');
            const rawChapters = Array.isArray(parsed.chapters) ? parsed.chapters : [];
            const frameCycle: Array<'1' | '2' | '3' | 'maxresdefault' | 'hqdefault'> = [
              '1',
              '2',
              '3',
              'maxresdefault',
              'hqdefault',
            ];

            // Enrich chapters in parallel with conditional Wikipedia thumbnails + YouTube frames + strict SVG sanitization
            const chapters = await Promise.all(
              rawChapters.slice(0, isLong ? 8 : 6).map(async (ch: Record<string, unknown>, idx: number) => {
                const query = typeof ch.webImageQuery === 'string' ? ch.webImageQuery.trim() : '';
                const wiki =
                  query.length >= 3 ? await fetchWikipediaThumbnail(query, sharedSignal) : {};
                const accent = VALID_ACCENTS.has(String(ch.accent))
                  ? (String(ch.accent) as 'violet' | 'cyan' | 'emerald' | 'indigo')
                  : ACCENT_CYCLE[idx % ACCENT_CYCLE.length];
                const heading = String(ch.heading ?? `Chapter ${idx + 1}`);
                const keyTerms = Array.isArray(ch.keyTerms)
                  ? ch.keyTerms.slice(0, 6).map(String)
                  : [];
                const chapterIncludesDiagram = allowDiagrams && ch.includeDiagram === true;

                const normTs = normalizeTimestampPair(
                  ch.timestampSeconds,
                  ch.timestamp,
                  guideMaxDuration
                );

                const practicalExample =
                  typeof ch.practicalExample === 'string' && ch.practicalExample.trim()
                    ? ch.practicalExample.trim()
                    : undefined;
                const chapterSummary =
                  typeof ch.chapterSummary === 'string' && ch.chapterSummary.trim()
                    ? ch.chapterSummary.trim()
                    : undefined;

                return {
                  id:
                    typeof ch.id === 'string' && ch.id.trim()
                      ? ch.id.trim()
                      : `vg-ch-${idx + 1}`,
                  timestamp: normTs.label,
                  timestampSeconds: normTs.seconds,
                  heading,
                  accent,
                  videoExplanation: Array.isArray(ch.videoExplanation)
                    ? ch.videoExplanation.slice(0, 4).map(String)
                    : [String(ch.videoExplanation ?? '')],
                  keyTerms,
                  ...(practicalExample ? { practicalExample } : {}),
                  ...(chapterSummary ? { chapterSummary } : {}),
                  insightLabel: String(ch.insightLabel ?? 'Key Insight'),
                  extraAiInsight: String(ch.extraAiInsight ?? ''),
                  webImageQuery: query,
                  webImageUrl: wiki.url,
                  webImageCaption: wiki.caption,
                  videoFrameUrl: hasValidYtId
                    ? buildYouTubeFrameUrl(safeVideoId, frameCycle[idx % frameCycle.length])
                    : undefined,
                  svgDiagram: sanitizeOptionalSvgDiagram(
                    typeof ch.svgDiagram === 'string' ? ch.svgDiagram : undefined,
                    chapterIncludesDiagram,
                    heading,
                    keyTerms
                  ),
                };
              })
            );

            const quickRaw = (parsed.quickRecall ?? {}) as Record<string, unknown>;
            const guide = {
              id: `vguide-${safeVideoId || 'video'}-${safeLang}`,
              videoId: safeVideoId || String(analysisData.videoId ?? 'video'),
              language: safeLang,
              title: String(parsed.title || analysisData.title || 'Visual Study Guide'),
              subtitle: String(
                parsed.subtitle || 'Comprehensive long-form notes, vector diagrams & rapid recall sheet'
              ),
              channel: String(analysisData.channel ?? 'YouTube Creator'),
              category: String(parsed.category || analysisData.videoCategory || 'Explainer'),
              estimatedReadTime: String(parsed.estimatedReadTime || (isLong ? '8 min' : '4 min')),
              heroTakeaways: Array.isArray(parsed.heroTakeaways)
                ? parsed.heroTakeaways.slice(0, 5).map(String)
                : [],
              coverFrameUrl: hasValidYtId
                ? buildYouTubeFrameUrl(safeVideoId, 'maxresdefault')
                : '',
              chapters,
              quickRecall: {
                terms: Array.isArray(quickRaw.terms)
                  ? quickRaw.terms.slice(0, 12).map((t: Record<string, unknown>) => ({
                      term: String(t.term ?? ''),
                      definition: String(t.definition ?? ''),
                      note: String(t.note ?? ''),
                    }))
                  : [],
                checklist: Array.isArray(quickRaw.checklist)
                  ? quickRaw.checklist.slice(0, 8).map(String)
                  : [],
              },
              generatedAt: new Date().toISOString(),
            };

            const payload = { guide };
            visualGuideCache.set(guideCacheKey, payload);
            return payload;
          },
          { signal: clientAbort.signal }
        );

        res.setHeader('X-MindFlow-Cache', 'MISS');
        res.json(result);
      } catch (error) {
        sendClassifiedApiError(
          res,
          error,
          'Unable to generate Visual PDF Guide right now. Please try again.',
          'visual-guide'
        );
      } finally {
        cleanupAbort();
        releaseSlot();
      }
    }
  );

  const CHAT_RESPONSE_SCHEMA: Schema = {
    type: Type.OBJECT,
    properties: {
      answer: { type: Type.STRING },
      citations: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            label: { type: Type.STRING },
            seconds: { type: Type.INTEGER },
            topic: { type: Type.STRING },
          },
          required: ['label', 'seconds', 'topic'],
        },
      },
    },
    required: ['answer', 'citations'],
  };

  /**
   * PHASE 3: "Ask This Video" Scoped Mini-Chat (/api/chat)
   * Answers questions strictly grounded in the current video's transcript & analysis,
   * replying in English / Hindi / Hinglish with clickable timestamp citations.
   */
  app.post(
    '/api/chat',
    withRateLimit(rateLimiters.chat, 'chat'),
    express.json({ limit: '512kb' }),
    bindUserKey,
    async (req, res) => {
      const {
        question,
        workspace,
        history = [],
        language = 'en',
      } = (req.body ?? {}) as {
        question?: string;
        workspace?: Record<string, unknown>;
        history?: Array<{ role?: string; content?: string }>;
        language?: LanguageCode;
      };

      const cleanQuestion = sanitizeUserText(question, 600);
      if (!cleanQuestion) {
        res.status(400).json({
          error: 'Please enter a question about this video.',
          code: 'INVALID_INPUT',
          retryable: false,
        });
        return;
      }

      if (!workspace || typeof workspace !== 'object') {
        res.status(400).json({
          error: 'Video context is required.',
          code: 'INVALID_INPUT',
          retryable: false,
        });
        return;
      }

      const ai = createGeminiClient();
      if (!ai) {
        res.status(503).json({
          error: 'GEMINI_API_KEY is required in Settings > Secrets to chat with this video.',
          code: 'AI_NOT_CONFIGURED',
          retryable: false,
        });
        return;
      }

      const safeLang: LanguageCode =
        language === 'hi' || language === 'hinglish' ? language : 'en';

      const recentHistory = Array.isArray(history)
        ? history
            .slice(-6)
            .map(
              (m) =>
                `${m.role === 'user' ? 'User' : 'Assistant'}: ${sanitizeUserText(m.content, 300)}`
            )
            .join('\n')
        : '';

      const chatVideoKey = sanitizeUserText(workspace.videoId, 64) || hashCacheKey(String(workspace.title ?? ''));
      const workspaceFingerprint = computeWorkspaceContentFingerprint(workspace);
      const chatCacheKey = `chat:${chatVideoKey}:${workspaceFingerprint}:${safeLang}:${hashCacheKey(
        `${cleanQuestion.toLowerCase()}|${recentHistory}`
      )}`;
      const cachedChat = chatCache.get(chatCacheKey);
      if (cachedChat) {
        res.setHeader('X-MindFlow-Cache', 'HIT');
        res.json(cachedChat);
        return;
      }

      if (!(await enforceAiUsage(req, res, 'ai'))) return;

      const releaseSlot = acquireAiSlot(req, res);
      if (!releaseSlot) return;

      const { controller: clientAbort, cleanup: cleanupAbort } =
        createClientAbortController(res);

      try {
        const result = await inFlight.run(
          chatCacheKey,
          async (sharedSignal) => {
            const chatMaxDuration =
              typeof workspace.videoDurationSeconds === 'number' && workspace.videoDurationSeconds > 0
                ? workspace.videoDurationSeconds
                : undefined;

            const retrieved = retrieveChatContext(workspace, cleanQuestion, {
              maxChars: 14000,
              recentHistoryText: recentHistory,
            });

            const prompt = `You are "Ask This Video", a knowledgeable, patient AI study tutor inside MindFlow AI grounded strictly in the current video workspace below.
${getLanguageInstruction(safeLang)}

TUTOR CAPABILITIES (Adapt your response style to what the student asks):
- Explaining a difficult concept clearly step-by-step
- Giving a simpler beginner-friendly explanation or concrete example
- Comparing two concepts from the video side-by-side (highlight differences, trade-offs, and when to use each)
- Summarizing a specific chapter or answering questions from late/middle/early parts of the video
- Explaining key terminology, formulas, or rules from the lesson
- Generating focused practice/revision questions with brief self-check hints when asked
- Connecting related ideas across different chapters of the video

STRICT GROUNDING & ACCURACY RULES:
1. Base your explanation primarily on the video overview, timeline index, and retrieved evidence chunks below.
2. NEVER invent video content, quotes, formulas, or timestamps that are not supported by the retrieved context.
3. If you add a brief extra example or analogy to help clarify a concept that IS covered in the video, explicitly label that sentence with "(Supplementary explanation)" so the student always knows what came from the video vs. extra tutoring context.
4. If the student asks about something NOT covered in this video, clearly say that this information is not covered in the video, point out 1–2 related topics from the timeline index that ARE covered, and return an EMPTY "citations": [] array.
5. Keep answers well-structured, clear, and scannable (concise paragraphs or short bullet points using plain newlines — no cluttered walls of text).
6. Cite 1–3 exact relevant timestamps copied directly from the retrieved context in "citations" (exact MM:SS or H:MM:SS "label", integer "seconds", and short "topic").

RETRIEVED VIDEO CONTEXT (${retrieved.selectedChunkIds.length} of ${retrieved.totalIndexedChunks} indexed moments across the full timeline):
${retrieved.contextText}

${recentHistory ? `RECENT CONVERSATION:\n${recentHistory}\n` : ''}
USER QUESTION: ${cleanQuestion}`;

            const response = await generateWithFreeTierFallback(
              ai,
              {
                contents: prompt,
                config: {
                  responseMimeType: 'application/json',
                  responseSchema: CHAT_RESPONSE_SCHEMA,
                  thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                },
              },
              22_000,
              2,
              { parentSignal: sharedSignal }
            );

            const rawText = (response.text ?? '').trim();
            let answer = '';
            let rawCitations: Array<{ label?: string; seconds?: number; topic?: string }> | undefined;

            try {
              const parsed = extractJsonObject(rawText) as {
                answer?: string;
                citations?: Array<{ label?: string; seconds?: number; topic?: string }>;
              };
              answer = typeof parsed.answer === 'string' ? parsed.answer.trim() : '';
              rawCitations = parsed.citations;
            } catch {
              // Graceful plain-text fallback if a model returns prose instead of strict JSON
              if (rawText && !rawText.startsWith('{')) {
                answer = rawText;
                rawCitations = [];
              } else {
                throw new Error('Could not parse structured JSON from AI response.');
              }
            }

            if (!answer) {
              throw new Error('Empty JSON response.');
            }

            const citations = validateChatCitations(
              rawCitations,
              retrieved.validTimestampSeconds,
              chatMaxDuration
            );

            const payload = { answer, citations };
            chatCache.set(chatCacheKey, payload);
            return payload;
          },
          { signal: clientAbort.signal }
        );

        res.setHeader('X-MindFlow-Cache', 'MISS');
        res.json(result);
      } catch (error) {
        sendClassifiedApiError(
          res,
          error,
          'Unable to answer right now. Please click Retry in a moment.',
          'chat'
        );
      } finally {
        cleanupAbort();
        releaseSlot();
      }
    }
  );

  // Unknown /api/* routes always return predictable JSON 404 (never index.html)
  app.all('/api/*', (_req, res) => {
    res.status(404).json({
      error: 'API endpoint not found.',
      code: 'NOT_FOUND',
      retryable: false,
    });
  });

  // Centralized body-parser / Express error handler (safe JSON, zero stack trace leaks)
  app.use(
    (
      err: Error & { status?: number; statusCode?: number; type?: string },
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (res.headersSent) {
        next(err);
        return;
      }
      const status = err.status ?? err.statusCode ?? 500;
      if (err.type === 'entity.too.large' || status === 413) {
        res.status(413).json({
          error: 'Request payload is too large for this endpoint.',
          code: 'PAYLOAD_TOO_LARGE',
          retryable: false,
        });
        return;
      }
      if (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && status === 400)) {
        res.status(400).json({
          error: 'Invalid JSON request payload.',
          code: 'INVALID_JSON',
          retryable: false,
        });
        return;
      }
      if (req.path.startsWith('/api/')) {
        console.error(`[MindFlow API Error] ${sanitizeLogString(err)}`);
        res.status(500).json({
          error: 'An unexpected server error occurred. Please try again.',
          code: 'INTERNAL_ERROR',
          retryable: true,
        });
        return;
      }
      next(err);
    }
  );

  if (isProduction) {
    const distDir =
      fs.existsSync(path.join(__dirname, 'index.html')) &&
      fs.existsSync(path.join(__dirname, 'assets'))
        ? __dirname
        : path.resolve(__dirname, 'dist');

    // Never expose the compiled backend server bundle when dist/server.js lives inside distDir
    app.use((req, res, next) => {
      const normalizedPath = req.path.toLowerCase();
      if (normalizedPath === '/server.js' || normalizedPath === '/server.js.map') {
        res.status(404).end();
        return;
      }
      next();
    });

    app.use(
      '/assets',
      express.static(path.join(distDir, 'assets'), {
        maxAge: '1y',
        immutable: true,
      })
    );
    app.use(
      express.static(distDir, {
        maxAge: '1h',
        index: false,
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);

    app.use('*', async (req, res, next) => {
      try {
        const template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (e) {
        next(e);
      }
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `MindFlow AI server listening on http://localhost:${PORT} (${isProduction ? 'production' : 'development'})`
    );
  });

  const gracefulShutdown = (signal: string) => {
    console.log(`Received ${signal}, closing MindFlow AI server gracefully...`);
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 8000).unref();
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

startServer();
