import type {
  CheatSheetMistakeItem,
  CheatSheetRuleOrStep,
  DefinitionCard,
  KeyPoint,
  LanguageCode,
  LectureWorkspace,
  MindmapNode,
  MindmapSubNode,
  StructuredSimplification,
  TranscriptLine,
  TranscriptSection,
} from '../types/mindflow';
import {
  getDurationScaleProfile,
  type DurationScaleProfile,
  type VideoChapterMarker,
} from './longVideo.ts';
import { formatSecondsToTimestamp } from './youtube.ts';

export type ContentDomain =
  | 'programming-technical'
  | 'stem-quantitative'
  | 'theory-conceptual'
  | 'practical-workflow'
  | 'discussion-analysis';

export interface AdaptiveScaleProfile extends DurationScaleProfile {
  domain: ContentDomain;
  tldwMin: number;
  tldwMax: number;
}

export interface WorkspaceQualityIssue {
  code:
    | 'MISSING_LATE_COVERAGE'
    | 'MISSING_MIDDLE_COVERAGE'
    | 'MISSING_EARLY_COVERAGE'
    | 'TOO_FEW_MODULES'
    | 'TOO_FEW_CHAPTERS'
    | 'DUPLICATE_NODES'
    | 'THIN_CHEATSHEET'
    | 'INVALID_TIMESTAMPS'
    | 'EMPTY_SCRIPT_SECTIONS'
    | 'MISSING_CHAPTER_ALIGNMENT';
  severity: 'critical' | 'warning';
  message: string;
}

export interface WorkspaceQualityReport {
  isAcceptable: boolean;
  needsAiRepair: boolean;
  score: number; // 0..100
  coverageSpanRatio: number; // 0..1
  coveredBuckets: { early: boolean; middle: boolean; late: boolean };
  issues: WorkspaceQualityIssue[];
  missingChapterHints: string[];
}

/**
 * Evenly samples up to `limit` elements from any ordered array,
 * ALWAYS preserving the first and last items so late sections are never dropped.
 */
export function sampleItemsEvenly<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return [...items];
  if (limit <= 0) return [];
  if (limit === 1) return [items[0]];

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
 * Stratified compressor for plain-text transcripts without timestamps.
 * Never truncates blindly at `text.slice(0, maxChars)` — instead partitions 0%..100%
 * into evenly distributed segments so introduction, middle, and conclusion are all preserved.
 */
export function compressPlainTextStratified(
  rawText: string,
  maxChars = 120000
): {
  text: string;
  coverageMode: 'full-transcript' | 'timeline-sampled';
  segmentCount: number;
} {
  const cleaned = rawText.replace(/\r\n/g, '\n').trim();
  if (cleaned.length <= maxChars) {
    return {
      text: cleaned,
      coverageMode: 'full-transcript',
      segmentCount: 1,
    };
  }

  const rawSegs = Math.min(24, Math.max(8, Math.floor(maxChars / 450)));
  const segmentCount = rawSegs % 2 === 0 ? rawSegs : rawSegs - 1;
  const totalLen = cleaned.length;
  const sliceSpan = totalLen / segmentCount;
  const perSegmentBudget = Math.max(240, Math.floor((maxChars - segmentCount * 64) / segmentCount));
  const chunks: string[] = [];

  for (let i = 0; i < segmentCount; i++) {
    const startOffset = Math.floor(i * sliceSpan);
    const endOffset = i === segmentCount - 1 ? totalLen : Math.floor((i + 1) * sliceSpan);
    const rawSlice = cleaned.slice(startOffset, endOffset).trim();
    if (!rawSlice) continue;

    let sampled = rawSlice;
    if (rawSlice.length > perSegmentBudget) {
      // Keep opening + closing context inside each segment cleanly on whitespace boundaries
      const headBudget = Math.floor(perSegmentBudget * 0.62);
      const tailBudget = Math.max(120, perSegmentBudget - headBudget - 12);
      const head = rawSlice.slice(0, headBudget).replace(/\s+\S*$/, '').trim();
      const tail = rawSlice.slice(-tailBudget).replace(/^\S*\s+/, '').trim();
      sampled = `${head}\n[...]\n${tail}`;
    }

    const startPct = Math.round((i / segmentCount) * 100);
    const endPct = Math.round(((i + 1) / segmentCount) * 100);
    chunks.push(
      `=== TRANSCRIPT SEGMENT ${i + 1}/${segmentCount} (${startPct}%–${endPct}%) ===\n${sampled}`
    );
  }

  return {
    text: chunks.join('\n\n'),
    coverageMode: 'timeline-sampled',
    segmentCount: chunks.length,
  };
}

/**
 * Classifies the primary educational domain of a video from its title, description,
 * chapters, and transcript sample so prompts tailor cheat sheets, examples, and diagrams.
 */
export function detectContentDomain(input: {
  title?: string;
  description?: string;
  keywords?: string[];
  transcriptSample?: string;
}): ContentDomain {
  const corpus = [
    input.title ?? '',
    input.description?.slice(0, 2000) ?? '',
    (input.keywords ?? []).join(' '),
    input.transcriptSample?.slice(0, 6000) ?? '',
  ]
    .join(' ')
    .toLowerCase();

  const scores: Record<ContentDomain, number> = {
    'programming-technical': 0,
    'stem-quantitative': 0,
    'theory-conceptual': 0,
    'practical-workflow': 0,
    'discussion-analysis': 0,
  };

  const countMatches = (pattern: RegExp) => (corpus.match(pattern) ?? []).length;

  scores['programming-technical'] = countMatches(
    /\b(code|coding|python|javascript|typescript|java|c\+\+|react|node|sql|database|api|algorithm|data structure|array|linked list|hash|binary|docker|kubernetes|git|function|class|async|compiler|linux|system design|backend|frontend|software|programming)\b/g
  );
  scores['stem-quantitative'] = countMatches(
    /\b(equation|formula|theorem|calculus|integral|derivative|physics|quantum|chemistry|biology|cell|dna|thermodynamics|voltage|circuit|matrix|probability|statistics|vector|force|energy|entropy|molecule)\b/g
  );
  scores['theory-conceptual'] = countMatches(
    /\b(history|philosophy|economics|psychology|sociology|literature|politics|civilization|theory|concept|framework|cognitive|ethics|constitution|geography|principles|macroeconomics|finance|investing)\b/g
  );
  scores['practical-workflow'] = countMatches(
    /\b(tutorial|how to|step by step|guide|workflow|setup|install|build|design|figma|excel|photoshop|productivity|habit|recipe|workout|strategy|checklist)\b/g
  );
  scores['discussion-analysis'] = countMatches(
    /\b(podcast|interview|conversation|debate|review|documentary|case study|story|founder|episode|guest|breakdown|analysis)\b/g
  );

  let best: ContentDomain = 'theory-conceptual';
  let bestScore = 0;
  for (const [domain, score] of Object.entries(scores) as Array<[ContentDomain, number]>) {
    if (score > bestScore) {
      bestScore = score;
      best = domain;
    }
  }
  return bestScore >= 2 ? best : 'theory-conceptual';
}

/**
 * Computes complexity- and duration-aware structural guidelines (rather than rigid arbitrary limits)
 * using duration, official chapter count, and transcript density.
 */
export function getAdaptiveScaleProfile(params: {
  durationSeconds?: number;
  chapterCount?: number;
  transcriptCharLength?: number;
  domain?: ContentDomain;
}): AdaptiveScaleProfile {
  const base = getDurationScaleProfile(params.durationSeconds);
  const chapterCount = params.chapterCount ?? 0;
  const transcriptChars = params.transcriptCharLength ?? 0;
  const domain = params.domain ?? 'theory-conceptual';

  // Adjust complexity up or down slightly when actual topic count / transcript density warrants it
  let mainNodesMin = base.mainNodesMin;
  let mainNodesMax = base.mainNodesMax;
  let scriptChaptersMin = base.scriptChaptersMin;
  let scriptChaptersMax = base.scriptChaptersMax;

  if (chapterCount >= 10) {
    mainNodesMin = Math.min(10, Math.max(mainNodesMin, Math.min(8, Math.ceil(chapterCount / 2))));
    mainNodesMax = Math.min(12, Math.max(mainNodesMax, Math.min(11, chapterCount)));
    scriptChaptersMin = Math.min(20, Math.max(scriptChaptersMin, Math.min(chapterCount, 16)));
    scriptChaptersMax = Math.min(30, Math.max(scriptChaptersMax, Math.min(chapterCount + 2, 28)));
  } else if (transcriptChars > 0 && transcriptChars < 2800 && (params.durationSeconds ?? 0) < 420) {
    // Very concise short video: do not pad artificially
    mainNodesMin = 3;
    mainNodesMax = 5;
    scriptChaptersMin = 3;
    scriptChaptersMax = 6;
  }

  return {
    ...base,
    domain,
    mainNodesMin,
    mainNodesMax,
    scriptChaptersMin,
    scriptChaptersMax,
    tldwMin: 4,
    tldwMax: 6,
  };
}

/**
 * High-quality, consistent multilingual style guidelines for English, Hindi, and Hinglish.
 */
export function getLanguagePromptGuide(language: LanguageCode): string {
  switch (language) {
    case 'hi':
      return [
        'LANGUAGE (Natural Hindi — Devanagari script):',
        '- Write ALL human-readable explanations, titles, takeaways, analogies, cheat sheet text, and summaries in clear, natural, modern Devanagari Hindi that students immediately understand.',
        '- Avoid stiff, overly Sanskritized textbook phrasing or unnatural word-for-word literal translations.',
        '- Keep standard technical terminology, symbols, code syntax, formulas, and widely used acronyms accurate and readable (e.g., API, Big-O, Hash Table, Recursion, TCP/IP, DNA, GDP — you may briefly clarify complex terms in simple Hindi).',
        '- Preserve exact meaning, structure, timestamps, and technical correctness.',
      ].join('\n');
    case 'hinglish':
      return [
        'LANGUAGE (Natural Conversational Hinglish — Latin script):',
        '- Write ALL human-readable content in clean, natural everyday Indian Hinglish using Latin script (e.g., "Hash Table key ko index me convert karke O(1) lookup deta hai").',
        '- Keep commonly used technical terms, formulas, and code syntax in accurate English, and explain tricky concepts clearly in conversational Hinglish.',
        '- Avoid awkward or overly formal phrasing; keep it friendly, crisp, and study-ready.',
        '- Preserve exact meaning, structure, timestamps, and technical correctness.',
      ].join('\n');
    default:
      return [
        'LANGUAGE (Clear Academic & Beginner-Friendly English):',
        '- Write ALL content in crisp, clear, well-structured, beginner-friendly English.',
        '- Explain technical terms accurately without jargon overload or filler.',
        '- Preserve exact meaning, structure, timestamps, and technical correctness.',
      ].join('\n');
  }
}

/** Returns subject-specific guidance for Cheat Sheet generation without inventing unsupported facts. */
export function getDomainCheatSheetGuidance(domain: ContentDomain): string {
  switch (domain) {
    case 'programming-technical':
      return [
        '- Subject focus (Programming / Technical): Include accurate definitions, key terminology, architecture/complexity rules, step-by-step workflows, comparisons/trade-offs, common bugs/mistakes, and concise practical code examples ONLY when directly supported by the source video.',
        '- Keep code snippets short, clean, and syntactically valid; never invent APIs or syntax not discussed in the video.',
      ].join('\n');
    case 'stem-quantitative':
      return [
        '- Subject focus (STEM / Quantitative): Emphasize precise definitions, formulas/equations with variable meanings, governing laws/principles, step-by-step problem-solving processes, worked examples, comparisons, and common calculation/conceptual mistakes directly supported by the source.',
      ].join('\n');
    case 'practical-workflow':
      return [
        '- Subject focus (Practical Guide / Workflow): Emphasize clear step-by-step processes, decision rules, tool/method comparisons, pros and cons, concrete examples, common pitfalls to avoid, and actionable revision points supported by the source.',
      ].join('\n');
    case 'discussion-analysis':
      return [
        '- Subject focus (Discussion / Documentary / Analysis): Emphasize core thesis, key arguments and evidence, important concepts/frameworks, comparisons between perspectives, real-world case examples, and concluding takeaways supported by the source.',
      ].join('\n');
    default:
      return [
        '- Subject focus (Theory / Conceptual): Emphasize crystal-clear definitions, conceptual frameworks, important distinctions, comparisons (advantages/disadvantages), concrete examples, common misconceptions, and quick revision points supported by the source.',
      ].join('\n');
  }
}

function normalizeTextForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeNormalized(text: string): Set<string> {
  const tokens = normalizeTextForComparison(text)
    .split(' ')
    .filter((t) => t.length >= 2);
  return new Set(tokens);
}

/** Computes Jaccard token similarity in [0, 1] for duplicate detection. */
export function textSimilarity(a: string, b: string): number {
  const normA = normalizeTextForComparison(a);
  const normB = normalizeTextForComparison(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;
  const setA = tokenizeNormalized(normA);
  const setB = tokenizeNormalized(normB);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const tok of setA) {
    if (setB.has(tok)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function deduplicateKeyPoints(points: KeyPoint[]): KeyPoint[] {
  const result: KeyPoint[] = [];
  for (const kp of points) {
    const keyword = String(kp.keyword ?? '').trim();
    const detail = String(kp.detail ?? '').trim();
    if (!keyword && !detail) continue;
    const combined = `${keyword} ${detail}`;
    const isDup = result.some(
      (existing) => textSimilarity(`${existing.keyword} ${existing.detail}`, combined) >= 0.78
    );
    if (!isDup) {
      result.push({
        keyword: keyword || 'Key Concept',
        detail: detail || keyword,
      });
    }
  }
  return result.slice(0, 6);
}

function deduplicateStrings(items: string[], similarityThreshold = 0.72, limit = 8): string[] {
  const result: string[] = [];
  for (const raw of items) {
    const cleaned = String(raw ?? '').trim();
    if (cleaned.length < 4) continue;
    const isDup = result.some(
      (existing) => textSimilarity(existing, cleaned) >= similarityThreshold
    );
    if (!isDup) {
      result.push(cleaned);
    }
    if (result.length >= limit) break;
  }
  return result;
}

/**
 * Deterministic post-generation cleaner & deduplicator:
 * - Removes duplicate main mindmap branches (merging unique subNodes/keyPoints cleanly)
 * - Removes duplicate sub-nodes within a branch
 * - Removes redundant TL;DW takeaways
 * - Removes empty/duplicate script chapters and repairs invalid `nodeId` references
 * - Ensures chronological ordering and clean timestamp bounds
 */
export function normalizeAndDeduplicateWorkspace(
  workspace: LectureWorkspace
): LectureWorkspace {
  const maxDur =
    typeof workspace.videoDurationSeconds === 'number' &&
    Number.isFinite(workspace.videoDurationSeconds) &&
    workspace.videoDurationSeconds > 0
      ? Math.floor(workspace.videoDurationSeconds)
      : undefined;

  const clampSec = (s: number) => {
    const safe = Number.isFinite(s) && s >= 0 ? Math.floor(s) : 0;
    return maxDur ? Math.min(safe, maxDur) : safe;
  };

  // 1. Deduplicate TL;DW takeaways (keep 4-6 distinct, non-redundant points)
  const cleanTldw = deduplicateStrings(workspace.tldw ?? [], 0.68, 6);

  // 2. Clean & deduplicate Mindmap Nodes (Root + Level 2 + Level 3)
  const rawNodes = Array.isArray(workspace.nodes) ? workspace.nodes : [];
  const rootCandidate = rawNodes.find((n) => n.isRoot) ?? rawNodes[0];
  const nonRootRaw = rawNodes.filter((n) => n !== rootCandidate);

  const cleanSubNodes = (
    subs: MindmapSubNode[] | undefined,
    parentId: string
  ): MindmapSubNode[] => {
    if (!Array.isArray(subs)) return [];
    const deduped: MindmapSubNode[] = [];
    for (const sub of subs) {
      const title = String(sub.title ?? '').trim();
      if (!title) continue;
      const existing = deduped.find((d) => textSimilarity(d.title, title) >= 0.8);
      const safeKeyPoints = deduplicateKeyPoints(sub.keyPoints ?? []);
      if (existing) {
        existing.keyPoints = deduplicateKeyPoints([...existing.keyPoints, ...safeKeyPoints]);
        continue;
      }
      const sec = clampSec(sub.timestampSeconds);
      deduped.push({
        ...sub,
        parentId,
        title: title.slice(0, 90),
        shortSubtitle: String(sub.shortSubtitle ?? '').trim().slice(0, 140),
        timestampSeconds: sec,
        timestampLabel: formatSecondsToTimestamp(sec),
        keyPoints:
          safeKeyPoints.length > 0
            ? safeKeyPoints
            : [
                {
                  keyword: 'Core Concept',
                  detail: String(sub.shortSubtitle ?? title).trim(),
                },
              ],
        realLifeExample: String(sub.realLifeExample ?? '').trim(),
        simplifiedAnalogy: String(sub.simplifiedAnalogy ?? '').trim(),
      });
    }
    return deduped
      .sort((a, b) => a.timestampSeconds - b.timestampSeconds)
      .slice(0, 6);
  };

  const mergedMains: MindmapNode[] = [];
  for (const node of nonRootRaw) {
    const title = String(node.title ?? '').trim();
    if (!title) continue;
    const sec = clampSec(node.timestampSeconds);
    const safeKeyPoints = deduplicateKeyPoints(node.keyPoints ?? []);
    const duplicate = mergedMains.find(
      (existing) =>
        textSimilarity(existing.title, title) >= 0.82 &&
        Math.abs(existing.timestampSeconds - sec) <= Math.max(90, (maxDur ?? 600) * 0.1)
    );

    if (duplicate) {
      duplicate.keyPoints = deduplicateKeyPoints([...duplicate.keyPoints, ...safeKeyPoints]);
      duplicate.subNodes = cleanSubNodes(
        [...(duplicate.subNodes ?? []), ...(node.subNodes ?? [])],
        duplicate.id
      );
      continue;
    }

    const cleanedSubs = cleanSubNodes(node.subNodes, node.id);
    mergedMains.push({
      ...node,
      isRoot: false,
      title: title.slice(0, 90),
      shortSubtitle: String(node.shortSubtitle ?? '').trim().slice(0, 150),
      timestampSeconds: sec,
      timestampLabel: formatSecondsToTimestamp(sec),
      keyPoints:
        safeKeyPoints.length > 0
          ? safeKeyPoints
          : [
              {
                keyword: 'Overview',
                detail: String(node.shortSubtitle ?? title).trim(),
              },
            ],
      ...(cleanedSubs.length > 0 ? { subNodes: cleanedSubs } : {}),
    });
  }

  mergedMains.sort((a, b) => a.timestampSeconds - b.timestampSeconds);

  const cleanRoot: MindmapNode | null = rootCandidate
    ? {
        ...rootCandidate,
        id: rootCandidate.id || 'root',
        isRoot: true,
        accent: 'root',
        timestampSeconds: clampSec(rootCandidate.timestampSeconds),
        timestampLabel: formatSecondsToTimestamp(clampSec(rootCandidate.timestampSeconds)),
        keyPoints: deduplicateKeyPoints(rootCandidate.keyPoints ?? []),
      }
    : null;

  const finalNodes: MindmapNode[] = cleanRoot ? [cleanRoot, ...mergedMains] : mergedMains;
  const validNodeIds = new Set<string>();
  for (const n of finalNodes) {
    validNodeIds.add(n.id);
    for (const s of n.subNodes ?? []) validNodeIds.add(s.id);
  }

  // Helper to link a script chapter to the nearest valid mindmap node when nodeId is invalid
  const resolveValidNodeId = (rawNodeId: string, startSeconds: number): string => {
    if (rawNodeId && validNodeIds.has(rawNodeId)) return rawNodeId;
    if (mergedMains.length === 0) return cleanRoot?.id ?? 'root';
    let best = mergedMains[0];
    let bestDist = Math.abs(best.timestampSeconds - startSeconds);
    for (const m of mergedMains) {
      const dist = Math.abs(m.timestampSeconds - startSeconds);
      if (dist < bestDist) {
        bestDist = dist;
        best = m;
      }
    }
    return best.id;
  };

  // 3. Clean, deduplicate & repair Script Chapters
  const rawTranscript = Array.isArray(workspace.transcript) ? workspace.transcript : [];
  const cleanedTranscript: TranscriptSection[] = [];

  for (const sec of rawTranscript) {
    const title = String(sec.title ?? '').trim();
    const startSeconds = clampSec(sec.startSeconds);

    const dedupedLines: TranscriptLine[] = [];
    for (const line of Array.isArray(sec.lines) ? sec.lines : []) {
      const text = String(line.text ?? '').trim();
      if (text.length < 3) continue;
      const lineSec = clampSec(line.timestampSeconds);
      const isLineDup = dedupedLines.some(
        (existing) => textSimilarity(existing.text, text) >= 0.85
      );
      if (!isLineDup) {
        dedupedLines.push({
          ...line,
          timestampSeconds: lineSec,
          timestampLabel: formatSecondsToTimestamp(lineSec),
          text,
        });
      }
    }
    dedupedLines.sort((a, b) => a.timestampSeconds - b.timestampSeconds);

    const keyTakeaway =
      typeof sec.keyTakeaway === 'string' && sec.keyTakeaway.trim().length > 3
        ? sec.keyTakeaway.trim()
        : undefined;

    // Skip genuinely empty sections
    if (dedupedLines.length === 0 && !keyTakeaway) continue;

    // Skip near-duplicate chapter headings at nearly identical timestamps
    const isChapterDup = cleanedTranscript.some(
      (existing) =>
        textSimilarity(existing.title, title) >= 0.82 &&
        Math.abs(existing.startSeconds - startSeconds) <= 45
    );
    if (isChapterDup) continue;

    const rawEnd =
      typeof sec.endSeconds === 'number' && Number.isFinite(sec.endSeconds)
        ? clampSec(sec.endSeconds)
        : undefined;

    cleanedTranscript.push({
      ...sec,
      nodeId: resolveValidNodeId(sec.nodeId, startSeconds),
      title: title || `Chapter ${cleanedTranscript.length + 1}`,
      topicTag: String(sec.topicTag ?? '').trim() || 'Key Topic',
      startSeconds,
      startLabel: formatSecondsToTimestamp(startSeconds),
      endSeconds: rawEnd && rawEnd > startSeconds ? rawEnd : undefined,
      endLabel:
        rawEnd && rawEnd > startSeconds ? formatSecondsToTimestamp(rawEnd) : undefined,
      keyTakeaway,
      lines:
        dedupedLines.length > 0
          ? dedupedLines
          : [
              {
                id: `${sec.id}-summary-line`,
                timestampSeconds: startSeconds,
                timestampLabel: formatSecondsToTimestamp(startSeconds),
                text: keyTakeaway ?? title,
              },
            ],
    });
  }

  cleanedTranscript.sort((a, b) => a.startSeconds - b.startSeconds);

  // Fill monotonic endSeconds spans cleanly
  for (let i = 0; i < cleanedTranscript.length; i++) {
    const current = cleanedTranscript[i];
    const next = cleanedTranscript[i + 1];
    const lastLineSec =
      current.lines[current.lines.length - 1]?.timestampSeconds ?? current.startSeconds;
    const derivedEnd = next
      ? Math.max(current.startSeconds, next.startSeconds)
      : maxDur
        ? Math.max(lastLineSec, maxDur)
        : lastLineSec;
    if (
      current.endSeconds === undefined ||
      current.endSeconds <= current.startSeconds ||
      (next && current.endSeconds > next.startSeconds)
    ) {
      if (derivedEnd > current.startSeconds) {
        current.endSeconds = derivedEnd;
        current.endLabel = formatSecondsToTimestamp(derivedEnd);
      }
    }
  }

  // 4. Clean & deduplicate Cheat Sheet entries
  const cs = workspace.cheatSheet;
  const dedupedDefs: DefinitionCard[] = [];
  for (const def of cs.definitions ?? []) {
    const term = String(def.term ?? '').trim();
    const summary = String(def.summary ?? '').trim();
    if (!term || !summary) continue;
    const isDup = dedupedDefs.some((d) => textSimilarity(d.term, term) >= 0.84);
    if (!isDup) {
      const tsSec =
        typeof def.timestampSeconds === 'number' ? clampSec(def.timestampSeconds) : undefined;
      dedupedDefs.push({
        ...def,
        term,
        summary,
        formulaOrNote: String(def.formulaOrNote ?? '').trim(),
        ...(tsSec !== undefined
          ? { timestampSeconds: tsSec, timestampLabel: formatSecondsToTimestamp(tsSec) }
          : {}),
      });
    }
  }

  const cleanRules: CheatSheetRuleOrStep[] = [];
  for (const item of cs.keyRulesOrSteps ?? []) {
    const title = String(item.title ?? '').trim();
    const detail = String(item.detail ?? '').trim();
    if (!title || !detail) continue;
    if (cleanRules.some((r) => textSimilarity(r.title, title) >= 0.82)) continue;
    const tsSec =
      typeof item.timestampSeconds === 'number' ? clampSec(item.timestampSeconds) : undefined;
    cleanRules.push({
      title: title.slice(0, 120),
      detail: detail.slice(0, 420),
      category: item.category,
      ...(typeof item.codeSnippet === 'string' && item.codeSnippet.trim()
        ? { codeSnippet: item.codeSnippet.trim().slice(0, 900) }
        : {}),
      ...(tsSec !== undefined
        ? { timestampSeconds: tsSec, timestampLabel: formatSecondsToTimestamp(tsSec) }
        : {}),
    });
  }

  const cleanMistakes: CheatSheetMistakeItem[] = [];
  for (const item of cs.commonMistakes ?? []) {
    const mistake = String(item.mistake ?? '').trim();
    const correction = String(item.correction ?? '').trim();
    if (!mistake || !correction) continue;
    if (cleanMistakes.some((m) => textSimilarity(m.mistake, mistake) >= 0.8)) continue;
    const tsSec =
      typeof item.timestampSeconds === 'number' ? clampSec(item.timestampSeconds) : undefined;
    cleanMistakes.push({
      mistake: mistake.slice(0, 220),
      correction: correction.slice(0, 320),
      ...(tsSec !== undefined
        ? { timestampSeconds: tsSec, timestampLabel: formatSecondsToTimestamp(tsSec) }
        : {}),
    });
  }

  const cleanRevisionPoints = deduplicateStrings(cs.quickRevisionPoints ?? [], 0.72, 10);

  return {
    ...workspace,
    tldw: cleanTldw,
    nodes: finalNodes,
    transcript: cleanedTranscript,
    cheatSheet: {
      ...cs,
      definitions: dedupedDefs.slice(0, 18),
      ...(cleanRules.length > 0 ? { keyRulesOrSteps: cleanRules.slice(0, 10) } : {}),
      ...(cleanMistakes.length > 0 ? { commonMistakes: cleanMistakes.slice(0, 8) } : {}),
      ...(cleanRevisionPoints.length > 0 ? { quickRevisionPoints: cleanRevisionPoints } : {}),
    },
  };
}

/**
 * Validates an AI-generated workspace before returning it to the user:
 * Checks chronological early/middle/late coverage, chapter alignment, timestamp validity,
 * duplicate branches, cheatsheet completeness, and script quality.
 */
export function validateWorkspaceQuality(
  workspace: LectureWorkspace,
  sourceMeta?: {
    expectedDurationSeconds?: number;
    officialChapters?: VideoChapterMarker[];
    minModules?: number;
    minChapters?: number;
  }
): WorkspaceQualityReport {
  const issues: WorkspaceQualityIssue[] = [];
  const missingChapterHints: string[] = [];

  const expectedDur = Math.max(
    0,
    Math.floor(sourceMeta?.expectedDurationSeconds ?? workspace.videoDurationSeconds ?? 0)
  );
  const mainNodes = workspace.nodes.filter((n) => !n.isRoot);
  const chapters = workspace.transcript ?? [];

  const allTimestamps = [
    ...mainNodes.map((n) => n.timestampSeconds),
    ...mainNodes.flatMap((n) => (n.subNodes ?? []).map((s) => s.timestampSeconds)),
    ...chapters.map((c) => c.startSeconds),
    ...chapters.flatMap((c) => c.lines.map((l) => l.timestampSeconds)),
  ].filter((t) => Number.isFinite(t) && t >= 0);

  const maxCoveredSec = allTimestamps.length > 0 ? Math.max(...allTimestamps) : 0;
  const coverageSpanRatio =
    expectedDur >= 180 ? Math.min(1, maxCoveredSec / expectedDur) : 1;

  // Check early (0-30%), middle (30-70%), and late (70-100%) bucket representation
  const coveredBuckets = { early: false, middle: false, late: false };
  if (expectedDur >= 240) {
    for (const ts of allTimestamps) {
      const ratio = ts / expectedDur;
      if (ratio <= 0.3) coveredBuckets.early = true;
      else if (ratio < 0.72) coveredBuckets.middle = true;
      else coveredBuckets.late = true;
    }

    if (!coveredBuckets.early) {
      issues.push({
        code: 'MISSING_EARLY_COVERAGE',
        severity: 'warning',
        message: 'Opening section (first 30% of runtime) has weak or missing timestamp coverage.',
      });
    }
    if (!coveredBuckets.middle) {
      issues.push({
        code: 'MISSING_MIDDLE_COVERAGE',
        severity: 'critical',
        message: 'Middle section (30%–72% of runtime) is missing from mindmap/script chapters.',
      });
    }
    if (!coveredBuckets.late) {
      issues.push({
        code: 'MISSING_LATE_COVERAGE',
        severity: 'critical',
        message: `Final section (>= ${formatSecondsToTimestamp(
          Math.floor(expectedDur * 0.72)
        )}) is missing — max covered timestamp is only ${formatSecondsToTimestamp(maxCoveredSec)} of ${formatSecondsToTimestamp(expectedDur)}.`,
      });
    }
  } else {
    coveredBuckets.early = true;
    coveredBuckets.middle = true;
    coveredBuckets.late = true;
  }

  // Minimum module & chapter representation
  const minModules = sourceMeta?.minModules ?? 3;
  if (mainNodes.length < minModules) {
    issues.push({
      code: 'TOO_FEW_MODULES',
      severity: 'critical',
      message: `Only ${mainNodes.length} main mindmap modules generated (expected at least ${minModules}).`,
    });
  }

  const minChapters = sourceMeta?.minChapters ?? 3;
  if (chapters.length < minChapters) {
    issues.push({
      code: 'TOO_FEW_CHAPTERS',
      severity: 'critical',
      message: `Only ${chapters.length} script chapters generated (expected at least ${minChapters}).`,
    });
  }

  // Empty script sections check
  const emptySections = chapters.filter((c) => !c.lines || c.lines.length === 0);
  if (emptySections.length > 0) {
    issues.push({
      code: 'EMPTY_SCRIPT_SECTIONS',
      severity: 'warning',
      message: `${emptySections.length} script chapter(s) have no timestamped lines.`,
    });
  }

  // Out-of-range timestamps check
  if (expectedDur > 0) {
    const outOfRange = allTimestamps.filter((t) => t > expectedDur + 5);
    if (outOfRange.length > 0) {
      issues.push({
        code: 'INVALID_TIMESTAMPS',
        severity: 'critical',
        message: `${outOfRange.length} timestamp(s) exceed total video duration (${formatSecondsToTimestamp(expectedDur)}).`,
      });
    }
  }

  // Duplicate main node check
  let dupCount = 0;
  for (let i = 0; i < mainNodes.length; i++) {
    for (let j = i + 1; j < mainNodes.length; j++) {
      if (textSimilarity(mainNodes[i].title, mainNodes[j].title) >= 0.85) {
        dupCount++;
      }
    }
  }
  if (dupCount > 0) {
    issues.push({
      code: 'DUPLICATE_NODES',
      severity: 'warning',
      message: `Detected ${dupCount} near-duplicate main mindmap branch(es).`,
    });
  }

  // Cheat sheet completeness check
  const defCount = workspace.cheatSheet?.definitions?.length ?? 0;
  if (defCount < Math.min(3, Math.max(2, mainNodes.length - 1))) {
    issues.push({
      code: 'THIN_CHEATSHEET',
      severity: 'warning',
      message: `Cheat sheet only contains ${defCount} concept card(s) for ${mainNodes.length} modules.`,
    });
  }

  // Official YouTube chapter alignment check (verify key chapters from late/middle aren't omitted)
  const official = sourceMeta?.officialChapters ?? [];
  if (official.length >= 4) {
    const sampledCheckpoints = sampleItemsEvenly(official, Math.min(8, official.length));
    const chapterWindowSec = Math.max(90, Math.floor(expectedDur * 0.08));
    for (const ch of sampledCheckpoints) {
      const hasNearby = allTimestamps.some(
        (t) => Math.abs(t - ch.startSeconds) <= chapterWindowSec
      );
      if (!hasNearby) {
        missingChapterHints.push(`[${ch.timestampLabel}] ${ch.title}`);
      }
    }
    if (missingChapterHints.length >= 2) {
      issues.push({
        code: 'MISSING_CHAPTER_ALIGNMENT',
        severity: 'critical',
        message: `${missingChapterHints.length} official video chapters appear uncovered: ${missingChapterHints.slice(0, 4).join(', ')}`,
      });
    }
  }

  let score = 100;
  for (const issue of issues) {
    score -= issue.severity === 'critical' ? 24 : 8;
  }
  score = Math.max(0, Math.min(100, score));

  const hasCritical = issues.some((i) => i.severity === 'critical');
  return {
    isAcceptable: !hasCritical && score >= 75,
    needsAiRepair: hasCritical,
    score,
    coverageSpanRatio,
    coveredBuckets,
    issues,
    missingChapterHints,
  };
}

/**
 * Formats a 5-part StructuredSimplification into a clean readable string
 * (used for caching, plain-text copy, and backward-compatible views).
 */
export function formatStructuredSimplification(s: StructuredSimplification): string {
  return [
    `1. Simple Definition: ${s.simpleDefinition.trim()}`,
    `2. Easy Explanation: ${s.easyExplanation.trim()}`,
    `3. Real-Life Analogy: ${s.realLifeAnalogy.trim()}`,
    `4. Relevant Example: ${s.relevantExample.trim()}`,
    `5. One-Line Takeaway: ${s.oneLineTakeaway.trim()}`,
  ].join('\n');
}

/**
 * Validates and normalizes an AI-returned StructuredSimplification object.
 * Returns null if required fields are missing or empty.
 */
export function parseStructuredSimplification(
  raw: unknown
): StructuredSimplification | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const simpleDefinition = String(obj.simpleDefinition ?? '').trim();
  const easyExplanation = String(obj.easyExplanation ?? '').trim();
  const realLifeAnalogy = String(obj.realLifeAnalogy ?? '').trim();
  const relevantExample = String(obj.relevantExample ?? '').trim();
  const oneLineTakeaway = String(obj.oneLineTakeaway ?? '').trim();

  if (
    !simpleDefinition ||
    !easyExplanation ||
    !realLifeAnalogy ||
    !relevantExample ||
    !oneLineTakeaway
  ) {
    return null;
  }

  return {
    simpleDefinition: simpleDefinition.slice(0, 320),
    easyExplanation: easyExplanation.slice(0, 480),
    realLifeAnalogy: realLifeAnalogy.slice(0, 420),
    relevantExample: relevantExample.slice(0, 420),
    oneLineTakeaway: oneLineTakeaway.slice(0, 240),
  };
}
