import { extractYouTubeId } from './youtube.ts';

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAfterSeconds: number;
}

/**
 * Memory-bounded sliding-window rate limiter keyed by client + endpoint.
 * Periodically prunes expired buckets to avoid unbounded memory growth.
 */
export class SlidingWindowRateLimiter {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly maxBuckets: number;
  private readonly buckets = new Map<string, number[]>();
  private checkCounter = 0;

  constructor(options: { windowMs: number; maxRequests: number; maxBuckets?: number }) {
    this.windowMs = Math.max(1000, options.windowMs);
    this.maxRequests = Math.max(1, options.maxRequests);
    this.maxBuckets = Math.max(100, options.maxBuckets ?? 5000);
  }

  check(key: string, now = Date.now()): RateLimitDecision {
    this.checkCounter += 1;
    if (this.checkCounter % 200 === 0 || this.buckets.size > this.maxBuckets) {
      this.prune(now);
    }

    const cutoff = now - this.windowMs;
    const existing = this.buckets.get(key) ?? [];
    const recent = existing.filter((ts) => ts > cutoff);

    if (recent.length >= this.maxRequests) {
      const oldest = recent[0] ?? now;
      const resetAfterMs = Math.max(1000, oldest + this.windowMs - now);
      this.buckets.set(key, recent);
      return {
        allowed: false,
        limit: this.maxRequests,
        remaining: 0,
        resetAfterSeconds: Math.ceil(resetAfterMs / 1000),
      };
    }

    recent.push(now);
    // Refresh insertion order for LRU eviction if bucket cap is hit
    this.buckets.delete(key);
    this.buckets.set(key, recent);

    if (this.buckets.size > this.maxBuckets) {
      const oldestKey = this.buckets.keys().next().value;
      if (oldestKey !== undefined) {
        this.buckets.delete(oldestKey);
      }
    }

    return {
      allowed: true,
      limit: this.maxRequests,
      remaining: Math.max(0, this.maxRequests - recent.length),
      resetAfterSeconds: Math.ceil(this.windowMs / 1000),
    };
  }

  prune(now = Date.now()): void {
    const cutoff = now - this.windowMs;
    for (const [key, timestamps] of this.buckets.entries()) {
      const recent = timestamps.filter((ts) => ts > cutoff);
      if (recent.length === 0) {
        this.buckets.delete(key);
      } else {
        this.buckets.set(key, recent);
      }
    }
  }
}

export type ConcurrencyAcquireResult =
  | { acquired: true; release: () => void }
  | { acquired: false; reason: 'client_limit' | 'server_busy' };

/**
 * Enforces global and per-client concurrency limits for expensive AI endpoints.
 */
export class ConcurrencyLimiter {
  private readonly maxGlobal: number;
  private readonly maxPerClient: number;
  private activeGlobal = 0;
  private readonly activeByClient = new Map<string, number>();

  constructor(options: { maxGlobal: number; maxPerClient: number }) {
    this.maxGlobal = Math.max(1, options.maxGlobal);
    this.maxPerClient = Math.max(1, options.maxPerClient);
  }

  acquire(clientKey: string): ConcurrencyAcquireResult {
    const clientCount = this.activeByClient.get(clientKey) ?? 0;
    if (clientCount >= this.maxPerClient) {
      return { acquired: false, reason: 'client_limit' };
    }
    if (this.activeGlobal >= this.maxGlobal) {
      return { acquired: false, reason: 'server_busy' };
    }

    this.activeGlobal += 1;
    this.activeByClient.set(clientKey, clientCount + 1);

    let released = false;
    return {
      acquired: true,
      release: () => {
        if (released) return;
        released = true;
        this.activeGlobal = Math.max(0, this.activeGlobal - 1);
        const current = this.activeByClient.get(clientKey) ?? 0;
        if (current <= 1) {
          this.activeByClient.delete(clientKey);
        } else {
          this.activeByClient.set(clientKey, current - 1);
        }
      },
    };
  }

  getStats(): { activeGlobal: number; activeClients: number } {
    return {
      activeGlobal: this.activeGlobal,
      activeClients: this.activeByClient.size,
    };
  }
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Bounded LRU cache with per-entry TTL for reusable AI outputs.
 */
export class TtlLruCache<T> {
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly store = new Map<string, CacheEntry<T>>();

  constructor(options: { maxEntries: number; ttlMs: number }) {
    this.maxEntries = Math.max(1, options.maxEntries);
    this.ttlMs = Math.max(1000, options.ttlMs);
  }

  get(key: string, now = Date.now()): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.store.delete(key);
      return undefined;
    }
    // Promote to most-recently-used
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, now = Date.now(), customTtlMs?: number): void {
    const ttl = Math.max(1000, customTtlMs ?? this.ttlMs);
    this.store.delete(key);
    this.store.set(key, { value, expiresAt: now + ttl });

    if (this.store.size > this.maxEntries) {
      this.prune(now);
      while (this.store.size > this.maxEntries) {
        const oldestKey = this.store.keys().next().value;
        if (oldestKey === undefined) break;
        this.store.delete(oldestKey);
      }
    }
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  prune(now = Date.now()): void {
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
      }
    }
  }

  get size(): number {
    return this.store.size;
  }
}

/**
 * Coalesces identical concurrent async operations so duplicate bursts share one upstream call.
 */
export class InFlightDeduplicator {
  private readonly pending = new Map<string, Promise<unknown>>();

  run<T>(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) {
      return existing as Promise<T>;
    }
    const promise = Promise.resolve()
      .then(factory)
      .finally(() => {
        if (this.pending.get(key) === promise) {
          this.pending.delete(key);
        }
      });
    this.pending.set(key, promise);
    return promise;
  }

  get activeCount(): number {
    return this.pending.size;
  }
}

const ALLOWED_CAPTION_HOSTS = new Set([
  'www.youtube.com',
  'youtube.com',
  'm.youtube.com',
  'video.google.com',
]);

/**
 * Strictly validates YouTube timedtext caption track URLs before server-side fetch.
 * Rejects non-HTTPS URLs, credentials, custom ports, private IPs, and non-YouTube hosts.
 */
export function isAllowedYouTubeCaptionUrl(rawUrl: string): boolean {
  if (typeof rawUrl !== 'string' || !rawUrl.trim() || rawUrl.length > 4096) {
    return false;
  }
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    if (parsed.port && parsed.port !== '443') return false;
    const host = parsed.hostname.toLowerCase();
    if (!ALLOWED_CAPTION_HOSTS.has(host)) return false;
    return (
      parsed.pathname === '/api/timedtext' ||
      parsed.pathname.startsWith('/api/timedtext/') ||
      parsed.pathname === '/timedtext'
    );
  } catch {
    return false;
  }
}

/**
 * Strictly validates that an optional user-supplied YouTube URL refers to an accepted YouTube link
 * and (if videoId is also supplied) matches that video ID.
 */
export function isAllowedYouTubeUserUrl(rawUrl: string, expectedVideoId?: string): boolean {
  if (typeof rawUrl !== 'string' || !rawUrl.trim() || rawUrl.length > 1024) {
    return false;
  }
  const extracted = extractYouTubeId(rawUrl);
  if (!extracted) return false;
  if (expectedVideoId && extracted !== expectedVideoId) {
    return false;
  }
  return true;
}

const ALLOWED_RASTER_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

/**
 * Allows only safe raster image MIME types in `/api/image-proxy` (explicitly blocks SVG/HTML).
 */
export function isAllowedRasterImageMime(contentType: string): boolean {
  if (typeof contentType !== 'string') return false;
  const normalized = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return ALLOWED_RASTER_IMAGE_MIMES.has(normalized);
}

/**
 * Streams a fetch Response into a Buffer while enforcing a hard byte limit.
 * Prevents oversized upstream responses from exhausting server memory.
 */
export async function readResponseBufferWithLimit(
  response: Response,
  maxBytes: number
): Promise<Buffer> {
  const declaredLen = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLen) && declaredLen > maxBytes) {
    throw new Error('RESPONSE_TOO_LARGE');
  }

  if (!response.body) {
    const ab = await response.arrayBuffer();
    if (ab.byteLength > maxBytes) {
      throw new Error('RESPONSE_TOO_LARGE');
    }
    return Buffer.from(ab);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
}

/**
 * Sanitizes text for server-side logs by redacting API keys, tokens, and auth headers.
 */
export function sanitizeLogString(input: unknown, maxLength = 400): string {
  const raw =
    input instanceof Error
      ? `${input.name}: ${input.message}`
      : typeof input === 'string'
        ? input
        : String(input ?? '');

  return raw
    .replace(/AIza[0-9A-Za-z_-]{16,}/g, '[REDACTED_API_KEY]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[REDACTED_TOKEN]')
    .replace(/([?&](?:api_?key|key|token|auth)=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(/(x-goog-api-key["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1[REDACTED]')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/**
 * Strips non-printable control characters while preserving tabs and line breaks.
 */
export function sanitizeUserText(input: unknown, maxLength: number): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLength);
}

/**
 * Determines whether a Gemini API failure is transient and safe to retry with backoff.
 * Never retries 400/401/403 or invalid-argument/safety failures.
 */
export function isRetryableGeminiError(error: unknown): boolean {
  const errObj = error as { status?: number; code?: number; message?: string } | null;
  const status = Number(errObj?.status ?? errObj?.code ?? 0);
  if (status === 400 || status === 401 || status === 403) return false;
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }

  const msg = error instanceof Error ? error.message : String(error ?? '');
  if (
    /INVALID_ARGUMENT|API_KEY_INVALID|PERMISSION_DENIED|UNAUTHENTICATED|SAFETY|RECITATION|400|401|403/i.test(
      msg
    )
  ) {
    return false;
  }
  return /503|502|504|500|429|UNAVAILABLE|RESOURCE_EXHAUSTED|INTERNAL|DEADLINE_EXCEEDED|overloaded|high demand|temporarily unavailable|timed out|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up/i.test(
    msg
  );
}

/**
 * Detects model-not-found or unsupported-parameter errors so fallback models can run cleanly.
 */
export function isModelFallbackNeeded(error: unknown): boolean {
  const errObj = error as { status?: number; code?: number } | null;
  const status = Number(errObj?.status ?? errObj?.code ?? 0);
  if (status === 404) return true;
  const msg = error instanceof Error ? error.message : String(error ?? '');
  return /404|NOT_FOUND|model.*not found|thinking_level|thinkingConfig|not supported for/i.test(
    msg
  );
}

export interface ClassifiedApiError {
  status: number;
  code: string;
  error: string;
  retryable: boolean;
  retryAfterSeconds?: number;
}

/**
 * Converts any internal or upstream Gemini error into a safe, predictable client payload
 * without exposing raw stack traces, internal hostnames, model internals, or secrets.
 */
export function classifyApiError(
  error: unknown,
  fallbackMessage: string
): ClassifiedApiError {
  const errObj = error as { status?: number; code?: number } | null;
  const statusNum = Number(errObj?.status ?? errObj?.code ?? 0);
  const raw = error instanceof Error ? error.message : String(error ?? '');

  if (statusNum === 429 || /429|RESOURCE_EXHAUSTED|quota|rate limit/i.test(raw)) {
    const retryMatch = raw.match(/retry(?:ing)? after (\d+)|reset in (\d+)|retryAfterSeconds["']?\s*:\s*(\d+)/i);
    const parsedDelay = retryMatch ? Number(retryMatch[1] || retryMatch[2] || retryMatch[3]) : undefined;
    const retryAfter = parsedDelay && parsedDelay > 0 && parsedDelay <= 300 ? parsedDelay : 15;
    return {
      status: 429,
      code: 'AI_RATE_LIMITED',
      error: 'AI quota is temporarily busy. Please wait a few seconds and try again.',
      retryable: true,
      retryAfterSeconds: retryAfter,
    };
  }

  if (
    statusNum === 503 ||
    /503|UNAVAILABLE|high demand|overloaded|temporarily unavailable/i.test(raw)
  ) {
    return {
      status: 503,
      code: 'AI_OVERLOADED',
      error:
        'The AI service is experiencing a temporary demand spike. Please click Retry in a moment.',
      retryable: true,
      retryAfterSeconds: 8,
    };
  }

  if (/timed out|DEADLINE_EXCEEDED|AbortError|ETIMEDOUT/i.test(raw)) {
    return {
      status: 504,
      code: 'AI_TIMEOUT',
      error: 'The AI request took too long to respond. Please retry.',
      retryable: true,
      retryAfterSeconds: 5,
    };
  }

  if (
    statusNum === 401 ||
    statusNum === 403 ||
    /API_KEY_INVALID|PERMISSION_DENIED|UNAUTHENTICATED|AI_NOT_CONFIGURED|GEMINI_API_KEY/i.test(raw)
  ) {
    return {
      status: 503,
      code: 'AI_AUTH_ERROR',
      error: 'AI service configuration is currently unavailable. Please check server settings.',
      retryable: false,
    };
  }

  if (/SAFETY|BLOCKED|RECITATION/i.test(raw)) {
    return {
      status: 422,
      code: 'CONTENT_BLOCKED',
      error: 'This request could not be answered due to safety restrictions. Try rephrasing your question.',
      retryable: false,
    };
  }

  if (/Could not parse structured JSON|Empty JSON response/i.test(raw)) {
    return {
      status: 502,
      code: 'AI_INVALID_RESPONSE',
      error: 'Received an incomplete AI response. Please click Retry.',
      retryable: true,
    };
  }

  return {
    status: 502,
    code: 'AI_UPSTREAM_ERROR',
    error: fallbackMessage,
    retryable: true,
  };
}

/**
 * Configures Express `trust proxy` safely for the deployment environment.
 * Avoids `true` (which trusts spoofed client headers blindly) and uses exact hop counts.
 */
export function resolveTrustProxySetting(
  env: Record<string, string | undefined>
): number | false {
  const raw = env.TRUST_PROXY_HOPS?.trim().toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'off') {
    return false;
  }
  if (raw && /^\d+$/.test(raw)) {
    const hops = Number.parseInt(raw, 10);
    if (hops >= 1 && hops <= 4) {
      return hops;
    }
  }
  // Cloud Run / hosted reverse-proxy environments sit behind 1 managed load balancer hop
  if (env.K_SERVICE || env.APP_URL || env.NODE_ENV === 'production') {
    return 1;
  }
  return false;
}

/**
 * Deterministic lightweight hash for cache keys (no crypto overhead needed for in-memory keys).
 */
export function hashCacheKey(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Evenly samples items across a collection while strictly preserving the first and last elements.
 * Guarantees 0% to 100% temporal coverage across long-video transcripts and node trees
 * without naive prefix truncation.
 */
export function sampleItemsStratified<T>(items: T[], maxItems: number): T[] {
  if (!Array.isArray(items) || items.length <= maxItems) return items;
  if (maxItems <= 2) return [items[0], items[items.length - 1]].filter(Boolean);

  const headBudget = Math.max(2, Math.floor(maxItems * 0.2));
  const tailBudget = Math.max(2, Math.floor(maxItems * 0.2));
  const middleBudget = maxItems - headBudget - tailBudget;

  const result: T[] = items.slice(0, headBudget);
  const middleItems = items.slice(headBudget, items.length - tailBudget);

  if (middleItems.length > 0 && middleBudget > 0) {
    const step = middleItems.length / middleBudget;
    for (let i = 0; i < middleBudget; i++) {
      const idx = Math.min(middleItems.length - 1, Math.floor(i * step));
      result.push(middleItems[idx]);
    }
  }

  for (let i = items.length - tailBudget; i < items.length; i++) {
    result.push(items[i]);
  }

  return result;
}

/**
 * Projects a LectureWorkspace down to the compact subset required by `/api/chat`
 * while preserving ALL educational fields read by `retrieveChatContext()`
 * (`tldw`, `nodes[].keyPoints`, `nodes[].subNodes`, `transcript[].lines`, and `cheatSheet`).
 * Uses balanced stratified sampling to preserve 0%–100% video timeline coverage so questions
 * about later chapters, conclusions, and end-of-lecture topics are answered accurately.
 */
export function compactWorkspaceForChat(
  workspace: Record<string, unknown>
): Record<string, unknown> {
  const compactKeyPoints = (raw: unknown) =>
    Array.isArray(raw)
      ? raw.slice(0, 10).map((kp) => {
          const item = (kp ?? {}) as Record<string, unknown>;
          return {
            keyword: typeof item.keyword === 'string' ? item.keyword.slice(0, 120) : '',
            detail: typeof item.detail === 'string' ? item.detail.slice(0, 320) : '',
          };
        })
      : [];

  const rawNodes = Array.isArray(workspace.nodes) ? workspace.nodes : [];
  const nodes = sampleItemsStratified(rawNodes, 100).map((raw) => {
    const n = (raw ?? {}) as Record<string, unknown>;
    const rawSubNodes = Array.isArray(n.subNodes) ? n.subNodes : [];
    return {
      id: typeof n.id === 'string' ? n.id.slice(0, 48) : '',
      title: typeof n.title === 'string' ? n.title.slice(0, 180) : '',
      shortSubtitle: typeof n.shortSubtitle === 'string' ? n.shortSubtitle.slice(0, 220) : '',
      timestampLabel: typeof n.timestampLabel === 'string' ? n.timestampLabel.slice(0, 16) : '00:00',
      timestampSeconds: typeof n.timestampSeconds === 'number' ? n.timestampSeconds : 0,
      isRoot: Boolean(n.isRoot),
      keyPoints: compactKeyPoints(n.keyPoints),
      realLifeExample:
        typeof n.realLifeExample === 'string' ? n.realLifeExample.slice(0, 360) : undefined,
      simplifiedAnalogy:
        typeof n.simplifiedAnalogy === 'string' ? n.simplifiedAnalogy.slice(0, 360) : undefined,
      subNodes: sampleItemsStratified(rawSubNodes, 12).map((sub) => {
        const s = (sub ?? {}) as Record<string, unknown>;
        return {
          id: typeof s.id === 'string' ? s.id.slice(0, 48) : '',
          title: typeof s.title === 'string' ? s.title.slice(0, 160) : '',
          shortSubtitle:
            typeof s.shortSubtitle === 'string' ? s.shortSubtitle.slice(0, 200) : '',
          timestampLabel:
            typeof s.timestampLabel === 'string' ? s.timestampLabel.slice(0, 16) : undefined,
          timestampSeconds:
            typeof s.timestampSeconds === 'number' ? s.timestampSeconds : undefined,
          keyPoints: compactKeyPoints(s.keyPoints),
          realLifeExample:
            typeof s.realLifeExample === 'string' ? s.realLifeExample.slice(0, 300) : undefined,
        };
      }),
    };
  });

  const rawTranscript = Array.isArray(workspace.transcript) ? workspace.transcript : [];
  const transcript = sampleItemsStratified(rawTranscript, 100).map((raw) => {
    const sec = (raw ?? {}) as Record<string, unknown>;
    const rawLines = Array.isArray(sec.lines) ? sec.lines : [];
    return {
      id: typeof sec.id === 'string' ? sec.id.slice(0, 48) : '',
      nodeId: typeof sec.nodeId === 'string' ? sec.nodeId.slice(0, 48) : '',
      title: typeof sec.title === 'string' ? sec.title.slice(0, 180) : '',
      topicTag: typeof sec.topicTag === 'string' ? sec.topicTag.slice(0, 80) : '',
      startLabel: typeof sec.startLabel === 'string' ? sec.startLabel.slice(0, 16) : '00:00',
      startSeconds: typeof sec.startSeconds === 'number' ? sec.startSeconds : 0,
      endLabel: typeof sec.endLabel === 'string' ? sec.endLabel.slice(0, 16) : undefined,
      endSeconds: typeof sec.endSeconds === 'number' ? sec.endSeconds : undefined,
      keyTakeaway:
        typeof sec.keyTakeaway === 'string' ? sec.keyTakeaway.slice(0, 320) : undefined,
      lines: sampleItemsStratified(rawLines, 25).map((rawLine) => {
        const line = (rawLine ?? {}) as Record<string, unknown>;
        return {
          id: typeof line.id === 'string' ? line.id.slice(0, 48) : '',
          timestampLabel:
            typeof line.timestampLabel === 'string' ? line.timestampLabel.slice(0, 16) : '00:00',
          timestampSeconds:
            typeof line.timestampSeconds === 'number' ? line.timestampSeconds : 0,
          text: typeof line.text === 'string' ? line.text.slice(0, 420) : '',
        };
      }),
    };
  });

  const rawCheat = workspace.cheatSheet as Record<string, unknown> | undefined;
  const cheatSheet =
    rawCheat && typeof rawCheat === 'object'
      ? {
          definitions: Array.isArray(rawCheat.definitions)
            ? rawCheat.definitions.slice(0, 24)
            : [],
          keyRulesOrSteps: Array.isArray(rawCheat.keyRulesOrSteps)
            ? rawCheat.keyRulesOrSteps.slice(0, 16)
            : [],
          commonMistakes: Array.isArray(rawCheat.commonMistakes)
            ? rawCheat.commonMistakes.slice(0, 12)
            : [],
          quickRevisionPoints: Array.isArray(rawCheat.quickRevisionPoints)
            ? rawCheat.quickRevisionPoints.slice(0, 16).map((p) => String(p).slice(0, 260))
            : [],
          realWorldExamples: Array.isArray(rawCheat.realWorldExamples)
            ? rawCheat.realWorldExamples.slice(0, 10)
            : [],
        }
      : undefined;

  const tldw = Array.isArray(workspace.tldw)
    ? workspace.tldw.slice(0, 8).map((item) => String(item).slice(0, 300))
    : typeof workspace.tldw === 'string'
      ? [workspace.tldw.slice(0, 600)]
      : [];

  return {
    videoId: typeof workspace.videoId === 'string' ? workspace.videoId.slice(0, 64) : '',
    title: typeof workspace.title === 'string' ? workspace.title.slice(0, 240) : '',
    channel: typeof workspace.channel === 'string' ? workspace.channel.slice(0, 120) : '',
    videoCategory: typeof workspace.videoCategory === 'string' ? workspace.videoCategory.slice(0, 80) : '',
    durationLabel: typeof workspace.durationLabel === 'string' ? workspace.durationLabel.slice(0, 20) : '',
    videoDurationSeconds:
      typeof workspace.videoDurationSeconds === 'number' ? workspace.videoDurationSeconds : 0,
    tldw,
    nodes,
    transcript,
    cheatSheet,
  };
}
