import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyApiError,
  classifyGeminiFailure,
  compactWorkspaceForChat,
  compactWorkspaceForVisualGuide,
  computeWorkspaceContentFingerprint,
  ConcurrencyLimiter,
  executeWithGeminiRetry,
  hashCacheKey,
  InFlightDeduplicator,
  isAllowedApiOrigin,
  isAllowedRasterImageMime,
  isAllowedYouTubeCaptionUrl,
  isAllowedYouTubeUserUrl,
  isModelFallbackNeeded,
  isRetryableGeminiError,
  MAX_CHAT_WORKSPACE_BYTES,
  MAX_VISUAL_GUIDE_WORKSPACE_BYTES,
  measureUtf8Bytes,
  readResponseBufferWithLimit,
  resolveTrustProxySetting,
  sanitizeLogString,
  sanitizeUserText,
  SlidingWindowRateLimiter,
  TtlLruCache,
  sampleItemsStratified,
} from './serverGuards.ts';
import { sanitizeOptionalSvgDiagram, sanitizeSvgDiagram } from './visualGuide.ts';
import { buildStandalonePrintableHtml } from './pdfExport.ts';
import { SAMPLE_VISUAL_GUIDES_BY_LANGUAGE } from '../data/sampleVisualGuide.ts';
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

describe('Final Engineering Completion — Fingerprinting, Byte Budgets, Cancellation, Retry & Security', () => {
  it('computeWorkspaceContentFingerprint invalidates on later node, subNode, transcript line, and cheatSheet edits of identical length', () => {
    const base = {
      videoId: 'vid-fp-1',
      title: 'Systems Architecture',
      language: 'en',
      tldw: ['Summary A'],
      nodes: Array.from({ length: 12 }, (_, idx) => ({
        id: `n-${idx}`,
        title: `Topic ${idx}`,
        shortSubtitle: `Sub ${idx}`,
        keyPoints: [{ keyword: `Key${idx}`, detail: `Point A${idx}` }],
        subNodes: [
          {
            id: `sn-${idx}`,
            title: `Child ${idx}`,
            keyPoints: [{ keyword: `SubKey${idx}`, detail: `Leaf A${idx}` }],
          },
        ],
      })),
      transcript: Array.from({ length: 12 }, (_, idx) => ({
        id: `sec-${idx}`,
        title: `Chapter ${idx}`,
        keyTakeaway: `Takeaway ${idx}`,
        lines: [{ timestampLabel: `${idx}:00`, text: `Original lecture text ${idx}` }],
      })),
      cheatSheet: {
        definitions: [{ term: 'Throughput', summary: 'Requests per second', formulaOrNote: 'QPS' }],
        quickRevision: ['Core 1'],
      },
    };

    const fpBase = computeWorkspaceContentFingerprint(base);

    // Edit the 11th node's subNode with identical string length
    const editedLateNode = structuredClone(base);
    editedLateNode.nodes[11].subNodes[0].keyPoints[0].detail = 'Leaf B11';
    assert.notEqual(
      computeWorkspaceContentFingerprint(editedLateNode),
      fpBase,
      'Editing a late subNode must invalidate fingerprint'
    );

    // Edit the 11th transcript section's line text with identical length
    const editedLateTranscript = structuredClone(base);
    editedLateTranscript.transcript[11].lines[0].text = 'Modified lecture text 11';
    assert.notEqual(
      computeWorkspaceContentFingerprint(editedLateTranscript),
      fpBase,
      'Editing a late transcript line must invalidate fingerprint'
    );

    // Edit cheatSheet
    const editedCheatSheet = structuredClone(base);
    editedCheatSheet.cheatSheet.definitions[0].summary = 'Packets per second ';
    assert.notEqual(
      computeWorkspaceContentFingerprint(editedCheatSheet),
      fpBase,
      'Editing cheatSheet must invalidate fingerprint'
    );

    // Different videoId or language cannot collide
    const otherVideo = structuredClone(base);
    otherVideo.videoId = 'vid-fp-2';
    assert.notEqual(computeWorkspaceContentFingerprint(otherVideo), fpBase);

    const otherLang = structuredClone(base);
    otherLang.language = 'hi';
    assert.notEqual(computeWorkspaceContentFingerprint(otherLang), fpBase);
  });

  it('compactWorkspaceForChat strictly enforces <= MAX_CHAT_WORKSPACE_BYTES on huge long videos while keeping start, middle, and end', () => {
    const hugeTranscript = Array.from({ length: 200 }, (_, sIdx) => ({
      id: `sec-${sIdx}`,
      nodeId: `n-${sIdx}`,
      title: `Chapter ${sIdx}: Deep Technical Walkthrough of Subsystem ${sIdx}`,
      startSeconds: sIdx * 45,
      startLabel: `${Math.floor((sIdx * 45) / 60)}:${String((sIdx * 45) % 60).padStart(2, '0')}`,
      keyTakeaway: `Key takeaway for chapter ${sIdx} `.repeat(6),
      lines: Array.from({ length: 20 }, (__, lIdx) => ({
        id: `l-${sIdx}-${lIdx}`,
        timestampSeconds: sIdx * 45 + lIdx * 2,
        timestampLabel: `${sIdx}:${String(lIdx).padStart(2, '0')}`,
        text: `Detailed spoken transcript sentence ${sIdx}-${lIdx} explaining performance invariants and tradeoffs. `.repeat(3),
      })),
    }));

    const hugeNodes = Array.from({ length: 120 }, (_, nIdx) => ({
      id: `node-${nIdx}`,
      title: `Concept Node ${nIdx}`,
      shortSubtitle: `Summary of concept ${nIdx} `.repeat(4),
      timestampSeconds: nIdx * 60,
      timestampLabel: `${nIdx}:00`,
      keyPoints: Array.from({ length: 6 }, (__, k) => `Key point ${nIdx}-${k}: `.repeat(8)),
      realLifeExample: `Real-world production example for node ${nIdx}. `.repeat(6),
      simplifiedAnalogy: `Everyday analogy for node ${nIdx}. `.repeat(6),
      subNodes: Array.from({ length: 6 }, (__, c) => ({
        id: `sub-${nIdx}-${c}`,
        title: `Sub-topic ${nIdx}.${c}`,
        shortSubtitle: `Details ${nIdx}.${c}`,
        timestampSeconds: nIdx * 60 + c * 5,
        timestampLabel: `${nIdx}:${String(c * 5).padStart(2, '0')}`,
        keyPoints: [`Sub-point A ${nIdx}.${c}`.repeat(5)],
      })),
    }));

    const rawWorkspace = {
      videoId: 'massive-3hr-lecture',
      title: 'Complete 3-Hour Systems Course',
      channel: 'Engineering Channel',
      language: 'en',
      nodes: hugeNodes,
      transcript: hugeTranscript,
      cheatSheet: {
        coreTakeaways: Array.from({ length: 20 }, (_, i) => `Takeaway ${i} `.repeat(10)),
        actionableChecklist: Array.from({ length: 20 }, (_, i) => `Checklist ${i} `.repeat(10)),
      },
    };

    const rawBytes = measureUtf8Bytes(JSON.stringify(rawWorkspace));
    assert.ok(rawBytes > 1_000_000, `Test fixture should exceed 1 MB (got ${rawBytes} bytes)`);

    const compacted = compactWorkspaceForChat(rawWorkspace);
    const compactedBytes = measureUtf8Bytes(JSON.stringify(compacted));
    assert.ok(
      compactedBytes <= MAX_CHAT_WORKSPACE_BYTES,
      `Compacted chat payload (${compactedBytes} B) must stay <= ${MAX_CHAT_WORKSPACE_BYTES} B`
    );

    const sections = compacted.transcript as Array<{ id: string }>;
    const nodes = compacted.nodes as Array<{ id: string }>;
    assert.equal(sections[0].id, 'sec-0', 'Beginning of long video must be preserved');
    assert.equal(sections[sections.length - 1].id, 'sec-199', 'End of long video must be preserved');
    assert.ok(
      sections.some((s) => {
        const num = Number(s.id.replace('sec-', ''));
        return num >= 85 && num <= 115;
      }),
      'Middle of long video must remain represented'
    );
    assert.equal(nodes[0].id, 'node-0');
    assert.equal(nodes[nodes.length - 1].id, 'node-119');

    // Visual guide compaction also enforces its byte ceiling strictly
    const compactedGuide = compactWorkspaceForVisualGuide(rawWorkspace);
    const guideBytes = measureUtf8Bytes(JSON.stringify(compactedGuide));
    assert.ok(
      guideBytes <= MAX_VISUAL_GUIDE_WORKSPACE_BYTES,
      `Compacted visual guide payload (${guideBytes} B) must stay <= ${MAX_VISUAL_GUIDE_WORKSPACE_BYTES} B`
    );
  });

  it('InFlightDeduplicator aborts shared work only when ALL subscribers disconnect', async () => {
    const dedup = new InFlightDeduplicator();
    const sharedHolder: { signal: AbortSignal | null } = { signal: null };
    let resolveWork!: (val: string) => void;

    const ac1 = new AbortController();
    const ac2 = new AbortController();

    const p1 = dedup.run(
      'shared-key',
      (sharedSignal) => {
        sharedHolder.signal = sharedSignal;
        return new Promise<string>((resolve) => {
          resolveWork = resolve;
        });
      },
      { signal: ac1.signal }
    );
    const p2 = dedup.run(
      'shared-key',
      () => {
        throw new Error('Factory must not run twice for deduplicated key');
      },
      { signal: ac2.signal }
    );

    // Caller 1 disconnects — Caller 1 rejects, but sharedSignal stays alive for Caller 2
    ac1.abort();
    await assert.rejects(p1, /aborted/i);
    assert.equal(sharedHolder.signal?.aborted, false, 'Shared work must continue for remaining waiter');

    resolveWork('completed-ok');
    assert.equal(await p2, 'completed-ok');

    // Now test when ALL callers disconnect
    const soloHolder: { signal: AbortSignal | null } = { signal: null };
    const soloAc = new AbortController();
    const soloPromise = dedup.run(
      'solo-key',
      (sig) => {
        soloHolder.signal = sig;
        return new Promise<string>((_resolve, reject) => {
          sig.addEventListener('abort', () => reject(new Error('downstream cancelled')), { once: true });
        });
      },
      { signal: soloAc.signal }
    );

    soloAc.abort();
    await assert.rejects(soloPromise);
    assert.equal(soloHolder.signal?.aborted, true, 'Shared signal must abort when last subscriber disconnects');
  });

  it('executeWithGeminiRetry separates hard quota exhaustion, transient 429 Retry-After, 503 capacity fallback, and real AbortSignal cancellation', async () => {
    const models = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'] as const;

    // 1a. Per-model 429 quota exhausted on primary model -> immediately falls back to gemini-3.1-flash-lite
    const quotaFallbackModels: string[] = [];
    const quotaRecovered = await executeWithGeminiRetry({
      models,
      timeoutMs: 5000,
      sleepFn: async () => {},
      invoke: async (model) => {
        quotaFallbackModels.push(model);
        if (model === 'gemini-4-hydrogen') {
          throw new Error('429 RESOURCE_EXHAUSTED: Free tier daily quota exhausted (limit: 0)');
        }
        return `recovered:${model}`;
      },
    });
    assert.equal(quotaRecovered, 'recovered:gemini-3.1-flash-lite');
    assert.deepEqual(quotaFallbackModels, ['gemini-4-hydrogen', 'gemini-3.1-flash-lite']);

    // 1b. Hard quota exhausted across ALL models -> fails fast after trying each model once (no 2nd round)
    let hardQuotaCalls = 0;
    await assert.rejects(
      executeWithGeminiRetry({
        models,
        timeoutMs: 5000,
        sleepFn: async () => {},
        invoke: async () => {
          hardQuotaCalls++;
          throw new Error('429 RESOURCE_EXHAUSTED: Free tier daily quota exhausted (limit: 0)');
        },
      }),
      /quota exhausted/i
    );
    assert.equal(hardQuotaCalls, models.length);

    // Verify classifyGeminiFailure & classifyApiError agree on hard daily quota vs standard Google 429 boilerplate
    assert.equal(
      classifyGeminiFailure(new Error('429 RESOURCE_EXHAUSTED: Free tier daily quota exhausted')).kind,
      'quota_exhausted'
    );
    assert.equal(
      classifyGeminiFailure(
        new Error('429 RESOURCE_EXHAUSTED: You exceeded your current quota, please check your plan and billing details.')
      ).kind,
      'rate_limited'
    );
    const classifiedHard = classifyApiError(
      new Error('429 RESOURCE_EXHAUSTED: Free tier daily quota exhausted (limit: 0)'),
      'Fallback'
    );
    assert.equal(classifiedHard.status, 429);
    assert.equal(classifiedHard.code, 'AI_QUOTA_EXHAUSTED');
    assert.equal(classifiedHard.retryable, false);

    // 2. Transient 429 with Retry-After -> respects provider delay and succeeds on bounded retry
    const sleptMs: number[] = [];
    let rpmCalls = 0;
    const rpmResult = await executeWithGeminiRetry({
      models,
      timeoutMs: 5000,
      sleepFn: async (ms) => {
        sleptMs.push(ms);
      },
      invoke: async (model) => {
        rpmCalls++;
        if (rpmCalls === 1) {
          throw new Error('429 Too Many Requests: Rate limit exceeded. Retry after 3s.');
        }
        return `ok:${model}`;
      },
    });
    assert.equal(rpmResult, 'ok:gemini-4-hydrogen');
    assert.equal(rpmCalls, 2);
    assert.equal(sleptMs.length, 1);
    assert.ok(
      sleptMs[0] >= 3000 && sleptMs[0] <= 3250,
      `Expected Retry-After 3s + bounded jitter, got ${sleptMs[0]}ms`
    );

    // 3. 503 capacity error -> retries across models with bounded backoff and falls back cleanly
    const calledModels: string[] = [];
    const backoffDelays: number[] = [];
    const fallbackResult = await executeWithGeminiRetry({
      models,
      timeoutMs: 5000,
      randomFn: () => 0.5,
      sleepFn: async (ms) => {
        backoffDelays.push(ms);
      },
      invoke: async (model) => {
        calledModels.push(model);
        if (model === 'gemini-4-hydrogen') {
          throw new Error('503 Service Unavailable: The model is overloaded.');
        }
        return `recovered:${model}`;
      },
    });
    assert.equal(fallbackResult, 'recovered:gemini-3.1-flash-lite');
    assert.deepEqual(calledModels, ['gemini-4-hydrogen', 'gemini-3.1-flash-lite']);
    assert.equal(backoffDelays.length, 1);
    assert.ok(backoffDelays[0] >= 300 && backoffDelays[0] <= 600);

    // 4. Timeout aborts the attempt AbortSignal passed to SDK before trying fallback (even when fetch throws generic AbortError)
    let firstAttemptSignalAborted = false;
    const timeoutFallback = await executeWithGeminiRetry({
      models,
      timeoutMs: 25,
      sleepFn: async () => {},
      invoke: async (model, attemptSignal) => {
        if (model === 'gemini-4-hydrogen') {
          return new Promise<string>((_resolve, reject) => {
            attemptSignal.addEventListener(
              'abort',
              () => {
                firstAttemptSignalAborted = true;
                const abortErr = new Error('This operation was aborted');
                abortErr.name = 'AbortError';
                reject(abortErr);
              },
              { once: true }
            );
          });
        }
        assert.equal(
          firstAttemptSignalAborted,
          true,
          'Previous timed-out attempt signal must be aborted before fallback starts'
        );
        return `fallback:${model}`;
      },
    });
    assert.equal(timeoutFallback, 'fallback:gemini-3.1-flash-lite');

    // 5. Parent client abort immediately stops execution without invoking fallback
    const parentAc = new AbortController();
    let invocationsAfterAbort = 0;
    const abortedPromise = executeWithGeminiRetry({
      models,
      timeoutMs: 5000,
      parentSignal: parentAc.signal,
      sleepFn: async () => {},
      invoke: async (_model, attemptSignal) => {
        invocationsAfterAbort++;
        return new Promise<string>((_resolve, reject) => {
          attemptSignal.addEventListener(
            'abort',
            () => reject(attemptSignal.reason ?? new Error('client disconnected')),
            { once: true }
          );
        });
      },
    });
    parentAc.abort();
    await assert.rejects(abortedPromise);
    assert.equal(invocationsAfterAbort, 1, 'Client disconnect must never trigger fallback model');
  });

  it('isAllowedApiOrigin blocks third-party cross-site POST origins while allowing same-origin, reverse-proxy, AI Studio preview, loopback, and allowlisted origins', () => {
    assert.equal(isAllowedApiOrigin(undefined, 'app.mindflow.ai'), true);
    assert.equal(isAllowedApiOrigin('https://app.mindflow.ai', 'app.mindflow.ai'), true);
    assert.equal(isAllowedApiOrigin('http://localhost:3000', 'localhost:3000'), true);
    assert.equal(isAllowedApiOrigin('http://127.0.0.1:5173', 'localhost:3000'), true);
    assert.equal(isAllowedApiOrigin('https://evil.attacker.com', 'app.mindflow.ai'), false);
    assert.equal(
      isAllowedApiOrigin('https://evil.attacker.com', 'localhost:3000', undefined, {
        secFetchSite: 'cross-site',
        appUrl: 'https://ais-dev-abc123.asia-east1.run.app',
      }),
      false
    );
    assert.equal(isAllowedApiOrigin('null', 'app.mindflow.ai'), false);
    // Reverse-proxy same-origin via Sec-Fetch-Site
    assert.equal(
      isAllowedApiOrigin('https://ais-dev-abc123.asia-east1.run.app', 'localhost:3000', undefined, {
        secFetchSite: 'same-origin',
      }),
      true
    );
    // Reverse-proxy same-origin via X-Forwarded-Host
    assert.equal(
      isAllowedApiOrigin('https://mindflow.example.com', 'localhost:3000', undefined, {
        forwardedHost: 'mindflow.example.com',
      }),
      true
    );
    // Platform APP_URL + paired AI Studio dev <-> pre preview URLs
    assert.equal(
      isAllowedApiOrigin('https://ais-dev-abc123.asia-east1.run.app', 'localhost:3000', undefined, {
        appUrl: 'https://ais-dev-abc123.asia-east1.run.app',
      }),
      true
    );
    assert.equal(
      isAllowedApiOrigin('https://ais-pre-abc123.asia-east1.run.app', 'localhost:3000', undefined, {
        appUrl: 'https://ais-dev-abc123.asia-east1.run.app',
      }),
      true
    );
    assert.equal(
      isAllowedApiOrigin(
        'https://staging.mindflow.ai',
        'api.mindflow.ai',
        'https://staging.mindflow.ai, https://prod.mindflow.ai'
      ),
      true
    );
  });

  it('sanitizeSvgDiagram strips advanced XSS vectors and buildStandalonePrintableHtml respects showDiagrams toggle', () => {
    const maliciousSvg =
      '<svg viewBox="0 0 200 100"><animateTransform attributeName="transform" onbegin="alert(1)"/><a href=javascript:alert(2)><rect width="50" height="50" fill="url(https://evil.example/a.svg#x)"/></a><text x="10" y="20">Safe Node</text></svg>';
    const safeSvg = sanitizeSvgDiagram(maliciousSvg, 'Fallback', ['Term']);
    assert.ok(!/animateTransform/i.test(safeSvg));
    assert.ok(!/javascript:/i.test(safeSvg));
    assert.ok(!/onbegin/i.test(safeSvg));
    assert.ok(!/evil\.example/i.test(safeSvg));
    assert.ok(safeSvg.includes('Safe Node'));

    const sampleGuide = SAMPLE_VISUAL_GUIDES_BY_LANGUAGE.en;
    const htmlWithDiagrams = buildStandalonePrintableHtml(sampleGuide, {
      theme: 'warm',
      showVideoFrames: true,
      showWebImages: true,
      showDiagrams: true,
      showInsights: true,
    });
    const htmlWithoutDiagrams = buildStandalonePrintableHtml(sampleGuide, {
      theme: 'warm',
      showVideoFrames: true,
      showWebImages: true,
      showDiagrams: false,
      showInsights: true,
    });
    assert.ok(htmlWithDiagrams.includes('<div class="diagram-box">'));
    assert.ok(!htmlWithoutDiagrams.includes('<div class="diagram-box">'));
    assert.ok(!htmlWithoutDiagrams.includes('<svg'));
  });
});
