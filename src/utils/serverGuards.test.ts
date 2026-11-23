import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyApiError,
  compactWorkspaceForChat,
  ConcurrencyLimiter,
  hashCacheKey,
  InFlightDeduplicator,
  isAllowedRasterImageMime,
  isAllowedYouTubeCaptionUrl,
  isAllowedYouTubeUserUrl,
  isModelFallbackNeeded,
  isRetryableGeminiError,
  readResponseBufferWithLimit,
  resolveTrustProxySetting,
  sanitizeLogString,
  sanitizeUserText,
  SlidingWindowRateLimiter,
  TtlLruCache,
  sampleItemsStratified,
} from './serverGuards.ts';
import { sanitizeOptionalSvgDiagram } from './visualGuide.ts';
import {
  LEGACY_LIBRARY_STORAGE_KEY_V3,
  LIBRARY_STORAGE_KEY,
  LIBRARY_STORAGE_VERSION,
  loadLibraryWithReport,
  MAX_LIBRARY_ITEMS,
  saveLibraryToStorage,
  upsertLibraryItemWithReport,
} from './libraryStorage.ts';
import {
  appendChatMessageToStore,
  createEmptyChatStore,
  findLastFailedTurn,
  getMessagesForVideo,
  removeChatMessageFromStore,
} from './chatStorage.ts';
import { SAMPLE_DSA_LECTURE } from '../data/sampleLecture.ts';
import type { LectureWorkspace, SavedLibraryEntry } from '../types/mindflow.ts';

describe('serverGuards — Rate limiting, Concurrency, Caching & Deduplication', () => {
  it('enforces sliding-window rate limits and resets after the window expires', () => {
    const limiter = new SlidingWindowRateLimiter({ windowMs: 10_000, maxRequests: 3 });
    const t0 = 1_000_000;

    assert.equal(limiter.check('chat:1.2.3.4', t0).allowed, true);
    assert.equal(limiter.check('chat:1.2.3.4', t0 + 1000).allowed, true);
    const third = limiter.check('chat:1.2.3.4', t0 + 2000);
    assert.equal(third.allowed, true);
    assert.equal(third.remaining, 0);

    const blocked = limiter.check('chat:1.2.3.4', t0 + 3000);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.resetAfterSeconds >= 7);

    // Different client is unaffected
    assert.equal(limiter.check('chat:5.6.7.8', t0 + 3000).allowed, true);

    // Original client allowed again once oldest timestamp slides out
    assert.equal(limiter.check('chat:1.2.3.4', t0 + 10_500).allowed, true);
  });

  it('enforces global and per-client concurrency limits with idempotent release', () => {
    const limiter = new ConcurrencyLimiter({ maxGlobal: 3, maxPerClient: 2 });

    const a1 = limiter.acquire('clientA');
    const a2 = limiter.acquire('clientA');
    const a3 = limiter.acquire('clientA');
    assert.equal(a1.acquired, true);
    assert.equal(a2.acquired, true);
    assert.equal(a3.acquired, false);
    if (!a3.acquired) assert.equal(a3.reason, 'client_limit');

    const b1 = limiter.acquire('clientB');
    const c1 = limiter.acquire('clientC');
    assert.equal(b1.acquired, true);
    assert.equal(c1.acquired, false);
    if (!c1.acquired) assert.equal(c1.reason, 'server_busy');

    if (a1.acquired) {
      a1.release();
      a1.release(); // idempotent double release should not underflow
    }
    assert.equal(limiter.getStats().activeGlobal, 2);
    const c2 = limiter.acquire('clientC');
    assert.equal(c2.acquired, true);
  });

  it('caches values with TTL expiration and LRU eviction', () => {
    const cache = new TtlLruCache<string>({ maxEntries: 2, ttlMs: 5_000 });
    const t0 = 50_000;
    cache.set('k1', 'v1', t0);
    cache.set('k2', 'v2', t0 + 100);

    // Touch k1 so k2 becomes least-recently-used
    assert.equal(cache.get('k1', t0 + 200), 'v1');
    cache.set('k3', 'v3', t0 + 300);

    assert.equal(cache.get('k2', t0 + 400), undefined);
    assert.equal(cache.get('k1', t0 + 400), 'v1');
    assert.equal(cache.get('k3', t0 + 400), 'v3');

    // Expire past TTL
    assert.equal(cache.get('k1', t0 + 6_000), undefined);
  });

  it('coalesces identical concurrent requests via InFlightDeduplicator', async () => {
    const dedup = new InFlightDeduplicator();
    let executions = 0;

    const work = () =>
      dedup.run('analyze:abc:en', async () => {
        executions += 1;
        await new Promise((r) => setTimeout(r, 20));
        return { ok: true, count: executions };
      });

    const [r1, r2, r3] = await Promise.all([work(), work(), work()]);
    assert.equal(executions, 1);
    assert.deepEqual(r1, r2);
    assert.deepEqual(r2, r3);
    assert.equal(dedup.activeCount, 0);
  });
});

describe('serverGuards — URL Allowlists, MIME Checks, Streaming Limits & Error Safety', () => {
  it('strictly allowlists YouTube timedtext caption URLs and blocks arbitrary/internal URLs', () => {
    assert.equal(
      isAllowedYouTubeCaptionUrl('https://www.youtube.com/api/timedtext?v=8hly31xKli0&lang=en'),
      true
    );
    assert.equal(
      isAllowedYouTubeCaptionUrl('https://video.google.com/timedtext?v=8hly31xKli0&lang=en'),
      true
    );
    assert.equal(
      isAllowedYouTubeCaptionUrl('http://www.youtube.com/api/timedtext?v=8hly31xKli0'),
      false
    );
    assert.equal(
      isAllowedYouTubeCaptionUrl('https://169.254.169.254/latest/meta-data/'),
      false
    );
    assert.equal(
      isAllowedYouTubeCaptionUrl('https://localhost:3000/api/timedtext'),
      false
    );
    assert.equal(
      isAllowedYouTubeCaptionUrl('https://evil.example.com/api/timedtext?v=8hly31xKli0'),
      false
    );
    assert.equal(
      isAllowedYouTubeCaptionUrl('https://www.youtube.com/watch?v=8hly31xKli0'),
      false
    );
    assert.equal(
      isAllowedYouTubeCaptionUrl('https://user:pass@www.youtube.com/api/timedtext'),
      false
    );
  });

  it('validates user-supplied YouTube URLs strictly and rejects non-YouTube domains', () => {
    assert.equal(
      isAllowedYouTubeUserUrl('https://youtu.be/8hly31xKli0', '8hly31xKli0'),
      true
    );
    assert.equal(
      isAllowedYouTubeUserUrl('https://www.youtube.com/shorts/8hly31xKli0', '8hly31xKli0'),
      true
    );
    assert.equal(
      isAllowedYouTubeUserUrl('https://youtu.be/8hly31xKli0', 'DIFFERENT11'),
      false
    );
    assert.equal(isAllowedYouTubeUserUrl('https://evil.com/watch?v=8hly31xKli0'), false);
    assert.equal(isAllowedYouTubeUserUrl('http://127.0.0.1:8080/internal'), false);
  });

  it('allows only safe raster image MIME types and rejects SVG/HTML', () => {
    assert.equal(isAllowedRasterImageMime('image/jpeg'), true);
    assert.equal(isAllowedRasterImageMime('image/png; charset=binary'), true);
    assert.equal(isAllowedRasterImageMime('image/webp'), true);
    assert.equal(isAllowedRasterImageMime('image/svg+xml'), false);
    assert.equal(isAllowedRasterImageMime('text/html'), false);
    assert.equal(isAllowedRasterImageMime('application/javascript'), false);
  });

  it('enforces hard byte limits when reading upstream responses', async () => {
    const small = new Response(new Uint8Array(64));
    const buf = await readResponseBufferWithLimit(small, 128);
    assert.equal(buf.byteLength, 64);

    const tooLarge = new Response(new Uint8Array(512));
    await assert.rejects(
      () => readResponseBufferWithLimit(tooLarge, 128),
      /RESPONSE_TOO_LARGE/
    );
  });

  it('redacts API keys and tokens in diagnostic logs and classifies errors safely', () => {
    const leaked = sanitizeLogString(
      new Error('Fetch failed with key=AIzaSyA1234567890abcdefghijk and Bearer secret.jwt.token')
    );
    assert.equal(leaked.includes('AIzaSy'), false);
    assert.equal(leaked.includes('secret.jwt.token'), false);
    assert.ok(leaked.includes('[REDACTED_API_KEY]'));
    assert.ok(leaked.includes('[REDACTED_TOKEN]'));

    const overloaded = classifyApiError(
      new Error('503 UNAVAILABLE: This model is currently experiencing high demand'),
      'Fallback'
    );
    assert.equal(overloaded.status, 503);
    assert.equal(overloaded.code, 'AI_OVERLOADED');
    assert.equal(overloaded.retryable, true);

    const quota = classifyApiError(new Error('429 RESOURCE_EXHAUSTED'), 'Fallback');
    assert.equal(quota.status, 429);
    assert.equal(quota.code, 'AI_RATE_LIMITED');
    assert.equal(quota.retryable, true);

    assert.equal(isRetryableGeminiError(new Error('503 UNAVAILABLE')), true);
    assert.equal(isRetryableGeminiError(new Error('429 RESOURCE_EXHAUSTED')), true);
    assert.equal(isRetryableGeminiError(new Error('400 INVALID_ARGUMENT')), false);
    assert.equal(isRetryableGeminiError(new Error('403 PERMISSION_DENIED')), false);
    assert.equal(isModelFallbackNeeded(new Error('404 NOT_FOUND')), true);
    assert.equal(isModelFallbackNeeded(new Error('thinking_level is not supported for this model')), true);
  });

  it('configures trust proxy safely without blindly trusting arbitrary IP headers', () => {
    assert.equal(resolveTrustProxySetting({}), false);
    assert.equal(resolveTrustProxySetting({ K_SERVICE: 'mindflow' }), 1);
    assert.equal(resolveTrustProxySetting({ TRUST_PROXY_HOPS: '2' }), 2);
    assert.equal(resolveTrustProxySetting({ TRUST_PROXY_HOPS: 'false', K_SERVICE: 'mindflow' }), false);
    assert.equal(resolveTrustProxySetting({ TRUST_PROXY_HOPS: '99' }), false);
  });

  it('sanitizes user text and compacts chat workspace payloads cleanly without losing educational context', async () => {
    const { retrieveChatContext } = await import('./contextRetrieval.ts');
    assert.equal(sanitizeUserText('  hello\u0000world\nline2  ', 50), 'helloworld\nline2');
    assert.equal(hashCacheKey('abc'), hashCacheKey('abc'));
    assert.notEqual(hashCacheKey('abc'), hashCacheKey('abd'));

    const compact = compactWorkspaceForChat(
      SAMPLE_DSA_LECTURE as unknown as Record<string, unknown>
    );
    assert.equal(compact.videoId, SAMPLE_DSA_LECTURE.videoId);
    assert.ok(Array.isArray(compact.tldw) && compact.tldw.length > 0);
    assert.ok(Array.isArray(compact.nodes) && compact.nodes.length > 0);
    assert.ok(Array.isArray(compact.transcript) && compact.transcript.length > 0);

    const retrieved = retrieveChatContext(compact, 'Explain Binary Search and Big O');
    assert.ok(retrieved.selectedChunkIds.length > 0);
    assert.ok(retrieved.validTimestampSeconds.length > 0);
    assert.ok(retrieved.contextText.toLowerCase().includes('binary search'));
  });
});

describe('libraryStorage v4 — Migration, Corruption Recovery, Eviction & Quota Feedback', () => {
  function createMockStorage(initial: Record<string, string> = {}) {
    const map = new Map<string, string>(Object.entries(initial));
    let failWritesOverBytes: number | null = null;
    return {
      setFailOverBytes(limit: number | null) {
        failWritesOverBytes = limit;
      },
      getItem(key: string) {
        return map.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        if (failWritesOverBytes !== null && value.length > failWritesOverBytes) {
          throw new Error('QuotaExceededError');
        }
        map.set(key, value);
      },
      removeItem(key: string) {
        map.delete(key);
      },
      dump() {
        return Object.fromEntries(map.entries());
      },
    };
  }

  function makeWorkspace(idx: number): LectureWorkspace {
    return {
      ...SAMPLE_DSA_LECTURE,
      id: `ws-${idx}`,
      videoId: `VidId0000${String(idx).padStart(2, '0')}`,
      title: `Course Lecture #${idx}`,
      isDemo: false,
    };
  }

  it('migrates legacy v3 array storage to versioned v4 envelope cleanly', () => {
    const ws = makeWorkspace(1);
    const { items } = upsertLibraryItemWithReport([], ws);
    const storage = createMockStorage({
      [LEGACY_LIBRARY_STORAGE_KEY_V3]: JSON.stringify(items),
    });

    const report = loadLibraryWithReport(storage);
    assert.equal(report.migrated, true);
    assert.equal(report.recoveredFromCorruption, false);
    assert.equal(report.items.length, 1);
    assert.equal(report.items[0].videoId, ws.videoId);

    const savedV4 = JSON.parse(storage.getItem(LIBRARY_STORAGE_KEY) || '{}');
    assert.equal(savedV4.version, LIBRARY_STORAGE_VERSION);
    assert.equal(savedV4.items.length, 1);
  });

  it('recovers safely from corrupted JSON and drops invalid entries', () => {
    const corruptStorage = createMockStorage({
      [LIBRARY_STORAGE_KEY]: '{not valid json!!!',
    });
    const report = loadLibraryWithReport(corruptStorage);
    assert.equal(report.recoveredFromCorruption, true);
    assert.equal(report.items.length, 0);
    assert.equal(corruptStorage.getItem(LIBRARY_STORAGE_KEY), null);

    const validWs = makeWorkspace(2);
    const { items } = upsertLibraryItemWithReport([], validWs);
    const partialCorrupt = createMockStorage({
      [LIBRARY_STORAGE_KEY]: JSON.stringify({
        version: LIBRARY_STORAGE_VERSION,
        items: [items[0], { videoId: '', title: '' }, { broken: true }],
      }),
    });
    const partialReport = loadLibraryWithReport(partialCorrupt);
    assert.equal(partialReport.items.length, 1);
    assert.equal(partialReport.droppedInvalidEntries, 2);
    assert.equal(partialReport.recoveredFromCorruption, true);
  });

  it('reports evicted entry titles transparently when exceeding the 15-video limit', () => {
    let items: SavedLibraryEntry[] = [];
    for (let i = 1; i <= MAX_LIBRARY_ITEMS; i++) {
      const res = upsertLibraryItemWithReport(items, makeWorkspace(i));
      items = res.items;
      assert.equal(res.evictedTitles.length, 0);
    }
    assert.equal(items.length, MAX_LIBRARY_ITEMS);

    // Adding the 16th video evicts the oldest (#1) and reports its title explicitly
    const sixteenth = upsertLibraryItemWithReport(items, makeWorkspace(16));
    assert.equal(sixteenth.items.length, MAX_LIBRARY_ITEMS);
    assert.deepEqual(sixteenth.evictedTitles, ['Course Lecture #1']);
  });

  it('reports quota trimming transparently instead of silently dropping entries', () => {
    let items: SavedLibraryEntry[] = [];
    for (let i = 1; i <= 4; i++) {
      items = upsertLibraryItemWithReport(items, makeWorkspace(i)).items;
    }

    const oneItemSize = JSON.stringify({
      version: LIBRARY_STORAGE_VERSION,
      items: items.slice(0, 1),
    }).length;
    const storage = createMockStorage();
    // Allow at most 2 items to fit in simulated localStorage quota
    storage.setFailOverBytes(Math.floor(oneItemSize * 2.3));

    const saveResult = saveLibraryToStorage(items, storage);
    assert.equal(saveResult.ok, true);
    assert.equal(saveResult.reason, 'quota_trimmed');
    assert.equal(saveResult.savedCount, 2);
    assert.equal(saveResult.droppedForQuota, 2);
  });
});

describe('chatStorage — Retry Last Question Helpers', () => {
  it('finds the failed turn question across reloads and removes stale error bubbles cleanly on retry', () => {
    let store = createEmptyChatStore();
    store = appendChatMessageToStore(store, '8hly31xKli0', {
      id: 'u-1',
      role: 'user',
      content: 'Why is binary search O(log n)?',
      createdAt: 1000,
    });
    store = appendChatMessageToStore(store, '8hly31xKli0', {
      id: 'a-err-1',
      role: 'assistant',
      content: 'The AI service is experiencing a temporary demand spike.',
      isError: true,
      failedQuestion: 'Why is binary search O(log n)?',
      createdAt: 1005,
    });

    const messages = getMessagesForVideo(store, '8hly31xKli0');
    const failedTurn = findLastFailedTurn(messages);
    assert.deepEqual(failedTurn, {
      errorMessageId: 'a-err-1',
      question: 'Why is binary search O(log n)?',
    });

    // Retry removes only the stale error bubble, preserving the original user bubble without duplication
    store = removeChatMessageFromStore(store, '8hly31xKli0', failedTurn!.errorMessageId);
    const afterRemove = getMessagesForVideo(store, '8hly31xKli0');
    assert.equal(afterRemove.length, 1);
    assert.equal(afterRemove[0].role, 'user');
    assert.equal(findLastFailedTurn(afterRemove), null);
  });
});

describe('Release Readiness — Long-Video Coverage, Cache Correctness & Diagram Control', () => {
  it('sampleItemsStratified preserves first, middle, and last elements covering 0% to 100% of long transcripts', () => {
    const rawItems = Array.from({ length: 150 }, (_, i) => `section-${i}`);
    const sampled = sampleItemsStratified(rawItems, 100);

    assert.equal(sampled.length, 100);
    // Strict preservation of beginning
    assert.equal(sampled[0], 'section-0');
    assert.equal(sampled[1], 'section-1');
    // Strict preservation of ending
    assert.equal(sampled[sampled.length - 1], 'section-149');
    assert.equal(sampled[sampled.length - 2], 'section-148');
    // Middle sections are evenly represented
    assert.ok(sampled.includes('section-75') || sampled.includes('section-74'));
  });

  it('compactWorkspaceForChat preserves late transcript sections and late nodes in long videos', () => {
    const mock120Sections = Array.from({ length: 120 }, (_, idx) => ({
      id: `sec-${idx}`,
      nodeId: `n-${idx}`,
      title: `Chapter ${idx}: Topic details`,
      startSeconds: idx * 60,
      startLabel: `${idx}:00`,
      lines: [{ id: `l-${idx}`, timestampSeconds: idx * 60, timestampLabel: `${idx}:00`, text: `Line text ${idx}` }],
    }));

    const mock120Nodes = Array.from({ length: 120 }, (_, idx) => ({
      id: `node-${idx}`,
      title: `Node ${idx}`,
      timestampSeconds: idx * 60,
      timestampLabel: `${idx}:00`,
    }));

    const compacted = compactWorkspaceForChat({
      videoId: 'long-video-123',
      title: 'Long 2-Hour Lecture',
      nodes: mock120Nodes,
      transcript: mock120Sections,
    });

    const transcript = compacted.transcript as Array<{ id: string; title: string }>;
    const nodes = compacted.nodes as Array<{ id: string; title: string }>;

    assert.ok(transcript.length > 60, 'Compacted transcript should not be naively truncated to 60');
    // Ensure the very last section from 100% of the video is retained
    assert.equal(transcript[transcript.length - 1].id, 'sec-119');
    // Ensure early section is retained
    assert.equal(transcript[0].id, 'sec-0');
    // Ensure nodes cover both early and late topics
    assert.equal(nodes[0].id, 'node-0');
    assert.equal(nodes[nodes.length - 1].id, 'node-119');
  });

  it('visual PDF cache fingerprint prevents collision between distinct manual transcripts with the same title', () => {
    const title = 'Physics 101 Lecture';
    const transcriptA = [{ title: 'Kinematics', id: 'n1' }];
    const transcriptB = [{ title: 'Quantum Mechanics', id: 'n2' }];

    const fpA = hashCacheKey(`${title}|manual-1|${JSON.stringify(transcriptA.map((n) => n.title))}`);
    const fpB = hashCacheKey(`${title}|manual-2|${JSON.stringify(transcriptB.map((n) => n.title))}`);

    assert.notEqual(fpA, fpB, 'Different manual transcripts sharing the same title must yield distinct cache fingerprints');
  });

  it('chat cache fingerprint changes when workspace nodes or transcripts are updated', () => {
    const vId = 'video-abc';
    const title = 'Linear Algebra';

    const wsV1 = {
      videoId: vId,
      title,
      nodes: [{ title: 'Vectors' }],
      transcript: [{ title: 'Intro' }],
    };
    const wsV2 = {
      videoId: vId,
      title,
      nodes: [{ title: 'Vectors' }, { title: 'Matrices' }],
      transcript: [{ title: 'Intro' }, { title: 'Transformations' }],
    };

    const fp1 = hashCacheKey(`${wsV1.videoId}|${wsV1.title}|${wsV1.nodes.length}|${wsV1.nodes[0].title}|${wsV1.transcript.length}`);
    const fp2 = hashCacheKey(`${wsV2.videoId}|${wsV2.title}|${wsV2.nodes.length}|${wsV2.nodes[0].title}|${wsV2.transcript.length}`);

    assert.notEqual(fp1, fp2, 'Re-analyzed or modified workspace content must invalidate previous chat cache');
  });

  it('sanitizeOptionalSvgDiagram returns empty string when includeDiagram is false', () => {
    const rawSvg = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>';
    assert.equal(sanitizeOptionalSvgDiagram(rawSvg, false), '');
    assert.ok(sanitizeOptionalSvgDiagram(rawSvg, true).includes('<svg'));
    assert.equal(sanitizeOptionalSvgDiagram('', true), '');
    assert.equal(sanitizeOptionalSvgDiagram(undefined, true), '');
  });

  it('classifyApiError distinguishes 429 quota exhaustion, 503 capacity, and extracts Retry-After', () => {
    const rateLimitWithDelay = classifyApiError(
      new Error('429 RESOURCE_EXHAUSTED: Quota exceeded. Please retry after 25s.'),
      'Fallback'
    );
    assert.equal(rateLimitWithDelay.status, 429);
    assert.equal(rateLimitWithDelay.code, 'AI_RATE_LIMITED');
    assert.equal(rateLimitWithDelay.retryable, true);
    assert.equal(rateLimitWithDelay.retryAfterSeconds, 25);

    const overloaded = classifyApiError(
      new Error('503 The model is overloaded. Please try again later.'),
      'Fallback'
    );
    assert.equal(overloaded.status, 503);
    assert.equal(overloaded.code, 'AI_OVERLOADED');
    assert.equal(overloaded.retryable, true);

    const authError = classifyApiError(
      new Error('AI_NOT_CONFIGURED: GEMINI_API_KEY is required in server settings.'),
      'Fallback'
    );
    assert.equal(authError.status, 503);
    assert.equal(authError.code, 'AI_AUTH_ERROR');
    assert.equal(authError.retryable, false);
  });
});
