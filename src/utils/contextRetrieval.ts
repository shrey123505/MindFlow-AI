import type { VideoChatCitation } from '../types/mindflow';
import { formatSecondsToTimestamp, parseTimestampToSeconds } from './youtube';

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'could', 'did', 'do', 'does',
  'for', 'from', 'give', 'had', 'has', 'have', 'he', 'her', 'here', 'him', 'his', 'how',
  'i', 'if', 'in', 'into', 'is', 'it', 'its', 'me', 'more', 'my', 'of', 'on', 'or', 'our',
  'please', 'she', 'should', 'so', 'tell', 'that', 'the', 'their', 'them', 'then', 'there',
  'these', 'they', 'this', 'to', 'us', 'was', 'we', 'were', 'what', 'when', 'where', 'which',
  'who', 'why', 'will', 'with', 'would', 'you', 'your', 'video', 'explain', 'about',
  // Common Hinglish / Hindi filler words
  'kya', 'hai', 'hain', 'kaise', 'mein', 'me', 'ko', 'ka', 'ki', 'ke', 'se', 'par', 'aur',
  'ye', 'yeh', 'wo', 'is', 'ek', 'bhi', 'kar', 'karta', 'karti', 'samjhao', 'batao', 'bataiye',
  'क्या', 'है', 'हैं', 'कैसे', 'में', 'को', 'का', 'की', 'के', 'से', 'पर', 'और', 'यह', 'इस', 'एक',
]);

const OVERVIEW_INTENT_REGEX =
  /\b(summar|overview|tl;?dw|whole video|entire video|all topics|main points|key takeaways|revision|full video|poore video|पूरे वीडियो|सारांश|रिवीज़न)\b/i;

const LATE_INTENT_REGEX =
  /\b(end|ending|final|last|conclusion|closing|wrap up|later|akhir|ant|अंत|आखिरी)\b/i;

const EARLY_INTENT_REGEX =
  /\b(start|beginning|intro|introduction|opening|first|shuru|प्रारंभ|शुरुआत)\b/i;

const COMPARE_INTENT_REGEX =
  /\b(compar|differen|vs\.?|versus|contrast|better than|trade-?off|pros? and cons?|distinction|antar|fark|अंतर|तुलना)\b/i;

const QUIZ_INTENT_REGEX =
  /\b(quiz|revision question|practice question|test me|mcq|flashcard|exam question|self[- ]check|interview question|प्रश्‍न|प्रश्न|अभ्यास)\b/i;

const CHAPTER_INTENT_REGEX =
  /\b(chapter|module|section|part|unit)\s*#?\s*(\d{1,2})\b/i;

export interface IndexedWorkspaceChunk {
  id: string;
  kind: 'node' | 'subnode' | 'transcript' | 'cheatsheet';
  title: string;
  timestampSeconds: number;
  timestampLabel: string;
  endTimestampLabel?: string;
  positionRatio: number; // 0.0 (start) -> 1.0 (end)
  searchText: string;
  formattedText: string;
}

export interface RetrievedChatContext {
  contextText: string;
  selectedChunkIds: string[];
  totalIndexedChunks: number;
  hasStrongMatch: boolean;
  validTimestampSeconds: number[];
}

/** Extracts normalized Unicode tokens (supports Latin + Devanagari scripts). */
export function tokenizeSearchText(text: string): string[] {
  if (typeof text !== 'string' || !text.trim()) return [];
  const matches = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return matches.filter((tok) => tok.length >= 2 && !STOPWORDS.has(tok));
}

function asArray(val: unknown): Record<string, unknown>[] {
  return Array.isArray(val)
    ? val.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    : [];
}

function resolveTimestamp(secRaw: unknown, labelRaw: unknown): { seconds: number; label: string } {
  const parsedLabelSec = typeof labelRaw === 'string' ? parseTimestampToSeconds(labelRaw) : 0;
  const numSec =
    typeof secRaw === 'number' && Number.isFinite(secRaw) && secRaw >= 0
      ? Math.floor(secRaw)
      : 0;
  const seconds = parsedLabelSec > 0 && numSec === 0 ? parsedLabelSec : numSec;
  const label =
    typeof labelRaw === 'string' && /^\d{1,2}:\d{2}(?::\d{2})?$/.test(labelRaw.trim())
      ? labelRaw.trim()
      : formatSecondsToTimestamp(seconds);
  return { seconds, label };
}

function estimateWorkspaceDurationSeconds(workspace: Record<string, unknown>): number {
  const explicit =
    typeof workspace.videoDurationSeconds === 'number' &&
    Number.isFinite(workspace.videoDurationSeconds) &&
    workspace.videoDurationSeconds > 0
      ? Math.floor(workspace.videoDurationSeconds)
      : 0;
  const labelSec =
    typeof workspace.durationLabel === 'string'
      ? parseTimestampToSeconds(workspace.durationLabel)
      : 0;

  let maxSeen = Math.max(explicit, labelSec);
  for (const node of asArray(workspace.nodes)) {
    const nTs = resolveTimestamp(node.timestampSeconds, node.timestampLabel);
    maxSeen = Math.max(maxSeen, nTs.seconds);
    for (const sub of asArray(node.subNodes)) {
      const sTs = resolveTimestamp(sub.timestampSeconds, sub.timestampLabel);
      maxSeen = Math.max(maxSeen, sTs.seconds);
    }
  }
  for (const sec of asArray(workspace.transcript)) {
    const startTs = resolveTimestamp(sec.startSeconds, sec.startLabel);
    const endTs = resolveTimestamp(sec.endSeconds, sec.endLabel);
    maxSeen = Math.max(maxSeen, startTs.seconds, endTs.seconds);
    for (const line of asArray(sec.lines)) {
      const lTs = resolveTimestamp(line.timestampSeconds, line.timestampLabel);
      maxSeen = Math.max(maxSeen, lTs.seconds);
    }
  }
  return Math.max(1, maxSeen);
}

/**
 * Indexes ALL mindmap nodes, sub-nodes, transcript chapters/lines, and cheat sheet items
 * across the entire video so late chapters are never dropped by fixed slices.
 */
export function indexWorkspaceChunks(workspace: Record<string, unknown>): {
  chunks: IndexedWorkspaceChunk[];
  tocLines: string[];
  validTimestampSeconds: number[];
  durationSeconds: number;
} {
  const durationSeconds = estimateWorkspaceDurationSeconds(workspace);
  const chunks: IndexedWorkspaceChunk[] = [];
  const tocLines: string[] = [];
  const validTsSet = new Set<number>();

  // 1. Index ALL Mindmap nodes & ALL sub-nodes
  const nodes = asArray(workspace.nodes);
  nodes.forEach((node, nIdx) => {
    const ts = resolveTimestamp(node.timestampSeconds, node.timestampLabel);
    validTsSet.add(ts.seconds);
    const title = String(node.title ?? `Topic ${nIdx + 1}`).trim();
    const subtitle = String(node.shortSubtitle ?? '').trim();
    const keyPoints = asArray(node.keyPoints)
      .map((kp) => `${String(kp.keyword ?? '').trim()}: ${String(kp.detail ?? '').trim()}`)
      .filter((line) => line.length > 2);
    const example =
      typeof node.realLifeExample === 'string' && node.realLifeExample.trim()
        ? node.realLifeExample.trim()
        : '';
    const analogy =
      typeof node.simplifiedAnalogy === 'string' && node.simplifiedAnalogy.trim()
        ? node.simplifiedAnalogy.trim()
        : '';

    tocLines.push(`- [${ts.label}] (${ts.seconds}s) Module: ${title}`);

    const formattedParts = [
      `[Mindmap Module @ ${ts.label} (${ts.seconds}s)] ${title}`,
      subtitle ? `Summary: ${subtitle}` : '',
      keyPoints.length > 0 ? `Key Points:\n${keyPoints.map((kp) => `  • ${kp}`).join('\n')}` : '',
      example ? `Example: ${example}` : '',
      analogy ? `Analogy: ${analogy}` : '',
    ].filter(Boolean);

    chunks.push({
      id: `node:${String(node.id ?? nIdx)}`,
      kind: 'node',
      title,
      timestampSeconds: ts.seconds,
      timestampLabel: ts.label,
      positionRatio: Math.min(1, ts.seconds / durationSeconds),
      searchText: `${title} ${subtitle} ${keyPoints.join(' ')} ${example} ${analogy}`,
      formattedText: formattedParts.join('\n'),
    });

    // Sub-nodes
    const subNodes = asArray(node.subNodes);
    subNodes.forEach((sub, sIdx) => {
      const sTs = resolveTimestamp(sub.timestampSeconds ?? ts.seconds, sub.timestampLabel ?? ts.label);
      validTsSet.add(sTs.seconds);
      const sTitle = String(sub.title ?? `Subtopic ${sIdx + 1}`).trim();
      const sSub = String(sub.shortSubtitle ?? '').trim();
      const sPoints = asArray(sub.keyPoints)
        .map((kp) => `${String(kp.keyword ?? '').trim()}: ${String(kp.detail ?? '').trim()}`)
        .filter((line) => line.length > 2);
      const sExample =
        typeof sub.realLifeExample === 'string' && sub.realLifeExample.trim()
          ? sub.realLifeExample.trim()
          : '';

      const sFormatted = [
        `[Subtopic under "${title}" @ ${sTs.label} (${sTs.seconds}s)] ${sTitle}`,
        sSub ? `Focus: ${sSub}` : '',
        sPoints.length > 0 ? `Points:\n${sPoints.map((kp) => `  • ${kp}`).join('\n')}` : '',
        sExample ? `Example: ${sExample}` : '',
      ].filter(Boolean);

      chunks.push({
        id: `sub:${String(sub.id ?? `${nIdx}-${sIdx}`)}`,
        kind: 'subnode',
        title: `${title} > ${sTitle}`,
        timestampSeconds: sTs.seconds,
        timestampLabel: sTs.label,
        positionRatio: Math.min(1, sTs.seconds / durationSeconds),
        searchText: `${title} ${sTitle} ${sSub} ${sPoints.join(' ')} ${sExample}`,
        formattedText: sFormatted.join('\n'),
      });
    });
  });

  // 2. Index ALL Transcript sections & ALL lines (never truncated to first 6!)
  const transcript = asArray(workspace.transcript);
  transcript.forEach((sec, tIdx) => {
    const startTs = resolveTimestamp(sec.startSeconds, sec.startLabel);
    const hasEnd = sec.endSeconds !== undefined || sec.endLabel !== undefined;
    const endTs = hasEnd ? resolveTimestamp(sec.endSeconds, sec.endLabel) : null;
    validTsSet.add(startTs.seconds);

    const title = String(sec.title ?? `Chapter ${tIdx + 1}`).trim();
    const topicTag = String(sec.topicTag ?? '').trim();
    const keyTakeaway =
      typeof sec.keyTakeaway === 'string' && sec.keyTakeaway.trim()
        ? sec.keyTakeaway.trim()
        : '';

    const rawLines = asArray(sec.lines);
    const lineStrings: string[] = [];
    for (const line of rawLines) {
      const lTs = resolveTimestamp(line.timestampSeconds ?? startTs.seconds, line.timestampLabel ?? startTs.label);
      validTsSet.add(lTs.seconds);
      const text = String(line.text ?? '').trim();
      if (text) {
        lineStrings.push(`  [${lTs.label}] ${text}`);
      }
    }

    const spanLabel =
      endTs && endTs.seconds > startTs.seconds
        ? `${startTs.label}–${endTs.label}`
        : startTs.label;
    tocLines.push(`- [${spanLabel}] (${startTs.seconds}s) Chapter: ${title}`);

    const formatted = [
      `[Transcript Chapter @ ${spanLabel} (${startTs.seconds}s)] ${title}${topicTag ? ` (${topicTag})` : ''}`,
      keyTakeaway ? `Key Takeaway: ${keyTakeaway}` : '',
      lineStrings.length > 0 ? lineStrings.join('\n') : '',
    ]
      .filter(Boolean)
      .join('\n');

    chunks.push({
      id: `transcript:${String(sec.id ?? tIdx)}`,
      kind: 'transcript',
      title,
      timestampSeconds: startTs.seconds,
      timestampLabel: startTs.label,
      endTimestampLabel: endTs && endTs.seconds > startTs.seconds ? endTs.label : undefined,
      positionRatio: Math.min(1, startTs.seconds / durationSeconds),
      searchText: `${title} ${topicTag} ${keyTakeaway} ${lineStrings.join(' ')}`,
      formattedText: formatted,
    });
  });

  // 3. Index Cheat Sheet definitions & real-world examples
  const cheatSheet = (workspace.cheatSheet && typeof workspace.cheatSheet === 'object'
    ? workspace.cheatSheet
    : {}) as Record<string, unknown>;

  asArray(cheatSheet.definitions).forEach((def, dIdx) => {
    const term = String(def.term ?? '').trim();
    const summary = String(def.summary ?? '').trim();
    const note = String(def.formulaOrNote ?? '').trim();
    if (!term && !summary) return;
    const ts = resolveTimestamp(def.timestampSeconds ?? 0, def.timestampLabel ?? '00:00');
    if (def.timestampSeconds !== undefined || def.timestampLabel !== undefined) {
      validTsSet.add(ts.seconds);
    }
    chunks.push({
      id: `def:${dIdx}`,
      kind: 'cheatsheet',
      title: term || `Concept ${dIdx + 1}`,
      timestampSeconds: ts.seconds,
      timestampLabel: ts.label,
      positionRatio: Math.min(1, ts.seconds / durationSeconds),
      searchText: `${term} ${summary} ${note} ${String(def.moduleLabel ?? '')}`,
      formattedText: `[Cheat Sheet Concept @ ${ts.label}] ${term}: ${summary}${note ? ` | Note: ${note}` : ''}`,
    });
  });

  asArray(cheatSheet.realWorldExamples).forEach((ex, eIdx) => {
    const domain = String(ex.domain ?? '').trim();
    const structure = String(ex.structure ?? '').trim();
    const explanation = String(ex.explanation ?? '').trim();
    if (!domain && !explanation) return;
    const ts = resolveTimestamp(ex.timestampSeconds ?? 0, ex.timestampLabel ?? '00:00');
    validTsSet.add(ts.seconds);
    chunks.push({
      id: `example:${eIdx}`,
      kind: 'cheatsheet',
      title: `${domain} (${structure})`,
      timestampSeconds: ts.seconds,
      timestampLabel: ts.label,
      positionRatio: Math.min(1, ts.seconds / durationSeconds),
      searchText: `${domain} ${structure} ${explanation}`,
      formattedText: `[Real-World Example @ ${ts.label}] ${domain} — ${structure}: ${explanation}`,
    });
  });

  asArray(cheatSheet.keyRulesOrSteps).forEach((item, rIdx) => {
    const title = String(item.title ?? '').trim();
    const detail = String(item.detail ?? '').trim();
    const code = typeof item.codeSnippet === 'string' ? item.codeSnippet.trim() : '';
    if (!title && !detail) return;
    const ts = resolveTimestamp(item.timestampSeconds ?? 0, item.timestampLabel ?? '00:00');
    if (item.timestampSeconds !== undefined || item.timestampLabel !== undefined) {
      validTsSet.add(ts.seconds);
    }
    const category = String(item.category ?? 'rule');
    chunks.push({
      id: `rule:${rIdx}`,
      kind: 'cheatsheet',
      title: title || `Rule ${rIdx + 1}`,
      timestampSeconds: ts.seconds,
      timestampLabel: ts.label,
      positionRatio: Math.min(1, ts.seconds / durationSeconds),
      searchText: `${title} ${detail} ${code} ${category}`,
      formattedText: `[Cheat Sheet ${category.toUpperCase()} @ ${ts.label}] ${title}: ${detail}${code ? `\nCode/Formula:\n${code}` : ''}`,
    });
  });

  asArray(cheatSheet.commonMistakes).forEach((item, mIdx) => {
    const mistake = String(item.mistake ?? '').trim();
    const correction = String(item.correction ?? '').trim();
    if (!mistake && !correction) return;
    const ts = resolveTimestamp(item.timestampSeconds ?? 0, item.timestampLabel ?? '00:00');
    if (item.timestampSeconds !== undefined || item.timestampLabel !== undefined) {
      validTsSet.add(ts.seconds);
    }
    chunks.push({
      id: `mistake:${mIdx}`,
      kind: 'cheatsheet',
      title: `Common Mistake: ${mistake.slice(0, 60)}`,
      timestampSeconds: ts.seconds,
      timestampLabel: ts.label,
      positionRatio: Math.min(1, ts.seconds / durationSeconds),
      searchText: `mistake pitfall misconception ${mistake} ${correction}`,
      formattedText: `[Common Mistake / Distinction @ ${ts.label}] Mistake: ${mistake} | Fix: ${correction}`,
    });
  });

  const revisionPoints = Array.isArray(cheatSheet.quickRevisionPoints)
    ? cheatSheet.quickRevisionPoints.map((p) => String(p ?? '').trim()).filter(Boolean)
    : [];
  if (revisionPoints.length > 0) {
    chunks.push({
      id: 'cheatsheet:revision-points',
      kind: 'cheatsheet',
      title: 'Quick Revision Points',
      timestampSeconds: 0,
      timestampLabel: '00:00',
      positionRatio: 0.5,
      searchText: `revision summary key points ${revisionPoints.join(' ')}`,
      formattedText: `[Quick Revision Points]\n${revisionPoints.map((p) => `  • ${p}`).join('\n')}`,
    });
  }

  return {
    chunks,
    tocLines,
    validTimestampSeconds: Array.from(validTsSet).sort((a, b) => a - b),
    durationSeconds,
  };
}

/** Extracts any explicit timestamps mentioned in the user's question (e.g. "at 1:45:20"). */
function extractMentionedTimestamps(question: string): number[] {
  const matches = question.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g) ?? [];
  return matches.map((m) => parseTimestampToSeconds(m)).filter((s) => Number.isFinite(s) && s >= 0);
}

/**
 * Ranks all indexed workspace chunks against the user's question (plus recent history)
 * and builds a strictly budgeted, complete context string for /api/chat.
 */
export function retrieveChatContext(
  workspace: Record<string, unknown>,
  question: string,
  options?: {
    maxChars?: number;
    recentHistoryText?: string;
  }
): RetrievedChatContext {
  const maxChars = Math.max(2500, options?.maxChars ?? 14000);
  const { chunks, tocLines, validTimestampSeconds, durationSeconds } =
    indexWorkspaceChunks(workspace);

  const queryTokens = tokenizeSearchText(question);
  const historyTokens = options?.recentHistoryText
    ? tokenizeSearchText(options.recentHistoryText).slice(-12)
    : [];
  const mentionedTimestamps = extractMentionedTimestamps(question);
  const lowerQ = question.toLowerCase();
  const isOverview = OVERVIEW_INTENT_REGEX.test(question);
  const isLateIntent = LATE_INTENT_REGEX.test(question);
  const isEarlyIntent = EARLY_INTENT_REGEX.test(question);
  const isCompareIntent = COMPARE_INTENT_REGEX.test(question);
  const isQuizIntent = QUIZ_INTENT_REGEX.test(question);
  const chapterNumMatch = question.match(CHAPTER_INTENT_REGEX);
  const requestedChapterNum = chapterNumMatch ? Number.parseInt(chapterNumMatch[2], 10) : null;

  // For comparison queries ("compare X and Y" / "X vs Y"), extract side-specific token groups
  let compareSides: [string[], string[]] | null = null;
  if (isCompareIntent) {
    const splitMatch = question.split(/\b(?:vs\.?|versus|and|with|or|aur|बनाम|और)\b/i);
    if (splitMatch.length >= 2) {
      const leftTokens = tokenizeSearchText(splitMatch[0]).filter(
        (t) => !COMPARE_INTENT_REGEX.test(t)
      );
      const rightTokens = tokenizeSearchText(splitMatch.slice(1).join(' ')).filter(
        (t) => !COMPARE_INTENT_REGEX.test(t)
      );
      if (leftTokens.length > 0 && rightTokens.length > 0) {
        compareSides = [leftTokens, rightTokens];
      }
    }
  }

  // Compute IDF weights across indexed chunks so rare domain keywords dominate over common ones
  const docFreq = new Map<string, number>();
  const chunkTokenSets = chunks.map((chunk) => {
    const tokens = new Set(tokenizeSearchText(chunk.searchText));
    tokens.forEach((t) => docFreq.set(t, (docFreq.get(t) ?? 0) + 1));
    return tokens;
  });
  const totalDocs = Math.max(1, chunks.length);

  // Track 1-based ordinal for transcript chapters so "chapter 3" / "module 2" hits accurately
  let transcriptOrdinal = 0;
  const transcriptIndexById = new Map<string, number>();
  for (const ch of chunks) {
    if (ch.kind === 'transcript') {
      transcriptOrdinal += 1;
      transcriptIndexById.set(ch.id, transcriptOrdinal);
    }
  }

  const scored = chunks.map((chunk, idx) => {
    const tokenSet = chunkTokenSets[idx];
    const titleTokens = new Set(tokenizeSearchText(chunk.title));
    let score = 0;
    let directMatches = 0;

    for (const qTok of queryTokens) {
      const idf = Math.log(1 + totalDocs / (1 + (docFreq.get(qTok) ?? 0)));
      if (titleTokens.has(qTok)) {
        score += 3.5 * idf;
        directMatches += 1;
      } else if (tokenSet.has(qTok)) {
        score += 1.8 * idf;
        directMatches += 1;
      } else if (qTok.length >= 4) {
        // Prefix/stem match (e.g., "hashing" matches "hash", "graphs" matches "graph")
        for (const cTok of tokenSet) {
          if (cTok.startsWith(qTok.slice(0, 4)) || qTok.startsWith(cTok.slice(0, Math.min(4, cTok.length)))) {
            if (cTok.length >= 4) {
              score += 0.9 * idf;
              directMatches += 0.5;
              break;
            }
          }
        }
      }
    }

    // Exact phrase match against chunk title or body
    const cleanLowerTitle = chunk.title.toLowerCase();
    if (cleanLowerTitle.length >= 4 && lowerQ.includes(cleanLowerTitle)) {
      score += 8;
      directMatches += 2;
    }

    // Explicit chapter/module number boost ("summarize chapter 4")
    if (requestedChapterNum !== null && chunk.kind === 'transcript') {
      const ord = transcriptIndexById.get(chunk.id);
      if (ord === requestedChapterNum) {
        score += 10;
        directMatches += 2;
      }
    }

    // Mild follow-up context boost from recent conversation turns
    for (const hTok of historyTokens) {
      if (tokenSet.has(hTok)) {
        score += 0.25;
      }
    }

    // Explicit timestamp proximity boost (e.g., "what happens at 1:45:00?")
    for (const targetSec of mentionedTimestamps) {
      const dist = Math.abs(chunk.timestampSeconds - targetSec);
      const windowSec = Math.max(180, durationSeconds * 0.08);
      if (dist <= windowSec) {
        score += 6 * (1 - dist / windowSec) + 2;
        directMatches += 1.5;
      }
    }

    // Positional intent boosts for start/end queries
    if (isLateIntent && chunk.positionRatio >= 0.7) {
      score += 3 * chunk.positionRatio;
    }
    if (isEarlyIntent && chunk.positionRatio <= 0.25) {
      score += 2.5 * (1 - chunk.positionRatio);
    }

    // Slight preference for rich transcript chapters when lexical score ties
    if (directMatches > 0 && chunk.kind === 'transcript') {
      score += 0.35;
    }

    return { chunk, score, directMatches, tokenSet };
  });

  scored.sort((a, b) => b.score - a.score || a.chunk.timestampSeconds - b.chunk.timestampSeconds);
  const topDirectMatches = scored[0]?.directMatches ?? 0;
  const hasStrongMatch =
    topDirectMatches >= 1 ||
    isOverview ||
    isLateIntent ||
    isEarlyIntent ||
    isQuizIntent ||
    requestedChapterNum !== null;

  // Build header + full chronological Table of Contents (always covers 0% -> 100%)
  const tldw = Array.isArray(workspace.tldw)
    ? workspace.tldw.map((p) => `- ${String(p)}`).join('\n')
    : '';
  const overviewBlock = [
    `TITLE: ${String(workspace.title ?? 'Video')}`,
    `CHANNEL: ${String(workspace.channel ?? 'Creator')} | CATEGORY: ${String(workspace.videoCategory ?? 'General')} | DURATION: ${String(workspace.durationLabel ?? formatSecondsToTimestamp(durationSeconds))}`,
    tldw ? `KEY TAKEAWAYS:\n${tldw}` : '',
    tocLines.length > 0
      ? `FULL TIMELINE INDEX (0%–100%):\n${tocLines.slice(0, 50).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const selected: IndexedWorkspaceChunk[] = [];
  const selectedIds = new Set<string>();
  let usedChars = overviewBlock.length + 120;

  const tryAddChunk = (chunk: IndexedWorkspaceChunk): boolean => {
    if (selectedIds.has(chunk.id)) return false;
    const needed = chunk.formattedText.length + 2;
    if (usedChars + needed > maxChars) return false;
    selected.push(chunk);
    selectedIds.add(chunk.id);
    usedChars += needed;
    return true;
  };

  // Comparison queries: guarantee top chunks for BOTH compared sides are retrieved first
  if (compareSides) {
    for (const sideTokens of compareSides) {
      const sideRanked = scored
        .map((item) => {
          let sideHits = 0;
          for (const st of sideTokens) {
            if (item.tokenSet.has(st)) sideHits += 1;
          }
          return { chunk: item.chunk, sideHits, score: item.score };
        })
        .filter((x) => x.sideHits > 0)
        .sort((a, b) => b.sideHits - a.sideHits || b.score - a.score);

      for (const hit of sideRanked.slice(0, 3)) {
        tryAddChunk(hit.chunk);
      }
    }
  }

  if ((isOverview || isQuizIntent) && topDirectMatches < 2) {
    // Stratify evenly across early, middle, and late chapters so overview/revision questions represent 0%..100%
    const chronological = [...chunks].sort((a, b) => a.timestampSeconds - b.timestampSeconds);
    const transcriptAndNodes = chronological.filter(
      (c) => c.kind === 'node' || c.kind === 'transcript' || c.kind === 'cheatsheet'
    );
    const pool = transcriptAndNodes.length > 0 ? transcriptAndNodes : chronological;
    const targetSlots = Math.min(14, pool.length);
    for (let i = 0; i < targetSlots; i++) {
      const idx =
        targetSlots === 1
          ? 0
          : Math.round((i * (pool.length - 1)) / (targetSlots - 1));
      tryAddChunk(pool[idx]);
    }
  } else {
    // Take highest-ranked relevant chunks across the ENTIRE video
    for (const item of scored) {
      if (item.score <= 0 && selected.length >= 6) break;
      tryAddChunk(item.chunk);
      if (usedChars >= maxChars - 220) break;
    }

    // If question was vague and few chunks scored > 0, add evenly distributed fallback anchors
    if (selected.length < 4 && chunks.length > 0) {
      const step = Math.max(1, Math.floor(chunks.length / 4));
      for (let i = 0; i < chunks.length; i += step) {
        tryAddChunk(chunks[i]);
      }
    }
  }

  // Present retrieved evidence in chronological order for clean reasoning
  selected.sort((a, b) => a.timestampSeconds - b.timestampSeconds);

  const evidenceBody =
    selected.length > 0
      ? selected.map((c) => c.formattedText).join('\n\n')
      : 'No detailed transcript or concept chunks available.';

  const contextText = `${overviewBlock}\n\nRETRIEVED RELEVANT VIDEO SECTIONS (${selected.length}/${chunks.length} indexed chunks):\n${evidenceBody}`;

  return {
    contextText,
    selectedChunkIds: selected.map((c) => c.id),
    totalIndexedChunks: chunks.length,
    hasStrongMatch,
    validTimestampSeconds,
  };
}

/**
 * Strictly grounds AI chat citations against actual timestamps in the workspace.
 * Rejects out-of-range or completely fabricated timestamps.
 */
export function validateChatCitations(
  rawCitations: Array<{ label?: string; seconds?: number; topic?: string }> | undefined,
  validTimestampSeconds: number[],
  maxDurationSeconds?: number
): VideoChatCitation[] {
  if (!Array.isArray(rawCitations) || rawCitations.length === 0) return [];
  const safeMax =
    typeof maxDurationSeconds === 'number' && maxDurationSeconds > 0
      ? Math.floor(maxDurationSeconds)
      : validTimestampSeconds.length > 0
        ? Math.max(...validTimestampSeconds) + 60
        : undefined;

  const toleranceSec = safeMax && safeMax >= 3600 ? 180 : 60;
  const seenSeconds = new Set<number>();
  const validated: VideoChatCitation[] = [];

  for (const item of rawCitations) {
    if (!item || typeof item !== 'object') continue;
    const labelSec = typeof item.label === 'string' ? parseTimestampToSeconds(item.label) : 0;
    const numSec =
      typeof item.seconds === 'number' && Number.isFinite(item.seconds) && item.seconds >= 0
        ? Math.floor(item.seconds)
        : -1;

    let candidateSec = numSec >= 0 ? numSec : labelSec;
    if (labelSec > 0 && numSec >= 0 && Math.abs(labelSec - numSec) > 300) {
      candidateSec = labelSec;
    }
    if (candidateSec < 0) continue;
    if (safeMax !== undefined && candidateSec > safeMax) continue;

    // Verify timestamp is grounded near a real workspace timestamp
    if (validTimestampSeconds.length > 0) {
      let nearest = validTimestampSeconds[0];
      let minDist = Math.abs(nearest - candidateSec);
      for (const ts of validTimestampSeconds) {
        const dist = Math.abs(ts - candidateSec);
        if (dist < minDist) {
          minDist = dist;
          nearest = ts;
        }
      }
      if (minDist > toleranceSec) {
        // Fabricated timestamp far from any indexed moment in the video -> drop
        continue;
      }
      if (minDist > 15) {
        candidateSec = nearest;
      }
    }

    if (seenSeconds.has(candidateSec)) continue;
    seenSeconds.add(candidateSec);

    validated.push({
      label: formatSecondsToTimestamp(candidateSec),
      seconds: candidateSec,
      topic: String(item.topic ?? 'Jump to moment').trim().slice(0, 80) || 'Jump to moment',
    });

    if (validated.length >= 3) break;
  }

  return validated;
}

/** Evenly selects up to `limit` items across the full 0%..100% array (always keeping first and last). */
function sampleEvenly<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  if (limit <= 1) return items.slice(0, 1);
  const picked: T[] = [];
  const used = new Set<number>();
  for (let i = 0; i < limit; i++) {
    const idx = Math.round((i * (items.length - 1)) / (limit - 1));
    if (!used.has(idx)) {
      used.add(idx);
      picked.push(items[idx]);
    }
  }
  return picked;
}

/**
 * Builds a balanced, complete, strictly budgeted context representation for
 * /api/generate-visual-guide so generated PDFs represent the ENTIRE video
 * (early, middle, AND final chapters) instead of slicing off the tail.
 */
export function buildVisualGuideContext(
  analysisData: Record<string, unknown>,
  options?: { maxChars?: number }
): string {
  const maxChars = Math.max(4000, options?.maxChars ?? 24000);
  const durationSeconds = estimateWorkspaceDurationSeconds(analysisData);

  const metaBudget = Math.floor(maxChars * 0.1);
  const nodesBudget = Math.floor(maxChars * 0.36);
  const transcriptBudget = Math.floor(maxChars * 0.36);
  const cheatSheetBudget = Math.floor(maxChars * 0.18);

  // 1. Metadata + TL;DW
  const tldw = Array.isArray(analysisData.tldw)
    ? analysisData.tldw.map((t) => `- ${String(t)}`).join('\n')
    : '';
  const metaSection = [
    `TITLE: ${String(analysisData.title ?? 'Video Study Guide')}`,
    `CHANNEL: ${String(analysisData.channel ?? 'Creator')}`,
    `CATEGORY: ${String(analysisData.videoCategory ?? 'Explainer')}`,
    `TOTAL DURATION: ${String(analysisData.durationLabel ?? formatSecondsToTimestamp(durationSeconds))} (${durationSeconds}s)`,
    tldw ? `CORE TAKEAWAYS (TL;DW):\n${tldw}` : '',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, metaBudget);

  // 2. Balanced Mindmap Modules & Sub-nodes across 0%..100%
  const allNodes = asArray(analysisData.nodes);
  const rootNode = allNodes.find((n) => Boolean(n.isRoot)) ?? allNodes[0];
  const mainNodes = allNodes.filter((n) => n !== rootNode);
  const sampledMainNodes = sampleEvenly(mainNodes, Math.min(mainNodes.length, 10));
  const orderedNodes = rootNode ? [rootNode, ...sampledMainNodes] : sampledMainNodes;

  const perNodeCap = Math.max(
    260,
    Math.floor(nodesBudget / Math.max(1, orderedNodes.length))
  );
  const nodeBlocks = orderedNodes.map((node, idx) => {
    const ts = resolveTimestamp(node.timestampSeconds, node.timestampLabel);
    const kpText = asArray(node.keyPoints)
      .slice(0, 4)
      .map((kp) => `${String(kp.keyword ?? '')}: ${String(kp.detail ?? '')}`)
      .join('; ');
    const subNodes = sampleEvenly(asArray(node.subNodes), 4).map((sub) => {
      const sTs = resolveTimestamp(sub.timestampSeconds ?? ts.seconds, sub.timestampLabel ?? ts.label);
      const sKp = asArray(sub.keyPoints)
        .slice(0, 2)
        .map((kp) => `${String(kp.keyword ?? '')}: ${String(kp.detail ?? '')}`)
        .join('; ');
      return `  - [${sTs.label}] ${String(sub.title ?? '')}${sKp ? ` (${sKp})` : ''}`;
    });
    const block = [
      `Module ${idx}: [${ts.label}] ${String(node.title ?? '')}`,
      kpText ? `  Points: ${kpText}` : '',
      subNodes.length > 0 ? `  Subtopics:\n${subNodes.join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    return block.length > perNodeCap ? `${block.slice(0, perNodeCap - 1)}…` : block;
  });

  // 3. Balanced Chronological Transcript Coverage (0% -> 100%)
  const allTranscript = asArray(analysisData.transcript).sort((a, b) => {
    const aTs = resolveTimestamp(a.startSeconds, a.startLabel).seconds;
    const bTs = resolveTimestamp(b.startSeconds, b.startLabel).seconds;
    return aTs - bTs;
  });
  const chapterIndexLines =
    allTranscript.length > 18
      ? allTranscript.map((sec, idx) => {
          const startTs = resolveTimestamp(sec.startSeconds, sec.startLabel);
          return `${idx + 1}. [${startTs.label}] ${String(sec.title ?? `Chapter ${idx + 1}`).slice(0, 80)}`;
        })
      : [];
  const chapterIndexHeader =
    chapterIndexLines.length > 0
      ? `COMPLETE CHAPTER INDEX (${allTranscript.length} chapters):\n${chapterIndexLines.join('\n')}\n`
      : '';
  const remainingTranscriptBudget = Math.max(
    1800,
    transcriptBudget - chapterIndexHeader.length
  );

  const sampledChapters = sampleEvenly(allTranscript, Math.min(allTranscript.length, 18));
  const perChapterCap = Math.max(
    180,
    Math.floor(remainingTranscriptBudget / Math.max(1, sampledChapters.length))
  );
  const transcriptBlocks = sampledChapters.map((sec, idx) => {
    const startTs = resolveTimestamp(sec.startSeconds, sec.startLabel);
    const endTs =
      sec.endSeconds !== undefined || sec.endLabel !== undefined
        ? resolveTimestamp(sec.endSeconds, sec.endLabel)
        : null;
    const span =
      endTs && endTs.seconds > startTs.seconds
        ? `${startTs.label}–${endTs.label}`
        : startTs.label;
    const takeaway =
      typeof sec.keyTakeaway === 'string' && sec.keyTakeaway.trim()
        ? `Takeaway: ${sec.keyTakeaway.trim()}`
        : '';
    // Pick representative opening + middle + closing lines within the chapter
    const lines = sampleEvenly(asArray(sec.lines), 3).map((l) => {
      const lTs = resolveTimestamp(l.timestampSeconds ?? startTs.seconds, l.timestampLabel ?? startTs.label);
      return `  [${lTs.label}] ${String(l.text ?? '').trim()}`;
    });
    const block = [
      `Chapter ${idx + 1} [${span}] ${String(sec.title ?? '')}`,
      takeaway ? `  ${takeaway}` : '',
      lines.join('\n'),
    ]
      .filter(Boolean)
      .join('\n');
    return block.length > perChapterCap ? `${block.slice(0, perChapterCap - 1)}…` : block;
  });

  if (chapterIndexHeader) {
    transcriptBlocks.unshift(chapterIndexHeader.trim());
  }

  // 4. Balanced Cheat Sheet Concepts & Examples
  const cs = (analysisData.cheatSheet && typeof analysisData.cheatSheet === 'object'
    ? analysisData.cheatSheet
    : {}) as Record<string, unknown>;
  const defs = sampleEvenly(asArray(cs.definitions), 10).map((d) => {
    const ts = resolveTimestamp(d.timestampSeconds ?? 0, d.timestampLabel ?? '00:00');
    return `- [${ts.label}] ${String(d.term ?? '')}: ${String(d.summary ?? '')}${d.formulaOrNote ? ` (${String(d.formulaOrNote)})` : ''}`;
  });
  const rows = sampleEvenly(asArray(cs.complexityRows), 8).map(
    (r) => `- ${String(r.structureOrAlgo ?? '')}: ${String(r.access ?? '')} | ${String(r.search ?? '')} | ${String(r.space ?? '')} (${String(r.ratingLabel ?? '')})`
  );
  const examples = sampleEvenly(asArray(cs.realWorldExamples), 6).map((ex) => {
    const ts = resolveTimestamp(ex.timestampSeconds ?? 0, ex.timestampLabel ?? '00:00');
    return `- [${ts.label}] ${String(ex.domain ?? '')} (${String(ex.structure ?? '')}): ${String(ex.explanation ?? '')}`;
  });
  const rules = sampleEvenly(asArray(cs.keyRulesOrSteps), 6).map((r) => {
    const code = typeof r.codeSnippet === 'string' && r.codeSnippet.trim() ? ` | Code: ${r.codeSnippet.trim().slice(0, 140)}` : '';
    return `- ${String(r.title ?? '')}: ${String(r.detail ?? '')}${code}`;
  });
  const mistakes = sampleEvenly(asArray(cs.commonMistakes), 5).map(
    (m) => `- Mistake: ${String(m.mistake ?? '')} → Fix: ${String(m.correction ?? '')}`
  );
  const revision = Array.isArray(cs.quickRevisionPoints)
    ? cs.quickRevisionPoints.slice(0, 6).map((p) => `- ${String(p)}`)
    : [];
  const cheatSheetSection = [
    defs.length > 0 ? `KEY CONCEPTS:\n${defs.join('\n')}` : '',
    rows.length > 0 ? `COMPARISON MATRIX:\n${rows.join('\n')}` : '',
    examples.length > 0 ? `REAL-WORLD EXAMPLES:\n${examples.join('\n')}` : '',
    rules.length > 0 ? `RULES, PROCESSES & PATTERNS:\n${rules.join('\n')}` : '',
    mistakes.length > 0 ? `COMMON MISTAKES & DISTINCTIONS:\n${mistakes.join('\n')}` : '',
    revision.length > 0 ? `QUICK REVISION POINTS:\n${revision.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, cheatSheetBudget);

  const assembled = [
    metaSection,
    nodeBlocks.length > 0
      ? `\nMINDMAP MODULES (0%–100% OF VIDEO):\n${nodeBlocks.join('\n')}`
      : '',
    transcriptBlocks.length > 0
      ? `\nCHRONOLOGICAL TRANSCRIPT COVERAGE (${sampledChapters.length}/${allTranscript.length} CHAPTERS, 0%–100%):\n${transcriptBlocks.join('\n')}`
      : '',
    cheatSheetSection ? `\nCHEAT SHEET HIGHLIGHTS:\n${cheatSheetSection}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return assembled.slice(0, maxChars);
}
