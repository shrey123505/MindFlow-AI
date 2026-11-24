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

interface InFlightEntry<T> {
  promise: Promise<T>;
  controller: AbortController;
  waiters: number;
}

/**
 * Coalesces identical concurrent async operations so duplicate bursts share one upstream call.
 * Subscriber-aware cancellation:
 * - Each caller may pass an optional AbortSignal (e.g. from an HTTP response close event).
 * - If one caller disconnects while another caller is still waiting on the same key, only the
 *   disconnected caller rejects — the shared upstream call continues for remaining waiters.
 * - If ALL active callers disconnect, the shared AbortController aborts the upstream work.
 */
export class InFlightDeduplicator {
  private readonly pending = new Map<string, InFlightEntry<unknown>>();

  run<T>(
    key: string,
    factory: (sharedSignal: AbortSignal) => Promise<T>,
    options?: { signal?: AbortSignal }
  ): Promise<T> {
    const callerSignal = options?.signal;
    if (callerSignal?.aborted) {
      return Promise.reject(callerSignal.reason ?? new Error('Request aborted.'));
    }

    let entry = this.pending.get(key) as InFlightEntry<T> | undefined;
    if (!entry) {
      const controller = new AbortController();
      const created: InFlightEntry<T> = {
        controller,
        waiters: 0,
        promise: Promise.resolve() as Promise<T>,
      };
      created.promise = Promise.resolve()
        .then(() => factory(controller.signal))
        .finally(() => {
          if (this.pending.get(key) === created) {
            this.pending.delete(key);
          }
        });
      // Prevent unhandled rejection when all callers already detached after abort
      created.promise.catch(() => {});
      this.pending.set(key, created as InFlightEntry<unknown>);
      entry = created;
    }

    entry.waiters += 1;
    const currentEntry = entry;

    if (!callerSignal) {
      return currentEntry.promise.finally(() => {
        currentEntry.waiters = Math.max(0, currentEntry.waiters - 1);
      });
    }

    return new Promise<T>((resolve, reject) => {
      let settled = false;

      const detachWaiter = (aborted: boolean) => {
        if (settled) return;
        settled = true;
        callerSignal.removeEventListener('abort', onCallerAbort);
        currentEntry.waiters = Math.max(0, currentEntry.waiters - 1);
        if (aborted && currentEntry.waiters === 0 && !currentEntry.controller.signal.aborted) {
          currentEntry.controller.abort(
            callerSignal.reason ?? new Error('All clients disconnected.')
          );
        }
      };

      const onCallerAbort = () => {
        const reason = callerSignal.reason ?? new Error('Client connection closed.');
        detachWaiter(true);
        reject(reason);
      };

      callerSignal.addEventListener('abort', onCallerAbort, { once: true });

      currentEntry.promise.then(
        (val) => {
          if (settled) return;
          detachWaiter(false);
          resolve(val);
        },
        (err) => {
          if (settled) return;
          detachWaiter(false);
          reject(err);
        }
      );
    });
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

export type GeminiFailureKind =
  | 'quota_exhausted'
  | 'rate_limited'
  | 'capacity_overloaded'
  | 'model_unsupported'
  | 'aborted'
  | 'non_retryable';

/**
 * Extracts provider-suggested retry delay in seconds from error messages, details, or headers.
 * Returns undefined if no bounded positive delay hint is present.
 */
export function parseRetryAfterSeconds(error: unknown): number | undefined {
  const errObj = error as {
    retryAfterSeconds?: unknown;
    headers?: { get?: (k: string) => string | null } | Record<string, string | undefined>;
    message?: string;
  } | null;

  if (typeof errObj?.retryAfterSeconds === 'number' && errObj.retryAfterSeconds > 0) {
    return Math.min(300, Math.ceil(errObj.retryAfterSeconds));
  }

  const rawHeader =
    typeof errObj?.headers === 'object' && errObj.headers
      ? typeof (errObj.headers as { get?: (k: string) => string | null }).get === 'function'
        ? (errObj.headers as { get: (k: string) => string | null }).get('retry-after')
        : (errObj.headers as Record<string, string | undefined>)['retry-after'] ??
          (errObj.headers as Record<string, string | undefined>)['Retry-After']
      : undefined;

  if (rawHeader && /^\d+(?:\.\d+)?$/.test(rawHeader.trim())) {
    const secs = Math.ceil(Number(rawHeader.trim()));
    if (secs > 0 && secs <= 300) return secs;
  }

  const raw = error instanceof Error ? error.message : String(error ?? '');
  const patterns = [
    /retry(?:ing)?\s+(?:after|in)\s+(\d+(?:\.\d+)?)\s*s?/i,
    /reset\s+in\s+(\d+(?:\.\d+)?)\s*s?/i,
    /retryDelay["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)s?["']?/i,
    /retryAfterSeconds["']?\s*[:=]\s*(\d+(?:\.\d+)?)/i,
  ];
  for (const regex of patterns) {
    const match = raw.match(regex);
    if (match?.[1]) {
      const secs = Math.ceil(Number(match[1]));
      if (Number.isFinite(secs) && secs > 0 && secs <= 300) {
        return secs;
      }
    }
  }
  return undefined;
}

/**
 * Classifies Gemini upstream failures so 429 hard quota exhaustion, 429 transient rate limits,
 * 503 capacity spikes, 404 model/config mismatches, aborts, and non-retryable 4xx errors
 * follow strictly separate retry and fallback policies.
 */
export function classifyGeminiFailure(error: unknown): {
  kind: GeminiFailureKind;
  retryAfterSeconds?: number;
} {
  const errObj = error as { status?: number; code?: number; name?: string; message?: string } | null;
  const status = Number(errObj?.status ?? errObj?.code ?? 0);
  const msg = error instanceof Error ? error.message : String(error ?? '');
  const retryAfterSeconds = parseRetryAfterSeconds(error);

  if (
    errObj?.name === 'AbortError' &&
    !/timed out|DEADLINE_EXCEEDED/i.test(msg)
  ) {
    return { kind: 'aborted' };
  }
  if (/Client connection closed|Client aborted request|All clients disconnected|Request aborted/i.test(msg)) {
    return { kind: 'aborted' };
  }

  if (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    /INVALID_ARGUMENT|API_KEY_INVALID|PERMISSION_DENIED|UNAUTHENTICATED|SAFETY|RECITATION|\b400\b|\b401\b|\b403\b/i.test(
      msg
    )
  ) {
    return { kind: 'non_retryable' };
  }

  if (
    status === 404 ||
    /\b404\b|NOT_FOUND|model.*not found|thinking_level|thinkingConfig|not supported for/i.test(msg)
  ) {
    return { kind: 'model_unsupported' };
  }

  if (status === 429 || /\b429\b|RESOURCE_EXHAUSTED|quota|rate limit/i.test(msg)) {
    const looksLikeHardQuota =
      /daily.*limit|per day|perday|quota.*exhausted|insufficient.*quota|limit:\s*0|free_tier_requests.*limit:\s*0/i.test(
        msg
      );

    if (looksLikeHardQuota) {
      return { kind: 'quota_exhausted', retryAfterSeconds };
    }
    return { kind: 'rate_limited', retryAfterSeconds };
  }

  if (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /\b503\b|\b502\b|\b504\b|\b500\b|UNAVAILABLE|INTERNAL|DEADLINE_EXCEEDED|overloaded|high demand|temporarily unavailable|timed out|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up/i.test(
      msg
    )
  ) {
    return { kind: 'capacity_overloaded', retryAfterSeconds };
  }

  return { kind: 'non_retryable' };
}

/**
 * Determines whether a Gemini API failure is transient and safe to retry with backoff.
 * Never retries 400/401/403, invalid-argument/safety failures, aborts, or hard daily quota exhaustion.
 */
export function isRetryableGeminiError(error: unknown): boolean {
  const { kind } = classifyGeminiFailure(error);
  return kind === 'rate_limited' || kind === 'capacity_overloaded';
}

/**
 * Detects model-not-found or unsupported-parameter errors so fallback models can run cleanly.
 */
export function isModelFallbackNeeded(error: unknown): boolean {
  return classifyGeminiFailure(error).kind === 'model_unsupported';
}

/**
 * Abort-aware sleep that resolves after `ms` or rejects immediately if `signal` aborts.
 */
export function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return signal?.aborted
      ? Promise.reject(signal.reason ?? new Error('Request aborted.'))
      : Promise.resolve();
  }
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new Error('Request aborted.'));
  }

  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('Request aborted.'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface ExecuteWithGeminiRetryOptions<T> {
  models: readonly string[];
  invoke: (model: string, attemptSignal: AbortSignal) => Promise<T>;
  timeoutMs?: number;
  maxRounds?: number;
  parentSignal?: AbortSignal;
  sleepFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
  randomFn?: () => number;
}

/**
 * Deterministic, bounded Gemini execution loop with real per-attempt AbortSignal cancellation:
 * - Passes an AbortController signal to every attempt and aborts it on timeout or failure so
 *   earlier attempts do not overlap with retries/fallbacks.
 * - Immediately cancels on `parentSignal` abort (including during retry backoff sleep).
 * - Handles 429 hard quota exhaustion separately from 429 transient rate limits and 503 capacity:
 *   - `quota_exhausted`: Gemini quotas are per-model (`gemini-4-hydrogen` vs `gemini-3.1-flash-lite`),
 *     so it tries each configured fallback model once before failing fast without extra rounds.
 *   - `rate_limited`: respects provider retry delay (capped at 12s) with 1 bounded retry, then falls
 *     back to the next configured model if available.
 *   - `capacity_overloaded`: bounded exponential backoff + jitter with fallback across configured models.
 *   - `model_unsupported`: immediate fallback to next configured model.
 *   - `non_retryable`: fails fast immediately with 0 retries and 0 fallback.
 */
export async function executeWithGeminiRetry<T>(
  options: ExecuteWithGeminiRetryOptions<T>
): Promise<T> {
  const {
    models,
    invoke,
    timeoutMs = 24_000,
    maxRounds = 2,
    parentSignal,
    sleepFn = sleepWithSignal,
    randomFn = Math.random,
  } = options;

  if (!Array.isArray(models) || models.length === 0) {
    throw new Error('No Gemini models configured.');
  }

  const perAttemptTimeout = Math.max(50, Math.min(timeoutMs, 45_000));
  const boundedRounds = Math.max(1, Math.min(maxRounds, 3));
  let lastError: unknown = null;
  let primaryTransientError: unknown = null;
  let rateLimitRetriesUsed = 0;

  for (let round = 0; round < boundedRounds; round++) {
    for (let i = 0; i < models.length; i++) {
      if (parentSignal?.aborted) {
        throw parentSignal.reason ?? new Error('Client aborted request.');
      }

      const model = models[i];
      const attemptController = new AbortController();
      let didTimeout = false;
      const timer = setTimeout(() => {
        didTimeout = true;
        attemptController.abort(
          new Error(`Gemini (${model}) timed out after ${Math.max(1, Math.round(perAttemptTimeout / 1000))}s`)
        );
      }, perAttemptTimeout);

      const onParentAbort = () => {
        attemptController.abort(parentSignal?.reason ?? new Error('Client aborted request.'));
      };
      parentSignal?.addEventListener('abort', onParentAbort, { once: true });

      try {
        const result = await invoke(model, attemptController.signal);
        clearTimeout(timer);
        return result;
      } catch (err) {
        clearTimeout(timer);
        if (!attemptController.signal.aborted) {
          attemptController.abort();
        }

        if (parentSignal?.aborted) {
          throw parentSignal.reason ?? err;
        }

        const effectiveErr = didTimeout
          ? new Error(`Gemini (${model}) timed out after ${Math.max(1, Math.round(perAttemptTimeout / 1000))}s`)
          : err;

        lastError = effectiveErr;
        const { kind, retryAfterSeconds } = classifyGeminiFailure(effectiveErr);

        if (kind === 'aborted' || kind === 'non_retryable') {
          throw effectiveErr;
        }

        const isLastModel = i === models.length - 1;
        const isLastRound = round === boundedRounds - 1;

        // Per-model daily / limit:0 quota exhaustion: try the next configured model (which has its own
        // separate Gemini quota bucket) before failing fast without extra rounds.
        if (kind === 'quota_exhausted') {
          if (!isLastModel) {
            continue;
          }
          throw effectiveErr;
        }

        if (kind === 'rate_limited') {
          if (!primaryTransientError) primaryTransientError = effectiveErr;
          // At most 1 bounded retry for transient RPM/TPM limits when Retry-After <= 15s;
          // if the retry is already used or Retry-After > 15s, fall back to the next model if available.
          if (rateLimitRetriesUsed >= 1 || (retryAfterSeconds !== undefined && retryAfterSeconds > 15)) {
            if (!isLastModel) {
              continue;
            }
            throw effectiveErr;
          }
          rateLimitRetriesUsed += 1;
          const baseDelayMs =
            retryAfterSeconds !== undefined
              ? Math.min(12_000, retryAfterSeconds * 1000)
              : 1800;
          const jitter = Math.floor(randomFn() * 250);
          await sleepFn(baseDelayMs + jitter, parentSignal);
          // Retry the same model once before falling back to the next model
          i -= 1;
          continue;
        }

        if (kind === 'model_unsupported') {
          if (isLastModel) {
            throw primaryTransientError ?? effectiveErr;
          }
          // Immediate fallback to next configured model
          continue;
        }

        // capacity_overloaded (503/502/504/timeout/network)
        if (!primaryTransientError) primaryTransientError = effectiveErr;
        if (isLastModel && isLastRound) {
          throw primaryTransientError ?? effectiveErr;
        }

        const exponentialBase = isLastModel
          ? Math.min(8_000, 900 * Math.pow(2, round))
          : 300;
        const hintDelayMs =
          retryAfterSeconds !== undefined && retryAfterSeconds <= 12
            ? retryAfterSeconds * 1000
            : 0;
        const delayMs = Math.max(exponentialBase, hintDelayMs);
        const jitter = Math.floor(randomFn() * 200);
        await sleepFn(delayMs + jitter, parentSignal);
      } finally {
        parentSignal?.removeEventListener('abort', onParentAbort);
      }
    }
  }

  throw primaryTransientError ?? lastError ?? new Error('Gemini request failed.');
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
  const errObj = error as { status?: number; code?: number; name?: string } | null;
  const statusNum = Number(errObj?.status ?? errObj?.code ?? 0);
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const { kind, retryAfterSeconds } = classifyGeminiFailure(error);

  if (kind === 'aborted') {
    return {
      status: 499,
      code: 'REQUEST_ABORTED',
      error: 'The request was cancelled before completion.',
      retryable: false,
    };
  }

  if (kind === 'quota_exhausted') {
    return {
      status: 429,
      code: 'AI_QUOTA_EXHAUSTED',
      error:
        'The configured Gemini API quota is exhausted right now. Please wait for quota reset or check API billing/quota limits.',
      retryable: false,
      ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
    };
  }

  if (kind === 'rate_limited' || statusNum === 429 || /\b429\b|RESOURCE_EXHAUSTED|quota|rate limit/i.test(raw)) {
    const retryAfter = retryAfterSeconds && retryAfterSeconds <= 300 ? retryAfterSeconds : 15;
    return {
      status: 429,
      code: 'AI_RATE_LIMITED',
      error: `AI rate limit reached. Please wait ${retryAfter}s and try again.`,
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
        'The AI service is temporarily unavailable due to high demand. Please click Retry in a moment.',
      retryable: true,
      retryAfterSeconds: retryAfterSeconds && retryAfterSeconds <= 60 ? retryAfterSeconds : 8,
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
 * Computes a bounded, deterministic dual-lane content fingerprint over the entire relevant
 * workspace structure (identity, tldw, ALL mindmap nodes & subNodes, ALL transcript sections
 * & lines, and cheatSheet items).
 * - Guarantees that edits to later nodes, subNodes, cheatSheet entries, or transcript lines
 *   invalidate stale cached chat/translate/visual-guide responses.
 * - Caps total scanned characters (`maxCharsScanned`, default 256 KB) so CPU work stays O(N) bounded.
 */
export function computeWorkspaceContentFingerprint(
  workspace: Record<string, unknown>,
  maxCharsScanned = 256_000
): string {
  let h1 = 2166136261 >>> 0;
  let h2 = 0x811c9dc5 ^ 0x9e3779b9;
  let scanned = 0;

  const feed = (raw: unknown): void => {
    if (scanned >= maxCharsScanned) return;
    const str = raw === undefined || raw === null ? '' : String(raw);
    const remaining = maxCharsScanned - scanned;
    const limit = Math.min(str.length, remaining);
    for (let i = 0; i < limit; i++) {
      const code = str.charCodeAt(i);
      h1 ^= code;
      h1 = Math.imul(h1, 16777619) >>> 0;
      h2 = (Math.imul(h2 ^ (code + i), 2246822519) + 3266489917) >>> 0;
    }
    // Field delimiter so ["ab", "c"] !== ["a", "bc"]
    h1 ^= 0x1f;
    h1 = Math.imul(h1, 16777619) >>> 0;
    h2 ^= 0x1f;
    h2 = Math.imul(h2, 2246822519) >>> 0;
    scanned += limit;
  };

  feed(workspace.videoId ?? '');
  feed(workspace.title ?? '');
  feed(workspace.channel ?? '');
  feed(workspace.language ?? '');
  feed(workspace.videoDurationSeconds ?? 0);

  const tldw = Array.isArray(workspace.tldw) ? workspace.tldw : [];
  feed(`tldw:${tldw.length}`);
  for (const item of tldw) {
    feed(item);
  }

  const nodes = Array.isArray(workspace.nodes) ? workspace.nodes : [];
  feed(`nodes:${nodes.length}`);
  for (const rawNode of nodes) {
    const n = (rawNode ?? {}) as Record<string, unknown>;
    feed(n.id ?? '');
    feed(n.title ?? '');
    feed(n.shortSubtitle ?? '');
    feed(n.timestampSeconds ?? 0);
    feed(n.realLifeExample ?? '');
    feed(n.simplifiedAnalogy ?? '');
    const kps = Array.isArray(n.keyPoints) ? n.keyPoints : [];
    for (const rawKp of kps) {
      if (typeof rawKp === 'string') {
        feed(rawKp);
      } else {
        const kp = (rawKp ?? {}) as Record<string, unknown>;
        feed(kp.keyword ?? '');
        feed(kp.detail ?? '');
      }
    }
    const subs = Array.isArray(n.subNodes) ? n.subNodes : [];
    feed(`subs:${subs.length}`);
    for (const rawSub of subs) {
      const s = (rawSub ?? {}) as Record<string, unknown>;
      feed(s.id ?? '');
      feed(s.title ?? '');
      feed(s.shortSubtitle ?? '');
      feed(s.timestampSeconds ?? 0);
      const subKps = Array.isArray(s.keyPoints) ? s.keyPoints : [];
      for (const rawSkp of subKps) {
        if (typeof rawSkp === 'string') {
          feed(rawSkp);
        } else {
          const skp = (rawSkp ?? {}) as Record<string, unknown>;
          feed(skp.keyword ?? '');
          feed(skp.detail ?? '');
        }
      }
    }
  }

  const transcript = Array.isArray(workspace.transcript) ? workspace.transcript : [];
  feed(`tr:${transcript.length}`);
  for (const rawSec of transcript) {
    const sec = (rawSec ?? {}) as Record<string, unknown>;
    feed(sec.id ?? '');
    feed(sec.title ?? '');
    feed(sec.startSeconds ?? 0);
    feed(sec.keyTakeaway ?? '');
    const lines = Array.isArray(sec.lines) ? sec.lines : [];
    feed(`ln:${lines.length}`);
    for (const rawLine of lines) {
      const l = (rawLine ?? {}) as Record<string, unknown>;
      feed(l.timestampSeconds ?? 0);
      feed(l.text ?? '');
    }
  }

  const cs = (workspace.cheatSheet ?? {}) as Record<string, unknown>;
  const defs = Array.isArray(cs.definitions) ? cs.definitions : [];
  feed(`defs:${defs.length}`);
  for (const rawDef of defs) {
    const d = (rawDef ?? {}) as Record<string, unknown>;
    feed(d.term ?? '');
    feed(d.summary ?? '');
    feed(d.formulaOrNote ?? '');
  }
  const rules = Array.isArray(cs.keyRulesOrSteps) ? cs.keyRulesOrSteps : [];
  feed(`rules:${rules.length}`);
  for (const rawRule of rules) {
    const r = (rawRule ?? {}) as Record<string, unknown>;
    feed(r.title ?? '');
    feed(r.detail ?? '');
  }
  const mistakes = Array.isArray(cs.commonMistakes) ? cs.commonMistakes : [];
  feed(`mistakes:${mistakes.length}`);
  for (const rawM of mistakes) {
    const m = (rawM ?? {}) as Record<string, unknown>;
    feed(m.mistake ?? '');
    feed(m.correction ?? '');
  }
  const quickRev = Array.isArray(cs.quickRevision) ? cs.quickRevision : [];
  feed(`qrev:${quickRev.length}`);
  for (const item of quickRev) {
    feed(item);
  }
  const examples = Array.isArray(cs.examples) ? cs.examples : [];
  feed(`ex:${examples.length}`);
  for (const rawEx of examples) {
    const ex = (rawEx ?? {}) as Record<string, unknown>;
    feed(ex.scenario ?? '');
    feed(ex.explanation ?? '');
  }

  return `${(h1 >>> 0).toString(36)}-${(h2 >>> 0).toString(36)}-${nodes.length}n${transcript.length}t`;
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

/** Measures UTF-8 byte length safely in both browser and Node.js runtimes. */
export function measureUtf8Bytes(input: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(input).length;
  }
  return input.length * 2;
}

/** Default maximum UTF-8 serialized byte budget for the workspace sent to /api/chat (express limit is 512 KB). */
export const MAX_CHAT_WORKSPACE_BYTES = 320 * 1024;

/** Default maximum UTF-8 serialized byte budget for the workspace sent to /api/generate-visual-guide (express limit is 1 MB). */
export const MAX_VISUAL_GUIDE_WORKSPACE_BYTES = 680 * 1024;

interface CompactionTier {
  maxNodes: number;
  maxSubNodes: number;
  maxKeyPoints: number;
  kpDetailChars: number;
  maxSections: number;
  maxLinesPerSection: number;
  lineChars: number;
  maxDefs: number;
  maxRules: number;
  maxMistakes: number;
  maxRevision: number;
  maxExamples: number;
}

const COMPACTION_TIERS: CompactionTier[] = [
  {
    maxNodes: 100,
    maxSubNodes: 12,
    maxKeyPoints: 10,
    kpDetailChars: 320,
    maxSections: 100,
    maxLinesPerSection: 25,
    lineChars: 420,
    maxDefs: 24,
    maxRules: 16,
    maxMistakes: 12,
    maxRevision: 16,
    maxExamples: 10,
  },
  {
    maxNodes: 64,
    maxSubNodes: 8,
    maxKeyPoints: 6,
    kpDetailChars: 240,
    maxSections: 72,
    maxLinesPerSection: 12,
    lineChars: 280,
    maxDefs: 20,
    maxRules: 12,
    maxMistakes: 10,
    maxRevision: 12,
    maxExamples: 8,
  },
  {
    maxNodes: 40,
    maxSubNodes: 5,
    maxKeyPoints: 4,
    kpDetailChars: 180,
    maxSections: 48,
    maxLinesPerSection: 6,
    lineChars: 200,
    maxDefs: 14,
    maxRules: 8,
    maxMistakes: 6,
    maxRevision: 8,
    maxExamples: 6,
  },
  {
    maxNodes: 24,
    maxSubNodes: 3,
    maxKeyPoints: 3,
    kpDetailChars: 140,
    maxSections: 30,
    maxLinesPerSection: 3,
    lineChars: 150,
    maxDefs: 10,
    maxRules: 6,
    maxMistakes: 4,
    maxRevision: 6,
    maxExamples: 4,
  },
  {
    maxNodes: 16,
    maxSubNodes: 2,
    maxKeyPoints: 2,
    kpDetailChars: 100,
    maxSections: 18,
    maxLinesPerSection: 2,
    lineChars: 110,
    maxDefs: 8,
    maxRules: 4,
    maxMistakes: 3,
    maxRevision: 5,
    maxExamples: 3,
  },
];

function projectWorkspaceAtTier(
  workspace: Record<string, unknown>,
  tier: CompactionTier
): Record<string, unknown> {
  const compactKeyPoints = (raw: unknown) =>
    Array.isArray(raw)
      ? raw.slice(0, tier.maxKeyPoints).map((kp) => {
          const item = (kp ?? {}) as Record<string, unknown>;
          return {
            keyword: typeof item.keyword === 'string' ? item.keyword.slice(0, 100) : '',
            detail:
              typeof item.detail === 'string' ? item.detail.slice(0, tier.kpDetailChars) : '',
          };
        })
      : [];

  const rawNodes = Array.isArray(workspace.nodes) ? workspace.nodes : [];
  const nodes = sampleItemsStratified(rawNodes, tier.maxNodes).map((raw) => {
    const n = (raw ?? {}) as Record<string, unknown>;
    const rawSubNodes = Array.isArray(n.subNodes) ? n.subNodes : [];
    return {
      id: typeof n.id === 'string' ? n.id.slice(0, 48) : '',
      title: typeof n.title === 'string' ? n.title.slice(0, 160) : '',
      shortSubtitle: typeof n.shortSubtitle === 'string' ? n.shortSubtitle.slice(0, 200) : '',
      timestampLabel: typeof n.timestampLabel === 'string' ? n.timestampLabel.slice(0, 16) : '00:00',
      timestampSeconds: typeof n.timestampSeconds === 'number' ? n.timestampSeconds : 0,
      isRoot: Boolean(n.isRoot),
      keyPoints: compactKeyPoints(n.keyPoints),
      realLifeExample:
        typeof n.realLifeExample === 'string'
          ? n.realLifeExample.slice(0, Math.min(320, tier.kpDetailChars + 40))
          : undefined,
      simplifiedAnalogy:
        typeof n.simplifiedAnalogy === 'string'
          ? n.simplifiedAnalogy.slice(0, Math.min(320, tier.kpDetailChars + 40))
          : undefined,
      subNodes: sampleItemsStratified(rawSubNodes, tier.maxSubNodes).map((sub) => {
        const s = (sub ?? {}) as Record<string, unknown>;
        return {
          id: typeof s.id === 'string' ? s.id.slice(0, 48) : '',
          title: typeof s.title === 'string' ? s.title.slice(0, 140) : '',
          shortSubtitle:
            typeof s.shortSubtitle === 'string' ? s.shortSubtitle.slice(0, 180) : '',
          timestampLabel:
            typeof s.timestampLabel === 'string' ? s.timestampLabel.slice(0, 16) : undefined,
          timestampSeconds:
            typeof s.timestampSeconds === 'number' ? s.timestampSeconds : undefined,
          keyPoints: compactKeyPoints(s.keyPoints),
          realLifeExample:
            typeof s.realLifeExample === 'string'
              ? s.realLifeExample.slice(0, Math.min(260, tier.kpDetailChars))
              : undefined,
        };
      }),
    };
  });

  const rawTranscript = Array.isArray(workspace.transcript) ? workspace.transcript : [];
  const transcript = sampleItemsStratified(rawTranscript, tier.maxSections).map((raw) => {
    const sec = (raw ?? {}) as Record<string, unknown>;
    const rawLines = Array.isArray(sec.lines) ? sec.lines : [];
    return {
      id: typeof sec.id === 'string' ? sec.id.slice(0, 48) : '',
      nodeId: typeof sec.nodeId === 'string' ? sec.nodeId.slice(0, 48) : '',
      title: typeof sec.title === 'string' ? sec.title.slice(0, 160) : '',
      topicTag: typeof sec.topicTag === 'string' ? sec.topicTag.slice(0, 64) : '',
      startLabel: typeof sec.startLabel === 'string' ? sec.startLabel.slice(0, 16) : '00:00',
      startSeconds: typeof sec.startSeconds === 'number' ? sec.startSeconds : 0,
      endLabel: typeof sec.endLabel === 'string' ? sec.endLabel.slice(0, 16) : undefined,
      endSeconds: typeof sec.endSeconds === 'number' ? sec.endSeconds : undefined,
      keyTakeaway:
        typeof sec.keyTakeaway === 'string' ? sec.keyTakeaway.slice(0, 260) : undefined,
      lines: sampleItemsStratified(rawLines, tier.maxLinesPerSection).map((rawLine) => {
        const line = (rawLine ?? {}) as Record<string, unknown>;
        return {
          id: typeof line.id === 'string' ? line.id.slice(0, 48) : '',
          timestampLabel:
            typeof line.timestampLabel === 'string' ? line.timestampLabel.slice(0, 16) : '00:00',
          timestampSeconds:
            typeof line.timestampSeconds === 'number' ? line.timestampSeconds : 0,
          text: typeof line.text === 'string' ? line.text.slice(0, tier.lineChars) : '',
        };
      }),
    };
  });

  const rawCheat = workspace.cheatSheet as Record<string, unknown> | undefined;
  const cheatSheet =
    rawCheat && typeof rawCheat === 'object'
      ? {
          definitions: Array.isArray(rawCheat.definitions)
            ? sampleItemsStratified(rawCheat.definitions, tier.maxDefs)
            : [],
          keyRulesOrSteps: Array.isArray(rawCheat.keyRulesOrSteps)
            ? sampleItemsStratified(rawCheat.keyRulesOrSteps, tier.maxRules)
            : [],
          commonMistakes: Array.isArray(rawCheat.commonMistakes)
            ? sampleItemsStratified(rawCheat.commonMistakes, tier.maxMistakes)
            : [],
          quickRevisionPoints: Array.isArray(rawCheat.quickRevisionPoints)
            ? rawCheat.quickRevisionPoints
                .slice(0, tier.maxRevision)
                .map((p) => String(p).slice(0, 240))
            : [],
          realWorldExamples: Array.isArray(rawCheat.realWorldExamples)
            ? sampleItemsStratified(rawCheat.realWorldExamples, tier.maxExamples)
            : [],
        }
      : undefined;

  const tldw = Array.isArray(workspace.tldw)
    ? workspace.tldw.slice(0, 8).map((item) => String(item).slice(0, 280))
    : typeof workspace.tldw === 'string'
      ? [workspace.tldw.slice(0, 500)]
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

/**
 * Projects a LectureWorkspace down to a strictly UTF-8 byte-budgeted subset for `/api/chat`
 * (default 320 KB, safely inside the backend 512 KB Express JSON limit with room for question/history)
 * while preserving 0%–100% start, middle, and end timeline coverage via stratified sampling.
 */
export function compactWorkspaceForChat(
  workspace: Record<string, unknown>,
  maxBytes = MAX_CHAT_WORKSPACE_BYTES
): Record<string, unknown> {
  const safeBudget = Math.max(24 * 1024, maxBytes);

  let candidate: Record<string, unknown> = projectWorkspaceAtTier(workspace, COMPACTION_TIERS[0]);
  if (measureUtf8Bytes(JSON.stringify(candidate)) <= safeBudget) {
    return candidate;
  }

  for (let i = 1; i < COMPACTION_TIERS.length; i++) {
    candidate = projectWorkspaceAtTier(workspace, COMPACTION_TIERS[i]);
    if (measureUtf8Bytes(JSON.stringify(candidate)) <= safeBudget) {
      return candidate;
    }
  }

  // Final deterministic fallback if an extreme workspace still exceeds safeBudget
  const transcript = Array.isArray(candidate.transcript)
    ? sampleItemsStratified(candidate.transcript, 10).map((sec) => {
        const s = (sec ?? {}) as Record<string, unknown>;
        const lines = Array.isArray(s.lines)
          ? sampleItemsStratified(s.lines, 1).map((l) => {
              const line = (l ?? {}) as Record<string, unknown>;
              return {
                ...line,
                text: typeof line.text === 'string' ? line.text.slice(0, 90) : '',
              };
            })
          : [];
        return { ...s, lines };
      })
    : [];

  const nodes = Array.isArray(candidate.nodes)
    ? sampleItemsStratified(candidate.nodes, 10).map((node) => {
        const n = (node ?? {}) as Record<string, unknown>;
        return {
          ...n,
          keyPoints: Array.isArray(n.keyPoints) ? n.keyPoints.slice(0, 1) : [],
          subNodes: [],
        };
      })
    : [];

  return {
    ...candidate,
    nodes,
    transcript,
    cheatSheet: undefined,
  };
}

/**
 * Projects a LectureWorkspace within a safe UTF-8 byte budget for `/api/generate-visual-guide`
 * (default 680 KB, safely inside the backend 1 MB Express JSON limit).
 */
export function compactWorkspaceForVisualGuide(
  workspace: Record<string, unknown>,
  maxBytes = MAX_VISUAL_GUIDE_WORKSPACE_BYTES
): Record<string, unknown> {
  return compactWorkspaceForChat(workspace, maxBytes);
}

export interface AllowedOriginContext {
  forwardedHost?: string | string[];
  secFetchSite?: string | string[];
  appUrl?: string;
}

/**
 * Validates that state-changing `/api/*` requests originate from the same site/proxy or an
 * explicitly allowlisted origin (`ALLOWED_ORIGINS` env var), protecting the shared backend
 * Gemini key against unauthorized cross-site API requests while working seamlessly behind
 * reverse proxies (Google AI Studio preview, Cloud Run, Render, Nginx, and localhost).
 */
export function isAllowedApiOrigin(
  originHeader: string | undefined,
  hostHeader: string | undefined,
  allowedOriginsEnv?: string,
  context?: AllowedOriginContext
): boolean {
  // Non-browser or same-origin requests without an Origin header are allowed
  if (!originHeader || !originHeader.trim()) return true;

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(originHeader.trim());
  } catch {
    return false;
  }

  if (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') {
    return false;
  }

  // Modern browsers send a forbidden-to-spoof Sec-Fetch-Site header; `same-origin` proves
  // the request came from the exact same origin even when a reverse proxy rewrites Host.
  const rawSecFetchSite = Array.isArray(context?.secFetchSite)
    ? context?.secFetchSite[0]
    : context?.secFetchSite;
  if (rawSecFetchSite && rawSecFetchSite.trim().toLowerCase() === 'same-origin') {
    return true;
  }

  const originHost = parsedOrigin.host.toLowerCase();
  const originHostName = parsedOrigin.hostname.toLowerCase();
  const normalizedOrigin = `${parsedOrigin.protocol}//${originHost}`;

  // Collect candidate request hosts from Host and X-Forwarded-Host headers
  const candidateHosts: string[] = [];
  if (hostHeader && hostHeader.trim()) {
    candidateHosts.push(hostHeader.trim().toLowerCase());
  }
  const rawForwarded = Array.isArray(context?.forwardedHost)
    ? context?.forwardedHost.join(',')
    : context?.forwardedHost ?? '';
  if (rawForwarded.trim()) {
    for (const part of rawForwarded.split(',')) {
      const cleaned = part.trim().toLowerCase();
      if (cleaned) candidateHosts.push(cleaned);
    }
  }

  for (const candidate of candidateHosts) {
    if (originHost === candidate) {
      return true;
    }
    // Handle reverse proxies forwarding explicit :443 or :80 on standard HTTPS/HTTP origins
    const candidateWithoutDefaultPort = candidate.replace(/:(443|80)$/, '');
    if (originHost === candidateWithoutDefaultPort) {
      return true;
    }
  }

  // Allow localhost / 127.0.0.1 loopback origins when serving on localhost
  const isLoopback = (h: string) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
  if (
    isLoopback(originHostName) &&
    candidateHosts.some((h) => isLoopback(h.split(':')[0]))
  ) {
    return true;
  }

  // Match configured platform APP_URL (e.g. Google AI Studio / Cloud Run dev & preview URLs)
  if (context?.appUrl && context.appUrl.trim()) {
    try {
      const parsedAppUrl = new URL(context.appUrl.trim());
      const appOrigin = `${parsedAppUrl.protocol}//${parsedAppUrl.host}`.toLowerCase();
      if (normalizedOrigin === appOrigin) {
        return true;
      }
      // Allow paired AI Studio dev <-> shared preview hosts for the exact same app ID
      const appHost = parsedAppUrl.host.toLowerCase();
      if (
        (appHost.startsWith('ais-dev-') && originHost === appHost.replace(/^ais-dev-/, 'ais-pre-')) ||
        (appHost.startsWith('ais-pre-') && originHost === appHost.replace(/^ais-pre-/, 'ais-dev-'))
      ) {
        return true;
      }
    } catch {
      // Ignore malformed APP_URL
    }
  }

  // Explicit operator allowlist via ALLOWED_ORIGINS="https://app.example.com,https://staging.example.com"
  if (allowedOriginsEnv && allowedOriginsEnv.trim()) {
    const allowed = allowedOriginsEnv
      .split(',')
      .map((entry) => entry.trim().toLowerCase().replace(/\/+$/, ''))
      .filter(Boolean);
    if (allowed.includes(normalizedOrigin)) {
      return true;
    }
  }

  return false;
}
