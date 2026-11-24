import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractYouTubeId,
  isValidYouTubeId,
  isSafeHttpUrl,
  parseDetailedShareParams,
  parseWorkspaceShareParams,
  buildDynamicChatPrompts,
  normalizeYouTubeUrl,
  buildWorkspaceCacheKey,
  formatSeconds,
  formatSecondsToTimestamp,
  parseTimestamp,
  parseTimestampToSeconds,
  buildYouTubeEmbedUrl,
} from './youtube';
import {
  clampTimestampSeconds,
  compressTranscriptStratified,
  extractChaptersFromDescription,
  extractChaptersFromYtInitialData,
  getDurationScaleProfile,
  normalizeTimestampPair,
  type TranscriptCaptionSegment,
} from './longVideo';
import type { LectureWorkspace, MindmapNode } from '../types/mindflow';
import {
  clampZoom,
  computeCurvedConnectorPath,
  computeVerticalConnectorPath,
  computeDynamicMindmapLayout,
  computeWheelZoomDelta,
  findAnyNodeById,
  findClosestNodeForTimestamp,
  shouldZoomOnWheel,
  ZOOM_MAX,
  ZOOM_MIN,
} from './mindmapMath';
import {
  createManualTranscriptId,
  isManualTranscriptId,
  isManualTranscriptWorkspace,
  resolveManualTranscriptIdentity,
} from './manualTranscript';
import {
  buildHandshakeCommands,
  buildSeekCommand,
  isTrustedYouTubeOrigin,
  parseYouTubeMessage,
  YouTubePlayerSyncController,
} from './youtubePlayerController';
import {
  appendChatMessageToStore,
  clearVideoChatFromStore,
  createEmptyChatStore,
  MAX_MESSAGES_PER_VIDEO,
  MAX_STORED_CHAT_VIDEOS,
  parseStoredChatPayload,
  pruneChatStore,
} from './chatStorage';
import {
  buildVisualGuideContext,
  retrieveChatContext,
  validateChatCitations,
} from './contextRetrieval';
import {
  filterTranscriptSections,
  formatAsJson,
  formatAsMarkdown,
  formatAsPlainText,
} from './exportFormats';
import {
  SAMPLE_DSA_LECTURE,
  SAMPLE_DSA_BY_LANGUAGE,
} from '../data/sampleLecture';
import {
  adaptSvgDiagramToTheme,
  buildProxyImageUrl,
  formatVisualGuideAsNotionMarkdown,
  isAllowedRemoteImageUrl,
  sanitizeOptionalSvgDiagram,
  sanitizeSvgDiagram,
} from './visualGuide';
import {
  compressPlainTextStratified,
  detectContentDomain,
  ensureFullTimelineCoverage,
  formatStructuredSimplification,
  getAdaptiveScaleProfile,
  normalizeAndDeduplicateWorkspace,
  parseStructuredSimplification,
  sampleItemsEvenly,
  validateWorkspaceQuality,
} from './educationalPipeline';
import {
  buildYouTubeThumbnailUrl,
  deleteLibraryItem,
  filterLibraryItems,
  isDemoLibraryEntry,
  isDemoWorkspace,
  MAX_LIBRARY_ITEMS,
  upsertLibraryItem,
} from './libraryStorage';
import {
  buildSafeExportFilename,
  buildStandalonePrintableHtml,
  escapeHtml,
  planA4BlockPlacements,
} from './pdfExport';
import { SAMPLE_VISUAL_GUIDES_BY_LANGUAGE } from '../data/sampleVisualGuide';

test('extractYouTubeId handles watch, youtu.be, embed, shorts, live, mobile, share text, and bare IDs', () => {
  assert.equal(
    extractYouTubeId('https://www.youtube.com/watch?v=8hly31xKli0&si=abc123'),
    '8hly31xKli0'
  );
  assert.equal(
    extractYouTubeId('https://m.youtube.com/watch?v=8hly31xKli0&t=42'),
    '8hly31xKli0'
  );
  assert.equal(
    extractYouTubeId('https://youtu.be/8hly31xKli0?t=260'),
    '8hly31xKli0'
  );
  assert.equal(
    extractYouTubeId('Check out this video! https://youtu.be/8hly31xKli0?si=xyz123'),
    '8hly31xKli0'
  );
  assert.equal(
    extractYouTubeId('https://www.youtube.com/embed/8hly31xKli0'),
    '8hly31xKli0'
  );
  assert.equal(
    extractYouTubeId('https://youtube.com/shorts/8hly31xKli0?feature=share'),
    '8hly31xKli0'
  );
  assert.equal(
    extractYouTubeId('https://www.youtube.com/live/8hly31xKli0'),
    '8hly31xKli0'
  );
  assert.equal(extractYouTubeId('8hly31xKli0'), '8hly31xKli0');
  assert.equal(extractYouTubeId('https://example.com/not-youtube'), null);
  assert.equal(extractYouTubeId(''), null);

  assert.equal(
    normalizeYouTubeUrl('8hly31xKli0'),
    'https://www.youtube.com/watch?v=8hly31xKli0'
  );
  assert.equal(
    buildWorkspaceCacheKey('8hly31xKli0', 'hinglish'),
    'mindflow_ws_v2:8hly31xKli0:hinglish'
  );
});

test('formatSeconds and parseTimestamp round-trip accurately', () => {
  assert.equal(formatSeconds(260), '04:20');
  assert.equal(formatSeconds(1490), '24:50');
  assert.equal(formatSeconds(3665), '1:01:05');
  assert.equal(parseTimestamp('08:45'), 525);
  assert.equal(parseTimestamp('1:01:05'), 3665);
  assert.equal(parseTimestamp('invalid'), 0);
});

test('buildYouTubeEmbedUrl enables JS API and start offset', () => {
  const url = buildYouTubeEmbedUrl('8hly31xKli0', 525);
  assert.ok(url.includes('/embed/8hly31xKli0'));
  assert.ok(url.includes('enablejsapi=1'));
  assert.ok(url.includes('start=525'));
});

test('mindmapMath clamps zoom, computes Bezier paths, and finds nested sub-nodes', () => {
  assert.equal(clampZoom(0.1), ZOOM_MIN);
  assert.equal(clampZoom(5.0), ZOOM_MAX);
  assert.equal(clampZoom(1.15), 1.15);

  const horizontal = computeCurvedConnectorPath({ x: 332, y: 280 }, { x: 280, y: 128 });
  assert.ok(horizontal.startsWith('M 332.0 280.0 C '));
  assert.ok(horizontal.endsWith('280.0 128.0'));

  const vertical = computeVerticalConnectorPath({ x: 180, y: 80 }, { x: 180, y: 190 });
  assert.ok(vertical.startsWith('M 180.0 80.0 C '));
  assert.ok(vertical.endsWith('180.0 190.0'));

  const foundMain = findAnyNodeById(SAMPLE_DSA_LECTURE.nodes, 'types-of-ds');
  assert.equal(foundMain?.title, 'Types of Data Structures');
  assert.equal(foundMain?.isSubNode, false);

  const foundSub = findAnyNodeById(SAMPLE_DSA_LECTURE.nodes, 'sub-trees-graphs');
  assert.equal(foundSub?.title, 'Trees, Heaps & Graphs');
  assert.equal(foundSub?.isSubNode, true);
  assert.equal(foundSub?.parentTitle, 'Types of Data Structures');
});

test('computeDynamicMindmapLayout expands sub-nodes without overlapping coordinates', () => {
  const collapsed = computeDynamicMindmapLayout(SAMPLE_DSA_LECTURE.nodes, []);
  assert.equal(collapsed.mains.length, 4);
  assert.equal(collapsed.subs.length, 0);
  assert.equal(collapsed.edges.length, 4);

  const expanded = computeDynamicMindmapLayout(SAMPLE_DSA_LECTURE.nodes, [
    'types-of-ds',
    'what-is-dsa',
  ]);
  assert.equal(expanded.mains.length, 4);
  assert.equal(expanded.subs.length, 6);
  assert.equal(expanded.edges.length, 10);
  assert.ok(expanded.width > collapsed.width);

  // Ensure sub-nodes on the same side do not overlap vertically (min separation >= 80px)
  const rightSubs = expanded.subs.filter((s) => s.side === 'right');
  for (let i = 1; i < rightSubs.length; i++) {
    assert.ok(Math.abs(rightSubs[i].y - rightSubs[i - 1].y) >= 80);
  }
});

test('sample language packs preserve structure across English, Hindi, and Hinglish', () => {
  assert.equal(SAMPLE_DSA_BY_LANGUAGE.en.nodes.length, 5);
  assert.equal(SAMPLE_DSA_BY_LANGUAGE.hi.nodes.length, 5);
  assert.equal(SAMPLE_DSA_BY_LANGUAGE.hinglish.nodes.length, 5);
  assert.equal(SAMPLE_DSA_BY_LANGUAGE.en.tldw.length, 3);
  assert.equal(SAMPLE_DSA_BY_LANGUAGE.hi.tldw.length, 3);
  assert.equal(SAMPLE_DSA_BY_LANGUAGE.hinglish.tldw.length, 3);
});

test('filterTranscriptSections matches keywords across titles and lines', () => {
  const all = filterTranscriptSections(SAMPLE_DSA_LECTURE.transcript, '');
  assert.equal(all.length, SAMPLE_DSA_LECTURE.transcript.length);

  const binaryMatches = filterTranscriptSections(SAMPLE_DSA_LECTURE.transcript, 'binary');
  assert.ok(binaryMatches.length >= 1);
  assert.ok(
    binaryMatches.some((sec) =>
      sec.lines.some((line) => line.text.toLowerCase().includes('binary'))
    )
  );

  const noMatches = filterTranscriptSections(SAMPLE_DSA_LECTURE.transcript, 'quantum-toaster-xyz');
  assert.equal(noMatches.length, 0);
});

test('export formatters include TL;DW summary, sub-nodes, Markdown, Plain Text, and JSON', () => {
  const md = formatAsMarkdown(SAMPLE_DSA_LECTURE);
  assert.ok(md.includes('Skip the Video (TL;DW)'));
  assert.ok(md.includes('Common Algorithms (18:30)'));
  assert.ok(md.includes('Trees, Heaps & Graphs (16:05)'));

  const txt = formatAsPlainText(SAMPLE_DSA_LECTURE);
  assert.ok(txt.includes('SKIP THE VIDEO (TL;DW)'));
  assert.ok(txt.includes('[24:50] Applications in Real Life'));

  const parsed = JSON.parse(formatAsJson(SAMPLE_DSA_LECTURE));
  assert.equal(parsed.videoId, '8hly31xKli0');
  assert.equal(parsed.nodes.length, 5);
});

test('visualGuide allowlist blocks arbitrary/private hosts and proxies YouTube & Wikimedia safely', () => {
  assert.equal(
    isAllowedRemoteImageUrl('https://i.ytimg.com/vi/8hly31xKli0/maxresdefault.jpg'),
    true
  );
  assert.equal(
    isAllowedRemoteImageUrl('https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg'),
    true
  );
  assert.equal(isAllowedRemoteImageUrl('http://127.0.0.1/secret'), false);
  assert.equal(isAllowedRemoteImageUrl('http://169.254.169.254/latest/meta-data'), false);
  assert.equal(isAllowedRemoteImageUrl('https://evil.example.com/img.png'), false);

  const proxied = buildProxyImageUrl('https://i.ytimg.com/vi/8hly31xKli0/1.jpg');
  assert.ok(proxied.startsWith('/api/image-proxy?url='));
  assert.equal(buildProxyImageUrl('https://evil.example.com/x.png'), '');
});

test('sanitizeSvgDiagram strips scripts, event handlers, and unsafe URIs while preserving clean vectors', () => {
  const dirty =
    '<svg viewBox="0 0 600 220" onload="alert(1)"><script>evil()</script><rect width="600" height="220" onclick="steal()"/><a href="javascript:alert(2)"><text x="10" y="20">Safe</text></a></svg>';
  const clean = sanitizeSvgDiagram(dirty, 'Fallback');
  assert.ok(clean.startsWith('<svg'));
  assert.ok(clean.endsWith('</svg>'));
  assert.equal(clean.includes('<script'), false);
  assert.equal(clean.includes('onload'), false);
  assert.equal(clean.includes('onclick'), false);
  assert.equal(clean.includes('javascript:'), false);
  assert.ok(clean.includes('Safe'));

  const fallback = sanitizeSvgDiagram('not an svg at all', 'Graph Flow', ['Nodes', 'Edges']);
  assert.ok(fallback.startsWith('<svg'));
  assert.ok(fallback.includes('Graph Flow'));
});

test('sample Visual PDF Guides and Notion Markdown formatter support en, hi, and hinglish', () => {
  assert.equal(SAMPLE_VISUAL_GUIDES_BY_LANGUAGE.en.chapters.length, 4);
  assert.equal(SAMPLE_VISUAL_GUIDES_BY_LANGUAGE.hi.chapters.length, 4);
  assert.equal(SAMPLE_VISUAL_GUIDES_BY_LANGUAGE.hinglish.chapters.length, 4);
  assert.equal(SAMPLE_VISUAL_GUIDES_BY_LANGUAGE.en.quickRecall.checklist.length, 5);

  const notionMd = formatVisualGuideAsNotionMarkdown(SAMPLE_VISUAL_GUIDES_BY_LANGUAGE.en);
  assert.ok(notionMd.includes('Skip the Video (TL;DW)'));
  assert.ok(notionMd.includes('Quick Recall Sheet'));
  assert.ok(notionMd.includes('- [ ] '));
});

test('libraryStorage deduplicates by videoId, merges languages & PDFs, caps at 15, and deletes cleanly', () => {
  let list = upsertLibraryItem(
    [],
    SAMPLE_DSA_BY_LANGUAGE.en,
    SAMPLE_VISUAL_GUIDES_BY_LANGUAGE.en
  );
  list = upsertLibraryItem(
    list,
    SAMPLE_DSA_BY_LANGUAGE.hi,
    SAMPLE_VISUAL_GUIDES_BY_LANGUAGE.hi
  );
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].languages.sort(), ['en', 'hi']);
  assert.ok(list[0].visualGuidesByLang.en);
  assert.ok(list[0].visualGuidesByLang.hi);

  for (let i = 1; i <= 20; i++) {
    list = upsertLibraryItem(list, {
      ...SAMPLE_DSA_LECTURE,
      id: `ws-${i}`,
      videoId: `vid${String(i).padStart(8, '0')}`,
      title: `Video ${i}`,
    });
  }
  assert.equal(list.length, MAX_LIBRARY_ITEMS);
  assert.equal(list[0].title, 'Video 20');

  const afterDelete = deleteLibraryItem(list, list[0].videoId);
  assert.equal(afterDelete.length, MAX_LIBRARY_ITEMS - 1);
});

test('pdfExport builds safe filenames, escapes HTML, plans non-splitting A4 pages, and creates printable HTML', () => {
  assert.equal(
    buildSafeExportFilename('Data Structures & Algorithms!', 'en', 'pdf'),
    'MindFlow-Data-Structures-Algorithms-EN.pdf'
  );
  assert.equal(
    buildSafeExportFilename('डेटा स्ट्रक्चर गाइड', 'hi', 'html'),
    'MindFlow-Study-Guide-HI.html'
  );
  assert.equal(
    escapeHtml('<script>alert("x")</script>'),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
  );

  // Two 160mm blocks cannot fit on one 274mm A4 page -> pushed cleanly onto page 2 without splitting
  const plan = planA4BlockPlacements([160, 160, 100], 274, 4.5);
  assert.equal(plan.pageCount, 2);
  assert.equal(plan.placements[0].pageIndex, 0);
  assert.equal(plan.placements[1].pageIndex, 1);
  assert.equal(plan.placements[2].pageIndex, 1);
  assert.equal(plan.placements[1].sliceStartRatio, 0);
  assert.equal(plan.placements[1].sliceEndRatio, 1);

  // Extra-tall 400mm block slices cleanly across 2 pages
  const tallPlan = planA4BlockPlacements([400], 274, 4.5);
  assert.equal(tallPlan.pageCount, 2);
  assert.equal(tallPlan.placements.length, 2);
  assert.equal(tallPlan.placements[0].sliceStartRatio, 0);
  assert.equal(tallPlan.placements[1].sliceEndRatio, 1);

  const html = buildStandalonePrintableHtml(SAMPLE_VISUAL_GUIDES_BY_LANGUAGE.hi, {
    theme: 'obsidian',
    showVideoFrames: true,
    showWebImages: true,
    showDiagrams: true,
    showInsights: true,
  });
  assert.ok(html.includes('Noto Sans Devanagari'));
  assert.ok(html.includes('#0F172A'));
  assert.ok(html.includes('window.print()'));
  assert.ok(html.includes('<svg'));
});

test('parseTimestampToSeconds and formatSecondsToTimestamp preserve HH:MM:SS hours accurately', () => {
  assert.equal(parseTimestampToSeconds('09:15:30'), 33330);
  assert.equal(formatSecondsToTimestamp(33330), '9:15:30');
  assert.equal(parseTimestampToSeconds('1:45:20'), 6320);
  assert.equal(formatSecondsToTimestamp(6320), '1:45:20');
  assert.equal(parseTimestampToSeconds('[10:02:15]'), 36135);
  assert.equal(formatSecondsToTimestamp(36135), '10:02:15');
  assert.equal(parseTimestampToSeconds('00:45'), 45);
  assert.equal(formatSecondsToTimestamp(45), '00:45');
  assert.equal(parseTimestampToSeconds('59:59'), 3599);
  assert.equal(formatSecondsToTimestamp(3599), '59:59');
  assert.equal(formatSecondsToTimestamp(3600), '1:00:00');
  assert.equal(clampTimestampSeconds(40000, 36000), 36000);

  // normalizeTimestampPair trusts explicit H:MM:SS label when AI mistakenly passes minute-level seconds
  const repaired = normalizeTimestampPair(135, '2:15:00', 36000);
  assert.equal(repaired.seconds, 8100);
  assert.equal(repaired.label, '2:15:00');
});

test('compressTranscriptStratified covers 0% to 100% of a 10-hour marathon transcript without early truncation', () => {
  // Generate 3,600 segments across 10 hours (1 segment every 10s, >260,000 chars total)
  const segments: TranscriptCaptionSegment[] = [];
  for (let i = 0; i < 3600; i++) {
    const sec = i * 10;
    const hour = Math.floor(sec / 3600);
    segments.push({
      startSeconds: sec,
      text: `Hour ${hour} lecture explanation segment #${i} covering core algorithms, memory layouts, and real engineering trade-offs.`,
    });
  }

  const result = compressTranscriptStratified(segments, 36000, [], 120000);
  assert.equal(result.coverageMode, 'timeline-sampled');
  assert.ok(result.bucketCount >= 24 && result.bucketCount <= 32);
  assert.ok(result.text.length <= 122000);
  assert.equal(result.effectiveDurationSeconds, 36000);
  assert.ok(result.coveredStartSeconds <= 60);
  assert.ok(result.coveredEndSeconds >= 35500);
  // Confirm beginning (Hour 0), middle (Hour 5), and end (Hour 9) are all represented
  assert.ok(result.text.includes('Hour 0 lecture'));
  assert.ok(result.text.includes('Hour 5 lecture'));
  assert.ok(result.text.includes('Hour 9 lecture'));
  assert.ok(result.text.includes('[9:'));

  // Short transcript stays verbatim in full-transcript mode
  const shortRes = compressTranscriptStratified(segments.slice(0, 40), 400, [], 120000);
  assert.equal(shortRes.coverageMode, 'full-transcript');
  assert.equal(shortRes.bucketCount, 1);
});

test('extractChaptersFromDescription, extractChaptersFromYtInitialData, and getDurationScaleProfile work across tiers', () => {
  const desc = [
    'Full 10-Hour Computer Science Course:',
    '0:00 Introduction & Setup',
    '01:15:20 Dynamic Programming Mastery',
    '05:40:00 Distributed Systems & Consensus',
    '09:58:10 Final Capstone Architecture',
  ].join('\n');

  const descChapters = extractChaptersFromDescription(desc, 36500);
  assert.equal(descChapters.length, 4);
  assert.equal(descChapters[1].startSeconds, 4520);
  assert.equal(descChapters[1].timestampLabel, '1:15:20');
  assert.equal(descChapters[3].startSeconds, 35890);
  assert.equal(descChapters[3].timestampLabel, '9:58:10');

  const fakeHtml = `{"chapterRenderer":{"title":{"simpleText":"Intro"},"timeRangeStartMillis":0}},{"chapterRenderer":{"title":{"simpleText":"Graphs & Paths"},"timeRangeStartMillis":7200000}}`;
  const ytChapters = extractChaptersFromYtInitialData(fakeHtml, 10800);
  assert.equal(ytChapters.length, 2);
  assert.equal(ytChapters[1].timestampLabel, '2:00:00');

  assert.equal(getDurationScaleProfile(600).tier, 'short');
  assert.equal(getDurationScaleProfile(2400).tier, 'medium');
  assert.equal(getDurationScaleProfile(7200).tier, 'long');
  const mega = getDurationScaleProfile(36000);
  assert.equal(mega.tier, 'mega');
  assert.equal(mega.mainNodesMax, 10);
  assert.equal(mega.scriptChaptersMax, 22);
  assert.ok(mega.maxOutputTokens >= 20000);
});

test('computeDynamicMindmapLayout positions 10 main modules and 5 expanded sub-nodes each without overlaps', () => {
  const accents = ['violet', 'cyan', 'emerald', 'indigo'] as const;
  const megaNodes: MindmapNode[] = [
    {
      id: 'root',
      title: '10-Hour Full Systems Course',
      shortSubtitle: 'Complete curriculum',
      timestampLabel: '00:00',
      timestampSeconds: 0,
      isRoot: true,
      accent: 'root',
      icon: 'cpu',
      position: { x: 460, y: 280 },
      keyPoints: [],
      simplifiedAnalogy: 'Root analogy',
    },
    ...Array.from({ length: 10 }, (_, idx): MindmapNode => {
      const id = `mod-${idx + 1}`;
      const accent = accents[idx % accents.length];
      return {
        id,
        title: `Module ${idx + 1}`,
        shortSubtitle: `Hour ${idx} core topic`,
        timestampLabel: formatSecondsToTimestamp(idx * 3600),
        timestampSeconds: idx * 3600,
        accent,
        icon: 'layers',
        position: { x: 0, y: 0 },
        keyPoints: [],
        simplifiedAnalogy: 'Analogy',
        subNodes: Array.from({ length: 5 }, (_, sIdx) => ({
          id: `${id}-sub-${sIdx + 1}`,
          parentId: id,
          title: `Subtopic ${sIdx + 1}`,
          shortSubtitle: 'Detail',
          timestampLabel: formatSecondsToTimestamp(idx * 3600 + sIdx * 600),
          timestampSeconds: idx * 3600 + sIdx * 600,
          accent,
          icon: 'book',
          keyPoints: [],
          realLifeExample: 'Example',
          simplifiedAnalogy: 'Analogy',
        })),
      };
    }),
  ];

  const collapsed = computeDynamicMindmapLayout(megaNodes, []);
  assert.equal(collapsed.mains.length, 10);
  assert.equal(collapsed.mains.filter((m) => m.side === 'left').length, 5);
  assert.equal(collapsed.mains.filter((m) => m.side === 'right').length, 5);

  const expanded = computeDynamicMindmapLayout(megaNodes, [
    'mod-1',
    'mod-2',
    'mod-5',
    'mod-6',
    'mod-9',
    'mod-10',
  ]);
  assert.equal(expanded.mains.length, 10);
  assert.equal(expanded.subs.length, 30);

  // Verify zero vertical overlap on both left and right columns for mains and subs
  for (const side of ['left', 'right'] as const) {
    const sideMains = expanded.mains
      .filter((m) => m.side === side)
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < sideMains.length; i++) {
      assert.ok(sideMains[i].y - sideMains[i - 1].y >= 150);
    }

    const sideSubs = expanded.subs
      .filter((s) => s.side === side)
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < sideSubs.length; i++) {
      assert.ok(sideSubs[i].y - sideSubs[i - 1].y >= 88);
    }
  }
});

test('isValidYouTubeId, isSafeHttpUrl, and parseWorkspaceShareParams validate inputs and deep-links safely', () => {
  assert.equal(isValidYouTubeId('8hly31xKli0'), true);
  assert.equal(isValidYouTubeId('manual-transcript'), false);
  assert.equal(isValidYouTubeId('../etc/passwd'), false);
  assert.equal(isValidYouTubeId('short'), false);

  assert.equal(isSafeHttpUrl('https://developer.mozilla.org/en-US/'), true);
  assert.equal(isSafeHttpUrl('http://example.com/docs'), true);
  assert.equal(isSafeHttpUrl('javascript:alert(1)'), false);
  assert.equal(isSafeHttpUrl('data:text/html,<script>'), false);
  assert.equal(isSafeHttpUrl('not a url'), false);

  const parsed = parseWorkspaceShareParams('?v=8hly31xKli0&t=525&lang=hi');
  assert.deepEqual(parsed, {
    videoId: '8hly31xKli0',
    startSeconds: 525,
    language: 'hi',
  });

  const hhmmssParsed = parseWorkspaceShareParams('?v=8hly31xKli0&t=1:45:20&lang=hinglish');
  assert.deepEqual(hhmmssParsed, {
    videoId: '8hly31xKli0',
    startSeconds: 6320,
    language: 'hinglish',
  });

  const invalidParsed = parseWorkspaceShareParams('?v=bad-id&t=-10&lang=fr');
  assert.deepEqual(invalidParsed, {
    videoId: null,
    startSeconds: null,
    language: null,
  });
});

test('buildDynamicChatPrompts, buildYouTubeThumbnailUrl, and filterLibraryItems behave accurately', () => {
  const enPrompts = buildDynamicChatPrompts(SAMPLE_DSA_LECTURE, 'en');
  const firstEnTitle = SAMPLE_DSA_LECTURE.nodes.find((n) => !n.isRoot)?.title || '';
  assert.equal(enPrompts.length, 3);
  assert.ok(firstEnTitle.length > 0 && enPrompts[0].includes(firstEnTitle));

  const hiPrompts = buildDynamicChatPrompts(SAMPLE_DSA_BY_LANGUAGE.hi, 'hi');
  const firstHiTitle = SAMPLE_DSA_BY_LANGUAGE.hi.nodes.find((n) => !n.isRoot)?.title || '';
  assert.equal(hiPrompts.length, 3);
  assert.ok(firstHiTitle.length > 0 && hiPrompts[0].includes(firstHiTitle));

  assert.equal(
    buildYouTubeThumbnailUrl('8hly31xKli0'),
    'https://i.ytimg.com/vi/8hly31xKli0/hqdefault.jpg'
  );
  assert.equal(buildYouTubeThumbnailUrl('manual-transcript'), '');
  assert.equal(buildYouTubeThumbnailUrl('invalid'), '');

  const list = upsertLibraryItem(
    upsertLibraryItem([], SAMPLE_DSA_BY_LANGUAGE.en),
    {
      ...SAMPLE_DSA_LECTURE,
      id: 'ws-sys',
      videoId: 'dQw4w9WgXcQ',
      title: 'Distributed Systems Architecture',
      channel: 'MIT OpenCourseWare',
      videoCategory: 'Systems',
    }
  );
  assert.equal(filterLibraryItems(list, '').length, 2);
  assert.equal(filterLibraryItems(list, 'distributed').length, 1);
  assert.equal(filterLibraryItems(list, 'MIT').length, 1);
  assert.equal(filterLibraryItems(list, 'nonexistent-topic').length, 0);
});

test('isDemoWorkspace and isDemoLibraryEntry distinguish built-in sample lectures from live analyses', () => {
  assert.equal(isDemoWorkspace(SAMPLE_DSA_LECTURE), true);
  assert.equal(isDemoWorkspace(SAMPLE_DSA_BY_LANGUAGE.hi), true);
  assert.equal(isDemoWorkspace(SAMPLE_DSA_BY_LANGUAGE.hinglish), true);

  // Legacy saved demo workspace without explicit isDemo flag is still recognized
  const legacyDemo = { ...SAMPLE_DSA_LECTURE, isDemo: undefined, id: 'dsa-masterclass-en' };
  assert.equal(isDemoWorkspace(legacyDemo), true);

  // User-analyzed workspace is never mislabeled as demo even if it uses the same videoId
  const liveWorkspace = {
    ...SAMPLE_DSA_LECTURE,
    id: 'live-8hly31xKli0-en-1700000000',
    isDemo: false,
  };
  assert.equal(isDemoWorkspace(liveWorkspace), false);

  const demoList = upsertLibraryItem([], SAMPLE_DSA_BY_LANGUAGE.en);
  assert.equal(isDemoLibraryEntry(demoList[0]), true);

  const liveList = upsertLibraryItem([], liveWorkspace);
  assert.equal(isDemoLibraryEntry(liveList[0]), false);
});

test('parseDetailedShareParams validates deep-links and findClosestNodeForTimestamp expands nested sub-nodes', () => {
  const valid = parseDetailedShareParams('?v=8hly31xKli0&t=965&lang=hi');
  assert.equal(valid.hasShareParams, true);
  assert.equal(valid.videoId, '8hly31xKli0');
  assert.equal(valid.startSeconds, 965);
  assert.equal(valid.language, 'hi');
  assert.equal(valid.invalidVideoId, false);
  assert.equal(valid.invalidTimestamp, false);
  assert.equal(valid.invalidLanguage, false);

  const invalid = parseDetailedShareParams('?v=bad-id&t=-15&lang=de');
  assert.equal(invalid.hasShareParams, true);
  assert.equal(invalid.videoId, null);
  assert.equal(invalid.startSeconds, null);
  assert.equal(invalid.language, null);
  assert.equal(invalid.invalidVideoId, true);
  assert.equal(invalid.invalidTimestamp, true);
  assert.equal(invalid.invalidLanguage, true);

  const empty = parseDetailedShareParams('');
  assert.equal(empty.hasShareParams, false);

  // Closest match for 16:05 (965s) in SAMPLE_DSA_LECTURE is nested sub-node "sub-trees-graphs" under "types-of-ds"
  const subMatch = findClosestNodeForTimestamp(SAMPLE_DSA_LECTURE.nodes, 965);
  assert.ok(subMatch);
  assert.equal(subMatch.nodeId, 'sub-trees-graphs');
  assert.equal(subMatch.parentIdToExpand, 'types-of-ds');

  // Closest match for 18:30 (1110s) is main node "common-algorithms"
  const mainMatch = findClosestNodeForTimestamp(SAMPLE_DSA_LECTURE.nodes, 1110);
  assert.ok(mainMatch);
  assert.equal(mainMatch.nodeId, 'common-algorithms');
  assert.equal(mainMatch.parentIdToExpand, null);
});

test('shouldZoomOnWheel requires Ctrl/Cmd modifier and computeWheelZoomDelta returns bounded steps', () => {
  assert.equal(shouldZoomOnWheel({ ctrlKey: false, metaKey: false, deltaY: -120 }), false);
  assert.equal(shouldZoomOnWheel({ ctrlKey: true, metaKey: false, deltaY: -120 }), true);
  assert.equal(shouldZoomOnWheel({ ctrlKey: false, metaKey: true, deltaY: 120 }), true);
  assert.equal(shouldZoomOnWheel({ ctrlKey: true, metaKey: false, deltaY: 0 }), false);

  const zoomInStep = computeWheelZoomDelta(-120, 0);
  const zoomOutStep = computeWheelZoomDelta(120, 0);
  assert.ok(zoomInStep > 0 && zoomInStep <= 0.14);
  assert.ok(zoomOutStep < 0 && zoomOutStep >= -0.14);
  assert.equal(computeWheelZoomDelta(0, 0), 0);
});

test('YouTubePlayerSyncController queues seeks before ready, validates origins, avoids autoplay, and reports errors', () => {
  assert.equal(isTrustedYouTubeOrigin('https://www.youtube.com'), true);
  assert.equal(isTrustedYouTubeOrigin('https://www.youtube-nocookie.com'), true);
  assert.equal(isTrustedYouTubeOrigin('https://evil.example.com'), false);

  // Untrusted origin messages are rejected
  assert.equal(
    parseYouTubeMessage(JSON.stringify({ event: 'onReady' }), 'https://evil.example.com'),
    null
  );

  // Verify buildSeekCommand emits only seekTo (never playVideo)
  const seekCmd = buildSeekCommand(965.8);
  assert.equal(seekCmd.event, 'command');
  assert.equal(seekCmd.func, 'seekTo');
  assert.deepEqual(seekCmd.args, [965, true]);

  const handshakes = buildHandshakeCommands(1);
  assert.ok(handshakes.some((h) => h.event === 'listening'));
  assert.ok(handshakes.some((h) => h.func === 'addEventListener' && h.args?.[0] === 'onReady'));
  assert.ok(handshakes.some((h) => h.func === 'addEventListener' && h.args?.[0] === 'onError'));

  const ctrl = new YouTubePlayerSyncController();
  ctrl.resetForVideo('8hly31xKli0', 0, false);

  // Seek requested before onReady is queued, NOT sent prematurely
  const queued = ctrl.requestSeek(965);
  assert.equal(queued.length, 0);
  assert.equal(ctrl.getSnapshot().hasPendingSeek, true);
  assert.equal(ctrl.getSnapshot().selectedChapterSeconds, 965);

  // When YouTube fires onReady from a trusted origin, queued seek flushes once without playVideo
  const onReadyRes = ctrl.handleMessage(
    JSON.stringify({ event: 'onReady' }),
    'https://www.youtube.com'
  );
  assert.equal(onReadyRes.handled, true);
  assert.equal(onReadyRes.commandsToSend.length, 1);
  assert.equal(onReadyRes.commandsToSend[0].func, 'seekTo');
  assert.deepEqual(onReadyRes.commandsToSend[0].args, [965, true]);
  assert.equal(ctrl.getSnapshot().status, 'ready');
  assert.equal(ctrl.getSnapshot().hasPendingSeek, false);

  // Subsequent seeks execute immediately once ready (still no unsolicited playVideo)
  const immediate = ctrl.requestSeek(1110);
  assert.equal(immediate.length, 1);
  assert.equal(immediate[0].func, 'seekTo');
  assert.deepEqual(immediate[0].args, [1110, true]);

  // Playback progress updates independently from selected chapter
  const progressRes = ctrl.handleMessage(
    JSON.stringify({ event: 'infoDelivery', info: { currentTime: 423.4, playerState: 1 } }),
    'https://www.youtube.com'
  );
  assert.equal(progressRes.handled, true);
  assert.equal(ctrl.getSnapshot().playbackSeconds, 423);
  assert.equal(ctrl.getSnapshot().selectedChapterSeconds, 1110);
  assert.equal(ctrl.getSnapshot().isPlaying, true);

  // Error event surfaces friendly message
  const errRes = ctrl.handleMessage(
    JSON.stringify({ event: 'onError', info: 150 }),
    'https://www.youtube.com'
  );
  assert.equal(errRes.handled, true);
  assert.equal(ctrl.getSnapshot().status, 'error');
  assert.equal(ctrl.getSnapshot().errorCode, 150);
  assert.ok(ctrl.getSnapshot().errorMessage?.includes('disabled embedded'));
});

test('manualTranscript generates distinct IDs, never inherits unrelated videos, and preserves sourceType in library', () => {
  const idA = createManualTranscriptId('First custom lecture notes about databases and B-trees.');
  const idB = createManualTranscriptId('Second custom lecture notes about compilers and LLVM.');
  assert.equal(isManualTranscriptId(idA), true);
  assert.equal(isManualTranscriptId(idB), true);
  assert.notEqual(idA, idB);

  // Transcript without optional URL produces transcript-only identity
  const standalone = resolveManualTranscriptIdentity({
    transcript: 'Notes about Raft consensus protocol',
    optionalYouTubeUrl: '',
  });
  assert.equal(standalone.ok, true);
  assert.equal(standalone.sourceType, 'manual-transcript');
  assert.equal(standalone.youtubeUrl, '');
  assert.equal(isManualTranscriptId(standalone.videoId), true);

  // Optional valid YouTube URL links cleanly
  const linked = resolveManualTranscriptIdentity({
    transcript: 'Notes about DSA',
    optionalYouTubeUrl: 'https://youtu.be/8hly31xKli0',
  });
  assert.equal(linked.ok, true);
  assert.equal(linked.sourceType, 'youtube');
  assert.equal(linked.videoId, '8hly31xKli0');
  assert.equal(linked.youtubeUrl, 'https://www.youtube.com/watch?v=8hly31xKli0');

  // Invalid optional URL is flagged
  const invalidOpt = resolveManualTranscriptIdentity({
    transcript: 'Notes',
    optionalYouTubeUrl: 'https://example.com/nope',
  });
  assert.equal(invalidOpt.ok, false);
  assert.ok(invalidOpt.error);

  // Library storage keeps transcript-only workspaces distinct with empty youtubeUrl/thumbnailUrl
  const manualWorkspace: LectureWorkspace = {
    ...SAMPLE_DSA_LECTURE,
    id: `analyzed-${standalone.videoId}-en`,
    videoId: standalone.videoId,
    youtubeUrl: '',
    sourceType: 'manual-transcript',
    isDemo: false,
    title: 'Raft Consensus Study Notes',
    channel: 'Manual Transcript',
  };
  assert.equal(isManualTranscriptWorkspace(manualWorkspace), true);
  const lib = upsertLibraryItem([], manualWorkspace);
  assert.equal(lib[0].sourceType, 'manual-transcript');
  assert.equal(lib[0].youtubeUrl, '');
  assert.equal(lib[0].thumbnailUrl, '');
});

test('contextRetrieval indexes late chapters for chat Q&A, validates citations, and balances Visual PDF context', () => {
  // Build a large 10-hour synthetic workspace with 30 transcript chapters and a distinctive Hour-9 concept
  const chapters = Array.from({ length: 30 }, (_, idx) => {
    const startSec = idx * 1200;
    const isLateTarget = idx === 28; // 9:20:00
    return {
      id: `ch-${idx + 1}`,
      nodeId: `mod-${Math.min(10, Math.floor(idx / 3) + 1)}`,
      title: isLateTarget
        ? 'Hour 9: Raft Leader Election & Split-Vote Mitigation'
        : `Chapter ${idx + 1}: Core Module Section`,
      topicTag: isLateTarget ? 'Consensus' : `Module ${idx + 1}`,
      startLabel: formatSecondsToTimestamp(startSec),
      startSeconds: startSec,
      endLabel: formatSecondsToTimestamp(startSec + 1190),
      endSeconds: startSec + 1190,
      keyTakeaway: isLateTarget
        ? 'Randomized election timeouts prevent repeated split votes in Raft clusters.'
        : `Detailed engineering breakdown for section ${idx + 1} covering memory and latency.`,
      accent: 'cyan' as const,
      lines: [
        {
          timestampLabel: formatSecondsToTimestamp(startSec + 30),
          timestampSeconds: startSec + 30,
          text: isLateTarget
            ? 'In Raft consensus at nine hours twenty minutes, randomized election timeouts between 150ms and 300ms break split-vote ties reliably.'
            : `Transcript explanation line for chapter ${idx + 1} with extended details `.repeat(12),
        },
      ],
    };
  });

  const longWorkspace = {
    title: '10-Hour Distributed Systems Course',
    channel: 'Systems Academy',
    videoCategory: 'Computer Science',
    durationLabel: '10:00:00',
    videoDurationSeconds: 36000,
    tldw: ['Covers storage, networking, and Raft consensus across 10 hours.'],
    nodes: SAMPLE_DSA_LECTURE.nodes,
    cheatSheet: SAMPLE_DSA_LECTURE.cheatSheet,
    transcript: chapters,
  };

  // Ask a question specifically about Hour-9 (Chapter 29, which old .slice(0, 24) & .slice(0, 24000) dropped!)
  const retrieved = retrieveChatContext(
    longWorkspace,
    'How does Raft prevent split votes during leader election?',
    { maxChars: 9000 }
  );
  assert.ok(retrieved.contextText.length <= 9200);
  assert.ok(retrieved.contextText.includes('Raft Leader Election'));
  assert.ok(retrieved.contextText.includes('150ms and 300ms'));
  assert.ok(retrieved.validTimestampSeconds.includes(28 * 1200));

  // validateChatCitations keeps verified timestamps and drops hallucinated/out-of-range ones
  const validated = validateChatCitations(
    [
      { label: '9:20:00', seconds: 33600, topic: 'Raft Leader Election' },
      { label: '99:00:00', seconds: 356400, topic: 'Hallucinated timestamp' },
      { label: '4:13:00', seconds: 15180, topic: 'Random ungrounded moment' },
    ],
    retrieved.validTimestampSeconds,
    36000
  );
  assert.equal(validated.length, 1);
  assert.equal(validated[0].seconds, 33600);
  assert.equal(validated[0].label, '9:20:00');

  // buildVisualGuideContext covers beginning (Chapter 1), middle, and end (Hour 9 Raft) within budget
  const guideCtx = buildVisualGuideContext(longWorkspace, { maxChars: 12000 });
  assert.ok(guideCtx.length <= 12200);
  assert.ok(guideCtx.includes('Chapter 1'));
  assert.ok(guideCtx.includes('Raft Leader Election'));
});

test('chatStorage validates payloads, isolates videos, enforces caps, and recovers from malformed JSON', () => {
  assert.deepEqual(parseStoredChatPayload('not valid json{{{'), createEmptyChatStore());
  assert.deepEqual(parseStoredChatPayload('{"version":999}'), createEmptyChatStore());

  let store = createEmptyChatStore();
  store = appendChatMessageToStore(store, 'vidA1234567', {
    id: 'm1',
    role: 'user',
    content: 'Explain binary search',
    createdAt: 1000,
  });
  store = appendChatMessageToStore(store, 'vidB7654321', {
    id: 'm2',
    role: 'user',
    content: 'Explain Raft consensus',
    createdAt: 2000,
  });

  // Strict per-video isolation
  assert.equal(store.byVideo['vidA1234567']?.messages.length, 1);
  assert.equal(store.byVideo['vidB7654321']?.messages.length, 1);

  // Round-trip serialization
  const parsed = parseStoredChatPayload(JSON.stringify(store));
  assert.equal(parsed.byVideo['vidA1234567']?.messages[0].content, 'Explain binary search');

  // Clear only one video
  const cleared = clearVideoChatFromStore(parsed, 'vidA1234567');
  assert.equal(cleared.byVideo['vidA1234567'], undefined);
  assert.equal(cleared.byVideo['vidB7654321']?.messages.length, 1);

  // Enforce per-video message cap and max-videos cap
  let capped = createEmptyChatStore();
  for (let v = 0; v < MAX_STORED_CHAT_VIDEOS + 5; v++) {
    for (let m = 0; m < MAX_MESSAGES_PER_VIDEO + 4; m++) {
      capped = appendChatMessageToStore(capped, `vid${String(v).padStart(8, '0')}`, {
        id: `m-${v}-${m}`,
        role: m % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${m} for video ${v}`,
        createdAt: v * 1000 + m,
      });
    }
  }
  const pruned = pruneChatStore(capped);
  assert.equal(Object.keys(pruned.byVideo).length, MAX_STORED_CHAT_VIDEOS);
  for (const thread of Object.values(pruned.byVideo)) {
    assert.ok(thread.messages.length <= MAX_MESSAGES_PER_VIDEO);
  }
});

test('compressPlainTextStratified and sampleItemsEvenly preserve 0%–100% coverage without prefix truncation', () => {
  const intro = 'INTRODUCTION_MARKER: Fundamentals of compiler design. ';
  const middle = 'MIDDLE_MARKER: Intermediate representation and SSA optimization. ';
  const finale = 'CONCLUSION_MARKER: Register allocation and final machine code generation.';
  const filler = 'Filler prose about lexical tokens and syntax trees. '.repeat(220);
  const massivePlain = intro + filler + middle + filler + finale;

  const compressed = compressPlainTextStratified(massivePlain, 6000);
  assert.equal(compressed.coverageMode, 'timeline-sampled');
  assert.ok(compressed.text.includes('INTRODUCTION_MARKER'));
  assert.ok(compressed.text.includes('MIDDLE_MARKER'));
  assert.ok(compressed.text.includes('CONCLUSION_MARKER'));
  assert.ok(compressed.segmentCount >= 8);

  const sampled = sampleItemsEvenly(
    Array.from({ length: 100 }, (_, i) => i),
    10
  );
  assert.equal(sampled.length, 10);
  assert.equal(sampled[0], 0);
  assert.equal(sampled[sampled.length - 1], 99);
});

test('detectContentDomain and getAdaptiveScaleProfile tailor scale and domain without artificial padding', () => {
  assert.equal(
    detectContentDomain({
      title: 'Python Asyncio & Backend API Architecture',
      description: 'Learn async functions, SQL database indexing, and Docker deployment.',
    }),
    'programming-technical'
  );
  assert.equal(
    detectContentDomain({
      title: 'Thermodynamics: Entropy, Energy & Carnot Equation',
      description: 'Derive key physics formulas, theorems, and quantum energy states.',
    }),
    'stem-quantitative'
  );

  const shortSimple = getAdaptiveScaleProfile({
    durationSeconds: 300,
    chapterCount: 3,
    transcriptCharLength: 1800,
    domain: 'theory-conceptual',
  });
  assert.equal(shortSimple.mainNodesMin, 3);
  assert.equal(shortSimple.tldwMin, 4);
  assert.equal(shortSimple.tldwMax, 6);

  const denseCourse = getAdaptiveScaleProfile({
    durationSeconds: 7200,
    chapterCount: 16,
    transcriptCharLength: 90000,
    domain: 'programming-technical',
  });
  assert.ok(denseCourse.mainNodesMin >= 8);
  assert.ok(denseCourse.scriptChaptersMin >= 16);
});

test('normalizeAndDeduplicateWorkspace cleans duplicate branches, empty chapters, invalid nodeIds, and out-of-range timestamps', () => {
  const messy: LectureWorkspace = {
    ...SAMPLE_DSA_LECTURE,
    videoDurationSeconds: 1800,
    tldw: [
      'Arrays give O(1) index access in contiguous memory.',
      'Arrays give O(1) index access in contiguous memory.',
      'Hash maps trade memory for O(1) average lookup.',
    ],
    nodes: [
      SAMPLE_DSA_LECTURE.nodes[0],
      {
        ...SAMPLE_DSA_LECTURE.nodes[1],
        id: 'mod-1',
        title: 'Linear Structures & Arrays',
        timestampSeconds: 120,
      },
      {
        ...SAMPLE_DSA_LECTURE.nodes[1],
        id: 'mod-1-dup',
        title: 'Linear Structures & Arrays',
        timestampSeconds: 135,
      },
      {
        ...SAMPLE_DSA_LECTURE.nodes[2],
        id: 'mod-2',
        title: 'Trees & Graph Traversal',
        timestampSeconds: 1650,
      },
    ],
    transcript: [
      {
        id: 'empty-sec',
        nodeId: 'non-existent-id',
        title: 'Empty Chapter',
        topicTag: 'Empty',
        startLabel: '00:10',
        startSeconds: 10,
        accent: 'cyan',
        lines: [],
      },
      {
        id: 'valid-sec',
        nodeId: 'non-existent-id',
        title: 'Linear Arrays Deep Dive',
        topicTag: 'Arrays',
        startLabel: '02:00',
        startSeconds: 120,
        keyTakeaway: 'Contiguous memory enables constant-time indexing.',
        accent: 'violet',
        lines: [
          {
            id: 'l1',
            timestampLabel: '02:05',
            timestampSeconds: 125,
            text: 'Contiguous memory blocks let CPUs prefetch adjacent elements.',
          },
          {
            id: 'l2',
            timestampLabel: '99:00',
            timestampSeconds: 5940,
            text: 'Clamped late line should not exceed video duration.',
          },
        ],
      },
    ],
  };

  const cleaned = normalizeAndDeduplicateWorkspace(messy);
  assert.equal(cleaned.tldw.length, 2);
  // Root + 2 unique main modules (duplicate mod-1-dup merged)
  assert.equal(cleaned.nodes.length, 3);
  // Empty script section removed, invalid nodeId repaired to nearest valid module ('mod-1')
  assert.equal(cleaned.transcript.length, 1);
  assert.equal(cleaned.transcript[0].nodeId, 'mod-1');
  // Out-of-range timestamp clamped to 1800s
  assert.ok(cleaned.transcript[0].lines.every((l) => l.timestampSeconds <= 1800));
});

test('validateWorkspaceQuality flags missing late coverage and uncovered chapters, and passes balanced workspaces', () => {
  const truncatedLate: LectureWorkspace = {
    ...SAMPLE_DSA_LECTURE,
    videoDurationSeconds: 3600,
    nodes: SAMPLE_DSA_LECTURE.nodes.map((n, idx) => ({
      ...n,
      timestampSeconds: idx * 60,
      timestampLabel: formatSecondsToTimestamp(idx * 60),
      subNodes: (n.subNodes ?? []).map((s, sIdx) => ({
        ...s,
        timestampSeconds: idx * 60 + sIdx * 10,
        timestampLabel: formatSecondsToTimestamp(idx * 60 + sIdx * 10),
      })),
    })),
    transcript: SAMPLE_DSA_LECTURE.transcript.slice(0, 2).map((sec, idx) => ({
      ...sec,
      startSeconds: idx * 90,
      startLabel: formatSecondsToTimestamp(idx * 90),
      lines: sec.lines.map((l) => ({
        ...l,
        timestampSeconds: idx * 90 + 10,
        timestampLabel: formatSecondsToTimestamp(idx * 90 + 10),
      })),
    })),
  };

  const badReport = validateWorkspaceQuality(truncatedLate, {
    expectedDurationSeconds: 3600,
    minModules: 4,
    minChapters: 4,
  });
  assert.equal(badReport.needsAiRepair, true);
  assert.ok(badReport.issues.some((i) => i.code === 'MISSING_LATE_COVERAGE'));
  assert.ok(badReport.score < 75);

  const goodReport = validateWorkspaceQuality(SAMPLE_DSA_LECTURE, {
    expectedDurationSeconds: SAMPLE_DSA_LECTURE.videoDurationSeconds,
    minModules: 3,
    minChapters: 3,
  });
  assert.equal(goodReport.isAcceptable, true);
  assert.equal(goodReport.needsAiRepair, false);
});

test('retrieveChatContext supports comparison queries (both sides), quiz stratification, and new cheat sheet fields', () => {
  const enrichedWorkspace: LectureWorkspace = {
    ...SAMPLE_DSA_LECTURE,
    cheatSheet: {
      ...SAMPLE_DSA_LECTURE.cheatSheet,
      keyRulesOrSteps: [
        {
          title: 'Binary Search Invariant',
          detail: 'Always maintain sorted bounds left <= right and compute mid safely.',
          category: 'rule',
          codeSnippet: 'const mid = left + Math.floor((right - left) / 2);',
          timestampLabel: '22:10',
          timestampSeconds: 1330,
        },
      ],
      commonMistakes: [
        {
          mistake: 'Using unsorted arrays with binary search.',
          correction: 'Sort the array first or use a hash set for O(1) lookups.',
          timestampLabel: '23:00',
          timestampSeconds: 1380,
        },
      ],
      quickRevisionPoints: ['BFS uses a Queue while DFS uses a Stack or recursion.'],
    },
  };

  const workspaceRecord = enrichedWorkspace as unknown as Record<string, unknown>;
  const compareResult = retrieveChatContext(
    workspaceRecord,
    'Compare Arrays vs Hash Tables from this video',
    { maxChars: 10000 }
  );
  assert.ok(compareResult.contextText.toLowerCase().includes('array'));
  assert.ok(compareResult.contextText.toLowerCase().includes('hash'));

  const quizResult = retrieveChatContext(
    workspaceRecord,
    'Give me 5 practice revision questions from across the whole video',
    { maxChars: 10000 }
  );
  assert.ok(quizResult.selectedChunkIds.length >= 4);

  const guideCtx = buildVisualGuideContext(workspaceRecord, { maxChars: 16000 });
  assert.ok(guideCtx.includes('Binary Search Invariant'));
  assert.ok(guideCtx.includes('Using unsorted arrays with binary search.'));
});

test('parseStructuredSimplification, adaptSvgDiagramToTheme, sanitizeOptionalSvgDiagram, and keyTakeaway script search', () => {
  const structured = parseStructuredSimplification({
    simpleDefinition: 'A hash table maps keys directly to array slots.',
    easyExplanation: 'A hash function turns each key into an index so lookups avoid scanning every element.',
    realLifeAnalogy: 'Like a coat-check ticket number that tells the attendant the exact rack hook immediately.',
    relevantExample: 'Looking up a user profile by username in O(1) average time.',
    oneLineTakeaway: 'Hash tables trade extra memory for near-instant key lookups.',
  });
  assert.ok(structured);
  const formatted = formatStructuredSimplification(structured);
  assert.ok(formatted.includes('1. Simple Definition:'));
  assert.ok(formatted.includes('5. One-Line Takeaway:'));
  assert.equal(parseStructuredSimplification({ simpleDefinition: 'incomplete' }), null);

  // Conditional diagram returns empty string when includeDiagram is false
  assert.equal(
    sanitizeOptionalSvgDiagram(undefined, false, 'Intro Overview', ['Overview']),
    ''
  );
  // Theme adaptation converts dark obsidian SVG palette for Warm and Blueprint themes
  const obsidianSvg = sanitizeSvgDiagram(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 220"><rect width="600" height="220" fill="#0b1120"/><text fill="#f8fafc">Hello</text></svg>',
    'Test',
    ['A']
  );
  const warmSvg = adaptSvgDiagramToTheme(obsidianSvg, 'warm');
  assert.ok(!warmSvg.toLowerCase().includes('#0b1120'));
  assert.ok(warmSvg.toLowerCase().includes('#faf6ee'));
  const blueprintSvg = adaptSvgDiagramToTheme(obsidianSvg, 'blueprint');
  assert.ok(!blueprintSvg.toLowerCase().includes('#0b1120'));
  assert.ok(blueprintSvg.toLowerCase().includes('#f8fafc'));

  // Standalone HTML export uses theme-harmonized diagram box background (not hardcoded #0b1120) on Warm
  const warmHtml = buildStandalonePrintableHtml(SAMPLE_VISUAL_GUIDES_BY_LANGUAGE.en, {
    theme: 'warm',
    showVideoFrames: false,
    showWebImages: false,
    showDiagrams: true,
    showInsights: true,
  });
  assert.ok(warmHtml.includes('background: #FAF6EE;'));
  assert.ok(!warmHtml.includes('background: #0b1120;'));

  // Script search now matches section.keyTakeaway as well as title/topicTag/lines
  const customSections = [
    {
      ...SAMPLE_DSA_LECTURE.transcript[0],
      keyTakeaway: 'UniqueAmortizedDoublingSignalPhrase for O(1) append.',
    },
  ];
  const matched = filterTranscriptSections(customSections, 'UniqueAmortizedDoublingSignalPhrase');
  assert.equal(matched.length, 1);
});

test('ensureFullTimelineCoverage expands truncated 15-minute output across 0%–100% of a 9h45m (35158s) course', () => {
  const description = [
    '00:00:00 - 00:07:22 — Intro',
    '00:07:23 - 00:34:39 — What is DAX',
    '01:28:18 - 02:13:55 — Aggregation Functions',
    '03:39:11 - 04:08:52 — Filter Functions',
    '05:45:03 - 06:53:46 — Evaluation Contexts & CALCULATE',
    '06:53:47 - 07:45:23 — Time Intelligence Functions',
    '08:30:11 - 09:45:58 — Project & Final End-to-End Dashboard',
  ].join('\n');

  const officialChapters = extractChaptersFromDescription(description, 35158);
  assert.equal(officialChapters.length, 7);
  assert.equal(officialChapters[0].title, 'Intro');
  assert.equal(officialChapters[6].title, 'Project & Final End-to-End Dashboard');

  // Simulate an AI response that stopped after the first 25 minutes with only 1 transcript chapter
  const truncated: LectureWorkspace = {
    ...SAMPLE_DSA_LECTURE,
    title: 'Complete DAX Tutorial for Beginners to Advanced | Power BI Full Course',
    videoDurationSeconds: 35158,
    durationLabel: '9:45:58',
    nodes: [
      {
        ...SAMPLE_DSA_LECTURE.nodes[0],
        id: 'root',
        isRoot: true,
        timestampSeconds: 0,
        timestampLabel: '00:00',
      },
      {
        ...SAMPLE_DSA_LECTURE.nodes[1],
        id: 'node-1',
        title: 'Intro & What is DAX',
        timestampSeconds: 0,
        timestampLabel: '00:00',
        subNodes: [
          {
            ...SAMPLE_DSA_LECTURE.nodes[1].subNodes![0],
            id: 'node-1-sub-1',
            parentId: 'node-1',
            title: 'Calculated Columns vs Measures',
            timestampSeconds: 443,
            timestampLabel: '07:23',
          },
        ],
      },
    ],
    transcript: [
      {
        id: 'chapter-1',
        nodeId: 'node-1',
        title: 'Intro to DAX',
        topicTag: 'Module 1',
        startLabel: '00:00',
        startSeconds: 0,
        endLabel: '25:00',
        endSeconds: 1500,
        accent: 'violet',
        lines: [
          {
            id: 'l-1',
            timestampLabel: '00:00',
            timestampSeconds: 0,
            text: 'Introduction to DAX formulas in Power BI.',
          },
        ],
      },
    ],
  };

  const completed = ensureFullTimelineCoverage(truncated, {
    officialChapters,
    expectedDurationSeconds: 35158,
  });

  const mainModules = completed.nodes.filter((n) => !n.isRoot);
  assert.ok(mainModules.length >= 6);
  assert.ok(mainModules.every((m) => (m.subNodes?.length ?? 0) >= 2));
  assert.ok(completed.transcript.length >= 7);
  const highestTranscriptEnd = Math.max(
    ...completed.transcript.map((s) => s.endSeconds ?? s.startSeconds)
  );
  assert.ok(highestTranscriptEnd >= Math.floor(35158 * 0.85));

  const report = validateWorkspaceQuality(completed, {
    expectedDurationSeconds: 35158,
    officialChapters,
    minModules: 6,
    minChapters: 7,
  });
  assert.equal(report.isAcceptable, true);
  assert.ok(report.score >= 80);
});




