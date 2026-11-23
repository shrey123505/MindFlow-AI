import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Globe,
  Lightbulb,
  Loader2,
  Play,
  Sparkles,
  Wand2,
} from 'lucide-react';
import type {
  GroundingInsight,
  LanguageCode,
  SelectedNodeDetail,
  StructuredSimplification,
} from '../types/mindflow';
import { LanguageSwitcher } from './LanguageSwitcher';
import { NodeIcon } from './NodeIcon';
import { isSafeHttpUrl } from '../utils/youtube';

interface KeyTakeawaysCardProps {
  node: SelectedNodeDetail;
  language: LanguageCode;
  isTranslating: boolean;
  collapsed: boolean;
  isSimplified: boolean;
  simplifiedText: string;
  simplifiedStructured?: StructuredSimplification | null;
  simplifyLoading: boolean;
  simplifyError: string | null;
  isGenerating: boolean;
  groundingInsight: GroundingInsight | null;
  groundingLoading: boolean;
  groundingError: string | null;
  onLanguageChange: (lang: LanguageCode) => void;
  onToggleCollapse: () => void;
  onToggleSimplify: () => void;
  onJumpToTimestamp: (seconds: number) => void;
  onGenerateMindmap: () => void;
  onFetchWebInsights: () => void;
}

const ACCENT_STYLES: Record<
  SelectedNodeDetail['accent'],
  { keyword: string; iconBg: string }
> = {
  root: {
    keyword: 'text-violet-200',
    iconBg: 'bg-violet-500/16 text-violet-300 border-violet-400/28',
  },
  violet: {
    keyword: 'text-violet-200',
    iconBg: 'bg-violet-500/16 text-violet-300 border-violet-400/28',
  },
  cyan: {
    keyword: 'text-cyan-200',
    iconBg: 'bg-cyan-500/16 text-cyan-300 border-cyan-400/28',
  },
  emerald: {
    keyword: 'text-emerald-200',
    iconBg: 'bg-emerald-500/16 text-emerald-300 border-emerald-400/28',
  },
  indigo: {
    keyword: 'text-indigo-200',
    iconBg: 'bg-indigo-500/16 text-indigo-300 border-indigo-400/28',
  },
};

export function KeyTakeawaysCard({
  node,
  language,
  isTranslating,
  collapsed,
  isSimplified,
  simplifiedText,
  simplifiedStructured,
  simplifyLoading,
  simplifyError,
  isGenerating,
  groundingInsight,
  groundingLoading,
  groundingError,
  onLanguageChange,
  onToggleCollapse,
  onToggleSimplify,
  onJumpToTimestamp,
  onGenerateMindmap,
  onFetchWebInsights,
}: KeyTakeawaysCardProps) {
  const accent = ACCENT_STYLES[node.accent];

  return (
    <section
      aria-label="Key Takeaways"
      className="flex flex-col flex-1 min-h-0 rounded-2xl mf-panel overflow-hidden"
    >
      {/* Collapsible Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/[0.08] bg-white/[0.015]">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${accent.iconBg}`}
          >
            <NodeIcon name={node.icon} className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-xs font-medium text-slate-400 leading-none mb-1 truncate">
              {node.isSubNode && node.parentTitle
                ? `Key Takeaways · ${node.parentTitle}`
                : 'Key Takeaways'}
            </h2>
            <p
              data-testid="takeaways-node-title"
              className="text-[15px] font-semibold tracking-[0.01em] text-white truncate leading-tight"
            >
              {node.title}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onJumpToTimestamp(node.timestampSeconds)}
            aria-label={`Jump video to ${node.timestampLabel}`}
            className="inline-flex items-center gap-1 rounded-lg bg-white/[0.06] hover:bg-cyan-500/20 border border-white/10 px-2.5 py-1.5 font-mono tabular-nums text-xs text-cyan-300 transition-colors cursor-pointer"
          >
            <Play className="w-2.5 h-2.5 fill-current" aria-hidden="true" />
            <span>{node.timestampLabel}</span>
          </button>

          <button
            type="button"
            onClick={onToggleCollapse}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand Key Takeaways' : 'Collapse Key Takeaways'}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            {collapsed ? (
              <ChevronDown className="w-4 h-4" aria-hidden="true" />
            ) : (
              <ChevronUp className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Collapsible Body */}
      {!collapsed && (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Compact language bar shown when DesktopNavbar hides LanguageSwitcher (< 2xl) */}
          <div className="flex 2xl:hidden items-center justify-between gap-2 px-4 py-2 border-b border-white/[0.06] bg-white/[0.015]">
            <span className="text-xs text-slate-400">Notes language</span>
            <LanguageSwitcher
              value={language}
              isTranslating={isTranslating}
              compact
              onChange={onLanguageChange}
            />
          </div>

          <div className="flex-1 overflow-y-auto glass-scroll px-4 pt-3.5 pb-4 space-y-3.5">
            {/* Bullet Points */}
            <ul className="space-y-2.5">
              {node.keyPoints.map((point, idx) => (
                <li
                  key={`${point.keyword}-${idx}`}
                  className="flex items-start gap-2.5 text-sm leading-relaxed text-slate-200"
                >
                  <span
                    aria-hidden="true"
                    className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400/85"
                  />
                  <span>
                    <strong className={`font-semibold ${accent.keyword}`}>
                      {point.keyword}:
                    </strong>{' '}
                    {point.detail}
                  </span>
                </li>
              ))}
            </ul>

            {/* Real-Life Example Callout */}
            {node.realLifeExample && (
              <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] px-3.5 py-3 text-sm leading-relaxed text-slate-200">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300 mb-1">
                  <Lightbulb className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Real-Life Example</span>
                </div>
                <p>{node.realLifeExample}</p>
              </div>
            )}

            {/* Beginner Breakdown (5-Part Structured Simplification or Fallback Analogy) */}
            {isSimplified && (
              <div
                data-testid="simplified-analogy-box"
                className="rounded-xl bg-violet-500/[0.09] border border-violet-400/28 px-3.5 py-3.5 text-sm leading-relaxed text-slate-100"
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-200 mb-2.5">
                  <Sparkles className="w-3.5 h-3.5 text-cyan-300" aria-hidden="true" />
                  <span>Beginner Breakdown</span>
                </div>
                {simplifyLoading ? (
                  <div className="flex items-center gap-2 text-slate-300 py-1 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin text-cyan-300" aria-hidden="true" />
                    <span>Building a clear 5-part beginner breakdown...</span>
                  </div>
                ) : simplifiedStructured ? (
                  <dl className="space-y-2.5 text-sm leading-relaxed">
                    <div>
                      <dt className="text-xs font-semibold text-cyan-300">
                        Simple Definition
                      </dt>
                      <dd className="text-slate-100 mt-0.5">
                        {simplifiedStructured.simpleDefinition}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-violet-200">
                        Easy Explanation
                      </dt>
                      <dd className="text-slate-200 mt-0.5">
                        {simplifiedStructured.easyExplanation}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-emerald-300">
                        Real-Life Analogy
                      </dt>
                      <dd className="text-slate-200 mt-0.5">
                        {simplifiedStructured.realLifeAnalogy}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold text-indigo-200">
                        Relevant Example
                      </dt>
                      <dd className="text-slate-200 mt-0.5">
                        {simplifiedStructured.relevantExample}
                      </dd>
                    </div>
                    <div className="pt-2 border-t border-white/[0.08]">
                      <dt className="text-xs font-semibold text-amber-200">
                        One-Line Takeaway
                      </dt>
                      <dd className="text-white font-medium mt-0.5">
                        {simplifiedStructured.oneLineTakeaway}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="whitespace-pre-line">{simplifiedText}</p>
                )}
                {simplifyError && (
                  <p className="mt-2 text-xs text-amber-300">{simplifyError}</p>
                )}
              </div>
            )}

            {/* Live Google Search Grounding Insights */}
            <div className="pt-2 border-t border-white/[0.07]">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-medium text-slate-400">
                  Live Web Context · Google Search
                </span>
                <button
                  type="button"
                  onClick={onFetchWebInsights}
                  disabled={groundingLoading}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-300 hover:text-cyan-200 disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {groundingLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                      <span>Searching...</span>
                    </>
                  ) : (
                    <>
                      <Globe className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{groundingInsight ? 'Refresh Sources' : 'Verify & Enrich'}</span>
                    </>
                  )}
                </button>
              </div>

              {groundingError && (
                <p role="alert" className="text-xs leading-relaxed text-amber-300/95">
                  {groundingError}
                </p>
              )}

              {groundingInsight && (
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-3.5 space-y-2.5">
                  <p className="text-sm leading-relaxed text-slate-200">
                    {groundingInsight.summary}
                  </p>
                  {groundingInsight.highlights.length > 0 && (
                    <ul className="space-y-1.5">
                      {groundingInsight.highlights.map((item, idx) => (
                        <li key={idx} className="text-[13px] text-slate-300 leading-relaxed">
                          • {item}
                        </li>
                      ))}
                    </ul>
                  )}
                  {groundingInsight.sources.filter((src) => isSafeHttpUrl(src.uri)).length > 0 && (
                    <div className="pt-2 border-t border-white/[0.06] flex flex-wrap gap-x-3 gap-y-1.5">
                      {groundingInsight.sources
                        .filter((src) => isSafeHttpUrl(src.uri))
                        .map((src, idx) => (
                          <a
                            key={`${src.uri}-${idx}`}
                            href={src.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200 underline decoration-cyan-400/40 underline-offset-2 max-w-[220px] truncate"
                          >
                            <span className="truncate">{src.title}</span>
                            <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                          </a>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Bottom Action Bar: Clear Primary vs Secondary Hierarchy */}
          <div className="px-4 py-3 border-t border-white/[0.08] bg-white/[0.015] flex items-center gap-2">
            <button
              type="button"
              onClick={onToggleSimplify}
              disabled={simplifyLoading}
              aria-pressed={isSimplified}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 min-h-[40px] text-[13px] font-semibold transition-colors duration-150 cursor-pointer active:scale-[0.98] disabled:opacity-65 ${
                isSimplified
                  ? 'bg-violet-500/22 text-violet-100 border border-violet-400/40'
                  : 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 border border-white/10 text-white'
              }`}
            >
              {simplifyLoading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  <span>Simplifying...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{isSimplified ? 'Hide Breakdown' : 'Simplify with AI'}</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onGenerateMindmap}
              disabled={isGenerating}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 min-h-[40px] text-[13px] font-medium text-slate-200 hover:text-white bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.1] transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  <span>Analyzing...</span>
                </>
              ) : (
                <>
                  <Wand2 className="w-3.5 h-3.5 text-cyan-300/90" aria-hidden="true" />
                  <span>Re-Analyze</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
