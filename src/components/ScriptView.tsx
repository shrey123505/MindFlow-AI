import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Lightbulb,
  Play,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type { TranscriptSection, VideoCoverageMode } from '../types/mindflow';
import {
  filterTranscriptSections,
  formatSectionTranscript,
} from '../utils/exportFormats';
import { copyTextWithFallback } from '../utils/pdfExport';
import { formatSecondsToTimestamp, parseTimestampToSeconds } from '../utils/youtube';

interface ScriptViewProps {
  sections: TranscriptSection[];
  durationLabel?: string;
  videoDurationSeconds?: number;
  coverageMode?: VideoCoverageMode;
  isDemo?: boolean;
  hasCachedVisualGuide?: boolean;
  onJumpToTimestamp: (seconds: number, nodeId?: string) => void;
  onNotify: (message: string, variant?: 'success' | 'error' | 'info') => void;
  onOpenVisualPdfStudio: () => void;
}

const ACCENT_SEGMENT_COLORS: Record<string, string> = {
  root: 'bg-gradient-to-r from-violet-400 to-cyan-400',
  violet: 'bg-violet-400/85 hover:bg-violet-300',
  cyan: 'bg-cyan-400/85 hover:bg-cyan-300',
  emerald: 'bg-emerald-400/85 hover:bg-emerald-300',
  indigo: 'bg-indigo-400/85 hover:bg-indigo-300',
};

const ACCENT_NUMBER_BADGE: Record<string, string> = {
  root: 'bg-violet-500/20 text-cyan-200 border-cyan-400/35',
  violet: 'bg-violet-500/18 text-violet-200 border-violet-400/35',
  cyan: 'bg-cyan-500/18 text-cyan-200 border-cyan-400/35',
  emerald: 'bg-emerald-500/18 text-emerald-200 border-emerald-400/35',
  indigo: 'bg-indigo-500/18 text-indigo-200 border-indigo-400/35',
};

function highlightMatch(text: string, query: string) {
  const trimmed = query.trim();
  if (!trimmed) return text;

  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));

  return parts.map((part, idx) =>
    part.toLowerCase() === trimmed.toLowerCase() ? (
      <mark
        key={idx}
        className="rounded bg-cyan-400/25 px-0.5 text-cyan-100 font-medium"
      >
        {part}
      </mark>
    ) : (
      part
    )
  );
}

export const ScriptView = memo(function ScriptView({
  sections,
  durationLabel,
  videoDurationSeconds,
  coverageMode,
  isDemo = false,
  hasCachedVisualGuide = false,
  onJumpToTimestamp,
  onNotify,
  onOpenVisualPdfStudio,
}: ScriptViewProps) {
  const [query, setQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeChapterId, setActiveChapterId] = useState<string | null>(
    sections[0]?.id ?? null
  );
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});
  const chapterRefs = useRef<Record<string, HTMLElement | null>>({});

  // Reset collapse state cleanly when switching videos (keep <= 10 chapters expanded, or first 5 for mega courses)
  const sectionsSignature = useMemo(
    () => sections.map((s) => s.id).join('|'),
    [sections]
  );

  useEffect(() => {
    if (sections.length > 10) {
      const initial: Record<string, boolean> = {};
      sections.forEach((sec, idx) => {
        if (idx >= 5) initial[sec.id] = true;
      });
      setCollapsedMap(initial);
    } else {
      setCollapsedMap({});
    }
    setActiveChapterId(sections[0]?.id ?? null);
  }, [sectionsSignature, sections]);

  const filteredSections = useMemo(
    () => filterTranscriptSections(sections, query),
    [sections, query]
  );

  const totalMatchingLines = useMemo(
    () => filteredSections.reduce((acc, sec) => acc + sec.lines.length, 0),
    [filteredSections]
  );

  // Derive total video runtime for proportional chapter progress strip & end ranges
  const totalRuntimeSeconds = useMemo(() => {
    const fromProp = videoDurationSeconds && videoDurationSeconds > 0 ? videoDurationSeconds : 0;
    const fromLabel = durationLabel ? parseTimestampToSeconds(durationLabel) : 0;
    const maxSec = sections.reduce((max, sec) => {
      const lineMax = sec.lines.reduce((m, l) => Math.max(m, l.timestampSeconds), 0);
      return Math.max(max, sec.startSeconds, sec.endSeconds ?? 0, lineMax);
    }, 0);
    return Math.max(fromProp, fromLabel, maxSec, 1);
  }, [videoDurationSeconds, durationLabel, sections]);

  // Compute exact start-end range for each chapter
  const chapterSpans = useMemo(() => {
    return sections.map((sec, idx) => {
      const nextStart = sections[idx + 1]?.startSeconds;
      const fallbackEnd =
        idx === sections.length - 1
          ? Math.max(sec.startSeconds, totalRuntimeSeconds)
          : Math.max(sec.startSeconds, nextStart ?? sec.startSeconds);
      const endSeconds =
        typeof sec.endSeconds === 'number' && sec.endSeconds > sec.startSeconds
          ? sec.endSeconds
          : fallbackEnd;
      const endLabel =
        sec.endLabel || (endSeconds > sec.startSeconds ? formatSecondsToTimestamp(endSeconds) : '');
      const spanSeconds = Math.max(1, endSeconds - sec.startSeconds);
      return {
        id: sec.id,
        startSeconds: sec.startSeconds,
        endSeconds,
        endLabel,
        spanSeconds,
      };
    });
  }, [sections, totalRuntimeSeconds]);

  const spanById = useMemo(() => {
    const map = new Map<string, (typeof chapterSpans)[number]>();
    chapterSpans.forEach((s) => map.set(s.id, s));
    return map;
  }, [chapterSpans]);

  const allCollapsed = useMemo(() => {
    if (filteredSections.length === 0) return false;
    return filteredSections.every((sec) => Boolean(collapsedMap[sec.id]));
  }, [filteredSections, collapsedMap]);

  const handleToggleAll = () => {
    if (allCollapsed) {
      setCollapsedMap({});
    } else {
      const next: Record<string, boolean> = {};
      filteredSections.forEach((sec) => {
        next[sec.id] = true;
      });
      setCollapsedMap(next);
    }
  };

  const handleToggleChapter = (sectionId: string) => {
    setCollapsedMap((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  const handleSelectProgressSegment = (section: TranscriptSection) => {
    setActiveChapterId(section.id);
    setCollapsedMap((prev) => ({ ...prev, [section.id]: false }));
    onJumpToTimestamp(section.startSeconds, section.nodeId);
    const el = chapterRefs.current[section.id];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleCopySection = async (section: TranscriptSection) => {
    const formatted = formatSectionTranscript(section);
    const copied = await copyTextWithFallback(formatted);
    if (!copied) {
      onNotify('Clipboard access was blocked — try selecting text manually', 'error');
      return;
    }
    setCopiedId(section.id);
    onNotify(`Copied "${section.title}"`, 'success');
    window.setTimeout(() => {
      setCopiedId((current) => (current === section.id ? null : current));
    }, 2000);
  };

  const endDisplayLabel = formatSecondsToTimestamp(totalRuntimeSeconds);

  return (
    <div
      data-testid="script-view"
      className="h-full flex flex-col rounded-2xl mf-panel overflow-hidden"
    >
      {/* Visual PDF Guide Studio CTA Bar */}
      <div className="px-4 sm:px-5 py-3.5 border-b border-white/[0.08] bg-violet-500/[0.08]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-cyan-400 text-white shadow-sm shadow-violet-950/40">
              <BookOpen className="w-4 h-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="font-display text-[15px] font-semibold text-white leading-snug">
                Visual PDF Study Guide
              </p>
              <p className="text-xs text-slate-300/85 mt-0.5 leading-snug">
                Magazine-style A4 notes with conceptual diagrams, video frames &amp; 1-page recall sheet.
              </p>
            </div>
          </div>

          <button
            type="button"
            data-testid="script-open-visual-pdf-btn"
            onClick={onOpenVisualPdfStudio}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400 px-4 py-2 min-h-[40px] text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer active:scale-[0.98]"
          >
            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              {hasCachedVisualGuide
                ? 'Open Visual PDF Guide'
                : 'Generate Visual PDF Guide'}
            </span>
          </button>
        </div>
      </div>

      {/* Header: Title, Expand/Collapse All, & Search Bar */}
      <div className="flex flex-col gap-3.5 px-4 sm:px-5 py-4 border-b border-white/[0.08] bg-white/[0.015]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base sm:text-[17px] font-bold tracking-[0.01em] text-white leading-snug">
                Chronological Chapter Timeline
              </h2>
              {isDemo && (
                <span
                  data-testid="demo-badge-script"
                  className="rounded bg-amber-400/12 border border-amber-400/25 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-200"
                >
                  DEMO
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {query.trim()
                ? `${totalMatchingLines} matching ${totalMatchingLines === 1 ? 'segment' : 'segments'} across ${filteredSections.length} ${filteredSections.length === 1 ? 'chapter' : 'chapters'}`
                : `${sections.length} chapters · 00:00 → ${endDisplayLabel}${
                    coverageMode === 'timeline-sampled'
                      ? ' · Full Timeline Sampled'
                      : coverageMode === 'chapters-metadata'
                        ? ' · Chapters + Metadata'
                        : ''
                  }`}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
            {filteredSections.length > 1 && (
              <button
                type="button"
                data-testid="script-toggle-all-btn"
                onClick={handleToggleAll}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1] px-3.5 py-2 min-h-[40px] text-xs font-semibold text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {allCollapsed ? (
                  <>
                    <ChevronsUpDown className="w-3.5 h-3.5 text-cyan-300" aria-hidden="true" />
                    <span>Expand All</span>
                  </>
                ) : (
                  <>
                    <ChevronsDownUp className="w-3.5 h-3.5 text-violet-300" aria-hidden="true" />
                    <span>Collapse All</span>
                  </>
                )}
              </button>
            )}

            <div className="relative flex-1 sm:w-72">
              <label htmlFor="transcript-search" className="sr-only">
                Search transcript
              </label>
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
                aria-hidden="true"
              />
              <input
                id="transcript-search"
                type="text"
                role="searchbox"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search chapters or keywords..."
                className="w-full rounded-xl bg-[#070a15] border border-white/[0.12] pl-10 pr-9 py-2 min-h-[40px] text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/60 transition-colors"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear transcript search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Horizontal Video Coverage Progress Strip */}
        {sections.length > 0 && (
          <div
            data-testid="video-coverage-progress-strip"
            className="space-y-1.5"
          >
            <div className="flex items-center justify-between text-xs font-mono tabular-nums text-slate-400">
              <span>00:00</span>
              <span>{endDisplayLabel}</span>
            </div>

            <div
              role="navigation"
              aria-label="Video chapter timeline progress"
              className="flex items-center gap-1 h-2.5 w-full rounded-full bg-white/[0.04] p-0.5 border border-white/[0.08]"
            >
              {sections.map((sec, idx) => {
                const span = chapterSpans[idx];
                const minFlex = Math.max(1, Math.floor(totalRuntimeSeconds * 0.04));
                const flexWeight = Math.max(minFlex, span?.spanSeconds ?? 1);
                const isActive = activeChapterId === sec.id;
                const barColor =
                  ACCENT_SEGMENT_COLORS[sec.accent] ?? ACCENT_SEGMENT_COLORS.cyan;

                return (
                  <button
                    key={sec.id}
                    type="button"
                    style={{ flexGrow: flexWeight, flexBasis: '0%' }}
                    onClick={() => handleSelectProgressSegment(sec)}
                    title={`${String(idx + 1).padStart(2, '0')}. ${sec.title} (${sec.startLabel}${span?.endLabel ? ` – ${span.endLabel}` : ''})`}
                    aria-label={`Jump to chapter ${idx + 1}: ${sec.title} at ${sec.startLabel}`}
                    className={`h-full min-w-[10px] rounded-full transition-all cursor-pointer ${barColor} ${
                      isActive
                        ? 'opacity-100 ring-1 ring-white/75 scale-y-125'
                        : 'opacity-55 hover:opacity-95'
                    }`}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Numbered Chronological Chapter Cards (comfortable reading measure max-w-4xl) */}
      <div className="flex-1 overflow-y-auto glass-scroll p-4 sm:p-6">
        <div className="max-w-4xl mx-auto w-full space-y-4">
          {filteredSections.length === 0 ? (
            <div className="rounded-2xl bg-white/[0.03] border border-white/10 px-6 py-12 text-center">
              <p className="text-[15px] font-semibold text-slate-100">
                No transcript segments match &ldquo;{query}&rdquo;
              </p>
              <p className="text-sm text-slate-400 mt-1.5">
                Try searching for terms like &ldquo;Big-O&rdquo;, &ldquo;Binary&rdquo;, &ldquo;B+ Tree&rdquo;, or &ldquo;LRU&rdquo;.
              </p>
              <button
                type="button"
                onClick={() => setQuery('')}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/12 px-4 py-2 min-h-[40px] text-xs font-semibold text-white transition-colors cursor-pointer"
              >
                Clear Search
              </button>
            </div>
          ) : (
            filteredSections.map((section, idx) => {
              const isCopied = copiedId === section.id;
              const isCollapsed = !query.trim() && Boolean(collapsedMap[section.id]);
              const isActive = activeChapterId === section.id;
              const span = spanById.get(section.id);
              const rangeLabel =
                span?.endLabel && span.endLabel !== section.startLabel
                  ? `${section.startLabel} – ${span.endLabel}`
                  : section.startLabel;
              const badgeClass =
                ACCENT_NUMBER_BADGE[section.accent] ?? ACCENT_NUMBER_BADGE.cyan;

              return (
                <section
                  key={section.id}
                  ref={(el) => {
                    chapterRefs.current[section.id] = el;
                  }}
                  aria-label={section.title}
                  className={`rounded-2xl border overflow-hidden transition-colors ${
                    isActive
                      ? 'bg-white/[0.045] border-cyan-400/38'
                      : 'bg-white/[0.025] border-white/[0.09] hover:border-white/[0.16]'
                  }`}
                >
                  {/* Chapter Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 px-4 sm:px-5 py-3.5 border-b border-white/[0.07] bg-white/[0.02]">
                    <button
                      type="button"
                      aria-expanded={!isCollapsed}
                      onClick={() => {
                        setActiveChapterId(section.id);
                        handleToggleChapter(section.id);
                      }}
                      className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer group"
                    >
                      <span className="mt-0.5 sm:mt-0 flex h-6 w-6 items-center justify-center rounded-md bg-white/[0.05] text-slate-300 group-hover:text-white group-hover:bg-white/10 transition-colors shrink-0">
                        {isCollapsed ? (
                          <ChevronRight className="w-4 h-4" aria-hidden="true" />
                        ) : (
                          <ChevronDown className="w-4 h-4" aria-hidden="true" />
                        )}
                      </span>
                      <span
                        className={`inline-flex items-center justify-center rounded-md border px-2 py-0.5 font-mono text-xs font-bold shrink-0 ${badgeClass}`}
                      >
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-[15px] font-bold text-white leading-snug group-hover:text-cyan-100 transition-colors">
                          {section.title}
                        </h3>
                        <p className="text-xs text-slate-400 mt-0.5 truncate">
                          {section.topicTag} · {section.lines.length}{' '}
                          {section.lines.length === 1 ? 'key point' : 'key points'}
                        </p>
                      </div>
                    </button>

                    <div className="flex items-center gap-2 shrink-0 pl-8 sm:pl-0">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveChapterId(section.id);
                          onJumpToTimestamp(section.startSeconds, section.nodeId);
                        }}
                        aria-label={`Jump to ${section.title} at ${section.startLabel}`}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] hover:bg-cyan-500/20 border border-white/10 px-3 py-1.5 min-h-[34px] font-mono tabular-nums text-xs text-cyan-300 transition-colors cursor-pointer"
                      >
                        <Play className="w-2.5 h-2.5 fill-current" aria-hidden="true" />
                        <span>{rangeLabel}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleCopySection(section)}
                        aria-label={`Copy section ${section.title}`}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.12] border border-white/10 px-3 py-1.5 min-h-[34px] text-xs font-semibold text-slate-200 transition-colors cursor-pointer"
                      >
                        {isCopied ? (
                          <>
                            <Check
                              className="w-3.5 h-3.5 text-emerald-400"
                              aria-hidden="true"
                            />
                            <span className="text-emerald-300">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Collapsible Chapter Body */}
                  {!isCollapsed && (
                    <div>
                      {section.keyTakeaway && (
                        <div className="mx-4 sm:mx-5 mt-3.5 mb-1 rounded-xl bg-violet-500/10 border border-violet-400/28 px-3.5 py-2.5 flex items-start gap-2.5">
                          <Lightbulb
                            className="w-4 h-4 text-violet-300 shrink-0 mt-0.5"
                            aria-hidden="true"
                          />
                          <p className="text-sm leading-relaxed text-violet-100">
                            <span className="font-semibold text-violet-200">Key Takeaway: </span>
                            {section.keyTakeaway}
                          </p>
                        </div>
                      )}

                      <div className="divide-y divide-white/[0.06]">
                        {section.lines.map((line) => (
                          <div
                            key={line.id}
                            className="flex items-start gap-3.5 px-4 sm:px-5 py-3.5 hover:bg-white/[0.025] transition-colors"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setActiveChapterId(section.id);
                                onJumpToTimestamp(line.timestampSeconds, section.nodeId);
                              }}
                              aria-label={`Play from ${line.timestampLabel}`}
                              className="mt-0.5 shrink-0 rounded-md bg-white/[0.04] hover:bg-cyan-500/15 px-2 py-0.5 font-mono tabular-nums text-xs font-medium text-violet-300 hover:text-cyan-300 transition-colors cursor-pointer"
                            >
                              {line.timestampLabel}
                            </button>
                            <p className="text-[14.5px] leading-relaxed text-slate-200">
                              {highlightMatch(line.text, query)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
});
