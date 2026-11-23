import { memo, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookMarked,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Layers,
  Play,
  Zap,
} from 'lucide-react';
import type { LectureWorkspace, VideoCoverageMode } from '../types/mindflow';
import { formatCheatSheetMarkdown } from '../utils/exportFormats';
import { copyTextWithFallback } from '../utils/pdfExport';
import { formatSecondsToTimestamp } from '../utils/youtube';

interface CheatSheetViewProps {
  workspace: LectureWorkspace;
  isDemo?: boolean;
  onJumpToTimestamp: (seconds: number) => void;
  onNotify: (message: string, variant?: 'success' | 'error' | 'info') => void;
  onOpenExport: () => void;
}

const CARD_ACCENTS = {
  violet: {
    border: 'border-white/[0.09] hover:border-violet-400/40',
    kicker: 'text-violet-300',
  },
  cyan: {
    border: 'border-white/[0.09] hover:border-cyan-400/40',
    kicker: 'text-cyan-300',
  },
  emerald: {
    border: 'border-white/[0.09] hover:border-emerald-400/40',
    kicker: 'text-emerald-300',
  },
  indigo: {
    border: 'border-white/[0.09] hover:border-indigo-400/40',
    kicker: 'text-indigo-300',
  },
};

const RATING_TEXT = {
  optimal: 'text-emerald-300',
  balanced: 'text-cyan-300',
  caution: 'text-amber-300',
};

const COVERAGE_LABELS: Record<VideoCoverageMode, string> = {
  'full-transcript': 'Full Transcript Coverage',
  'timeline-sampled': '0%–100% Timeline Sampled',
  'chapters-metadata': 'Chapters + Metadata',
};

export const CheatSheetView = memo(function CheatSheetView({
  workspace,
  isDemo = false,
  onJumpToTimestamp,
  onNotify,
  onOpenExport,
}: CheatSheetViewProps) {
  const [copiedAll, setCopiedAll] = useState(false);

  const columns = workspace.cheatSheet.comparisonColumns ?? [
    'Structure / Algorithm',
    'Access',
    'Search',
    'Insert / Sort',
    'Space',
    'Profile',
  ];

  const mainModules = useMemo(
    () => workspace.nodes.filter((n) => !n.isRoot),
    [workspace.nodes]
  );

  const endTimestampLabel = useMemo(() => {
    if (workspace.videoDurationSeconds && workspace.videoDurationSeconds > 0) {
      return formatSecondsToTimestamp(workspace.videoDurationSeconds);
    }
    return workspace.durationLabel || 'Video';
  }, [workspace.videoDurationSeconds, workspace.durationLabel]);

  const handleCopyAll = async () => {
    const markdown = formatCheatSheetMarkdown(workspace);
    const copied = await copyTextWithFallback(markdown);
    if (!copied) {
      onNotify('Clipboard access was blocked — use Export to download Markdown', 'error');
      return;
    }
    setCopiedAll(true);
    onNotify('Cheat Sheet copied to clipboard', 'success');
    window.setTimeout(() => setCopiedAll(false), 2200);
  };

  return (
    <div
      data-testid="cheatsheet-view"
      className="h-full flex flex-col rounded-2xl mf-panel overflow-hidden"
    >
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-4 border-b border-white/[0.08] bg-white/[0.015]">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base sm:text-[17px] font-bold tracking-[0.01em] text-white leading-snug">
              {workspace.title} — Study Cheat Sheet
            </h2>
            {isDemo && (
              <span
                data-testid="demo-badge-cheatsheet"
                className="rounded bg-amber-400/12 border border-amber-400/25 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-200"
              >
                DEMO
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1 flex flex-wrap items-center gap-2">
            <span>{workspace.videoCategory}</span>
            <span className="text-slate-600" aria-hidden="true">·</span>
            <span>{mainModules.length} Modules</span>
            <span className="text-slate-600" aria-hidden="true">·</span>
            <span>{workspace.cheatSheet.definitions.length} Concepts</span>
            <span className="text-slate-600" aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-cyan-300/90">
              00:00 → {endTimestampLabel}
            </span>
            {workspace.coverageMode && (
              <>
                <span className="text-slate-600" aria-hidden="true">·</span>
                <span className="text-slate-400">
                  {COVERAGE_LABELS[workspace.coverageMode]}
                </span>
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenExport}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.1] px-3.5 py-2 min-h-[40px] text-xs font-semibold text-slate-200 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Export</span>
          </button>

          <button
            type="button"
            onClick={handleCopyAll}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400 px-4 py-2 min-h-[40px] text-xs font-semibold text-white transition-colors whitespace-nowrap cursor-pointer active:scale-[0.98]"
          >
            {copiedAll ? (
              <>
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Copied All</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Copy All</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Scrollable Structured Hierarchy */}
      <div className="flex-1 overflow-y-auto glass-scroll p-4 sm:p-6 space-y-7">
        {/* 1. Skip the Video (TL;DW) Executive Summary */}
        {workspace.tldw.length > 0 && (
          <section
            aria-labelledby="cs-tldw-heading"
            data-testid="tldw-summary-card"
            className="rounded-2xl bg-violet-500/[0.08] border border-violet-400/24 p-4 sm:p-5"
          >
            <div className="flex items-center gap-2 mb-3.5">
              <Zap className="w-4 h-4 text-cyan-300" aria-hidden="true" />
              <h3
                id="cs-tldw-heading"
                className="text-sm font-semibold text-cyan-200"
              >
                Executive Summary (Skip the Video)
              </h3>
            </div>

            <ol className="space-y-2.5">
              {workspace.tldw.map((point, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-3 rounded-xl bg-[#070b17]/70 border border-white/[0.07] px-4 py-3 text-sm leading-relaxed text-slate-100"
                >
                  <span className="font-mono tabular-nums text-xs font-semibold text-cyan-300 mt-1 shrink-0">
                    0{idx + 1}
                  </span>
                  <span>{point}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* 2. Grouped & Numbered Core Modules & Concept Cards */}
        <section aria-labelledby="cs-definitions-heading">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3.5">
            <h3
              id="cs-definitions-heading"
              className="inline-flex items-center gap-2 text-[15px] font-semibold text-white"
            >
              <Layers className="w-4 h-4 text-violet-300" aria-hidden="true" />
              <span>
                {workspace.cheatSheet.definitionsTitle ?? '01. Core Modules & Concept Cards'}
              </span>
            </h3>
            <span className="text-xs text-slate-400">
              Click any timestamp to jump
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {workspace.cheatSheet.definitions.map((def, idx) => {
              const style = CARD_ACCENTS[def.accent] ?? CARD_ACCENTS.cyan;
              const fallbackNode =
                mainModules.length > 0
                  ? mainModules[Math.min(idx, mainModules.length - 1)]
                  : undefined;
              const tsLabel = def.timestampLabel || fallbackNode?.timestampLabel;
              const tsSeconds =
                typeof def.timestampSeconds === 'number'
                  ? def.timestampSeconds
                  : fallbackNode?.timestampSeconds;
              const moduleTag =
                def.moduleLabel ||
                `Module ${String(idx + 1).padStart(2, '0')}`;

              return (
                <article
                  key={`${def.term}-${idx}`}
                  className={`relative rounded-2xl bg-white/[0.03] border p-4 sm:p-5 flex flex-col justify-between transition-colors ${style.border}`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-xs font-semibold ${style.kicker}`}>
                          {moduleTag}
                        </span>
                        {def.category && (
                          <span className="text-xs font-medium text-slate-400 truncate">
                            · {def.category}
                          </span>
                        )}
                      </div>

                      {tsLabel && typeof tsSeconds === 'number' && (
                        <button
                          type="button"
                          onClick={() => onJumpToTimestamp(tsSeconds)}
                          aria-label={`Jump to ${def.term} at ${tsLabel}`}
                          className="inline-flex items-center gap-1 rounded-lg bg-white/[0.06] hover:bg-cyan-500/20 border border-white/[0.1] px-2.5 py-1 font-mono tabular-nums text-xs text-cyan-300 shrink-0 transition-colors cursor-pointer"
                        >
                          <Play className="w-2.5 h-2.5 fill-current" aria-hidden="true" />
                          <span>{tsLabel}</span>
                        </button>
                      )}
                    </div>

                    <h4 className="text-[15.5px] font-semibold tracking-[0.01em] text-white leading-snug">
                      {def.term}
                    </h4>
                    <p className="mt-2 text-sm leading-relaxed text-slate-300">
                      {def.summary}
                    </p>
                  </div>

                  {def.formulaOrNote && (
                    <div className="mt-4 pt-3 border-t border-white/[0.07]">
                      <p className="rounded-xl bg-[#060a15] border border-white/[0.08] px-3 py-2 font-mono text-xs text-cyan-200/95 leading-relaxed">
                        {def.formulaOrNote}
                      </p>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        {/* 3. Structured Quick Comparison / Key Terms Table */}
        {workspace.cheatSheet.complexityRows.length > 0 && (
          <section aria-labelledby="cs-complexity-heading">
            <div className="flex items-center justify-between gap-2 mb-3.5">
              <h3
                id="cs-complexity-heading"
                className="text-[15px] font-semibold text-white"
              >
                {workspace.cheatSheet.comparisonTableTitle ??
                  '02. Quick Comparison & Reference Matrix'}
              </h3>
              <span className="text-xs text-slate-400 tabular-nums">
                {workspace.cheatSheet.complexityRows.length} entries
              </span>
            </div>

            <div className="rounded-2xl bg-white/[0.03] border border-white/[0.09] overflow-x-auto glass-scroll">
              <table className="w-full text-left border-collapse min-w-[580px]">
                <thead>
                  <tr className="border-b border-white/[0.08] bg-white/[0.03] text-xs font-semibold text-slate-300">
                    <th className="py-3 px-4">{columns[0]}</th>
                    <th className="py-3 px-3">{columns[1]}</th>
                    <th className="py-3 px-3">{columns[2]}</th>
                    <th className="py-3 px-3">{columns[3]}</th>
                    <th className="py-3 px-3">{columns[4]}</th>
                    <th className="py-3 px-4 text-right">{columns[5]}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06] text-sm">
                  {workspace.cheatSheet.complexityRows.map((row, idx) => (
                    <tr
                      key={`${row.structureOrAlgo}-${idx}`}
                      className="hover:bg-white/[0.03] transition-colors"
                    >
                      <td className="py-3 px-4 font-semibold text-slate-100">
                        {row.structureOrAlgo}
                      </td>
                      <td className="py-3 px-3 font-mono tabular-nums text-[13px] text-slate-300">
                        {row.access}
                      </td>
                      <td className="py-3 px-3 font-mono tabular-nums text-[13px] text-slate-300">
                        {row.search}
                      </td>
                      <td className="py-3 px-3 font-mono tabular-nums text-[13px] text-slate-300">
                        {row.insert}
                      </td>
                      <td className="py-3 px-3 font-mono tabular-nums text-[13px] text-slate-400">
                        {row.space}
                      </td>
                      <td
                        className={`py-3 px-4 text-right text-xs font-semibold ${RATING_TEXT[row.rating]}`}
                      >
                        {row.ratingLabel}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* 4. Real-World Examples & Final Takeaways */}
        {workspace.cheatSheet.realWorldExamples.length > 0 && (
          <section aria-labelledby="cs-examples-heading">
            <h3
              id="cs-examples-heading"
              className="text-[15px] font-semibold text-white mb-3.5"
            >
              {workspace.cheatSheet.examplesTitle ??
                '03. Real-World Examples & Final Takeaways'}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {workspace.cheatSheet.realWorldExamples.map((example, idx) => (
                <article
                  key={`${example.domain}-${idx}`}
                  className="rounded-2xl bg-white/[0.03] border border-white/[0.09] hover:border-cyan-400/40 p-4 sm:p-5 flex flex-col justify-between transition-colors"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-[15px] font-bold tracking-[0.01em] text-white leading-snug">
                        {example.domain}
                      </h4>
                      <button
                        type="button"
                        onClick={() => onJumpToTimestamp(example.timestampSeconds)}
                        aria-label={`Jump to ${example.domain} at ${example.timestampLabel}`}
                        className="inline-flex items-center gap-1 rounded-lg bg-white/[0.06] hover:bg-cyan-500/20 border border-white/10 px-2.5 py-1 font-mono tabular-nums text-xs text-cyan-300 shrink-0 transition-colors cursor-pointer"
                      >
                        <Play className="w-2.5 h-2.5 fill-current" aria-hidden="true" />
                        <span>{example.timestampLabel}</span>
                      </button>
                    </div>
                    <p className="mt-1.5 text-xs font-semibold text-violet-300">
                      {example.structure}
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-slate-300">
                      {example.explanation}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* 5. Key Rules, Formulas, Processes & Code Patterns */}
        {workspace.cheatSheet.keyRulesOrSteps &&
          workspace.cheatSheet.keyRulesOrSteps.length > 0 && (
            <section
              aria-labelledby="cs-rules-heading"
              data-testid="cheatsheet-rules-section"
            >
              <h3
                id="cs-rules-heading"
                className="inline-flex items-center gap-2 text-[15px] font-semibold text-white mb-3.5"
              >
                <BookMarked className="w-4 h-4 text-cyan-300" aria-hidden="true" />
                <span>Key Rules, Formulas &amp; Processes</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {workspace.cheatSheet.keyRulesOrSteps.map((item, idx) => (
                  <article
                    key={`${item.title}-${idx}`}
                    className="rounded-2xl bg-white/[0.03] border border-white/[0.09] p-4 sm:p-5 flex flex-col justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          {item.category && (
                            <span className="text-xs font-semibold text-violet-300">
                              {item.category}
                            </span>
                          )}
                          <h4 className="text-[15px] font-semibold text-white leading-snug mt-0.5">
                            {item.title}
                          </h4>
                        </div>
                        {item.timestampLabel && typeof item.timestampSeconds === 'number' && (
                          <button
                            type="button"
                            onClick={() => onJumpToTimestamp(item.timestampSeconds!)}
                            aria-label={`Jump to ${item.title} at ${item.timestampLabel}`}
                            className="inline-flex items-center gap-1 rounded-lg bg-white/[0.06] hover:bg-cyan-500/20 border border-white/[0.1] px-2.5 py-1 font-mono tabular-nums text-xs text-cyan-300 shrink-0 transition-colors cursor-pointer"
                          >
                            <Play className="w-2.5 h-2.5 fill-current" aria-hidden="true" />
                            <span>{item.timestampLabel}</span>
                          </button>
                        )}
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-slate-300">
                        {item.detail}
                      </p>
                    </div>
                    {item.codeSnippet && (
                      <pre className="rounded-xl bg-[#060a15] border border-white/[0.08] p-3.5 overflow-x-auto text-xs leading-relaxed font-mono text-cyan-200/95">
                        <code>{item.codeSnippet}</code>
                      </pre>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}

        {/* 6. Common Mistakes & Key Distinctions */}
        {workspace.cheatSheet.commonMistakes &&
          workspace.cheatSheet.commonMistakes.length > 0 && (
            <section
              aria-labelledby="cs-mistakes-heading"
              data-testid="cheatsheet-mistakes-section"
            >
              <h3
                id="cs-mistakes-heading"
                className="inline-flex items-center gap-2 text-[15px] font-semibold text-white mb-3.5"
              >
                <AlertTriangle className="w-4 h-4 text-amber-300" aria-hidden="true" />
                <span>Common Mistakes &amp; Key Distinctions</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {workspace.cheatSheet.commonMistakes.map((item, idx) => (
                  <article
                    key={`${item.mistake}-${idx}`}
                    className="rounded-2xl bg-white/[0.03] border border-white/[0.09] p-4 sm:p-5 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm leading-relaxed text-amber-200/95">
                        <strong className="font-semibold text-amber-300">Watch out: </strong>
                        {item.mistake}
                      </p>
                      {item.timestampLabel && typeof item.timestampSeconds === 'number' && (
                        <button
                          type="button"
                          onClick={() => onJumpToTimestamp(item.timestampSeconds!)}
                          aria-label={`Jump to mistake at ${item.timestampLabel}`}
                          className="inline-flex items-center gap-1 rounded-lg bg-white/[0.06] hover:bg-cyan-500/20 border border-white/[0.1] px-2.5 py-1 font-mono tabular-nums text-xs text-cyan-300 shrink-0 transition-colors cursor-pointer"
                        >
                          <Play className="w-2.5 h-2.5 fill-current" aria-hidden="true" />
                          <span>{item.timestampLabel}</span>
                        </button>
                      )}
                    </div>
                    <p className="text-sm leading-relaxed text-emerald-200/95 pt-2.5 border-t border-white/[0.07]">
                      <strong className="font-semibold text-emerald-300">Instead: </strong>
                      {item.correction}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          )}

        {/* 7. Quick Revision Points */}
        {workspace.cheatSheet.quickRevisionPoints &&
          workspace.cheatSheet.quickRevisionPoints.length > 0 && (
            <section
              aria-labelledby="cs-revision-heading"
              data-testid="cheatsheet-revision-section"
              className="rounded-2xl bg-white/[0.03] border border-white/[0.09] p-4 sm:p-5"
            >
              <h3
                id="cs-revision-heading"
                className="inline-flex items-center gap-2 text-[15px] font-semibold text-white mb-3.5"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-300" aria-hidden="true" />
                <span>Quick Revision Points</span>
              </h3>
              <ul className="space-y-2.5">
                {workspace.cheatSheet.quickRevisionPoints.map((point, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-3 text-sm leading-relaxed text-slate-200"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400/85"
                    />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
      </div>
    </div>
  );
});
