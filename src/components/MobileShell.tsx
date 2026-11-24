import { type FormEvent, useEffect } from 'react';
import {
  BrainCircuit,
  Download,
  ExternalLink,
  FileText,
  FolderClock,
  Globe,
  Lightbulb,
  Link2,
  Loader2,
  MessageCircle,
  Network,
  Play,
  ScrollText,
  Share2,
  Sparkles,
  X,
  KeyRound,
} from 'lucide-react';
import type {
  ActiveTab,
  GroundingInsight,
  LanguageCode,
  SelectedNodeDetail,
  StructuredSimplification,
} from '../types/mindflow';
import { LanguageSwitcher } from './LanguageSwitcher';
import { NodeIcon } from './NodeIcon';
import { isSafeHttpUrl } from '../utils/youtube';

interface MobileHeaderProps {
  urlOpen: boolean;
  urlInput: string;
  urlError: string | null;
  showTranscriptFallback: boolean;
  language: LanguageCode;
  isAnalyzing: boolean;
  isTranslating: boolean;
  libraryCount: number;
  hasOwnKey: boolean;
  onToggleUrlBar: () => void;
  onUrlChange: (val: string) => void;
  onUrlClear: () => void;
  onUrlSubmit: () => void;
  onLanguageChange: (lang: LanguageCode) => void;
  onOpenLibrary: () => void;
  onOpenApiKey: () => void;
  onOpenManualTranscript: () => void;
  onShareLink?: () => void;
}

export function MobileHeader({
  urlOpen,
  urlInput,
  urlError,
  showTranscriptFallback,
  language,
  isAnalyzing,
  isTranslating,
  libraryCount,
  hasOwnKey,
  onToggleUrlBar,
  onUrlChange,
  onUrlClear,
  onUrlSubmit,
  onLanguageChange,
  onOpenLibrary,
  onOpenApiKey,
  onOpenManualTranscript,
  onShareLink,
}: MobileHeaderProps) {
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onUrlSubmit();
  };

  return (
    <header className="lg:hidden sticky top-0 z-30 bg-[#060812]/94 backdrop-blur-md border-b border-white/[0.08]">
      <div className="flex items-center justify-between gap-1 px-2 sm:px-4 h-14">
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1 overflow-hidden">
          <div className="flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 via-indigo-500 to-cyan-500 shadow-sm shadow-violet-950/40">
            <BrainCircuit className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" aria-hidden="true" />
          </div>
          <span className="font-display text-[13px] sm:text-[15px] font-bold tracking-[0.01em] text-white truncate">
            MindFlow<span className="hidden min-[400px]:inline"> AI</span>
          </span>
        </div>

        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <LanguageSwitcher
            value={language}
            isTranslating={isTranslating}
            compact
            onChange={onLanguageChange}
          />


          <button
            type="button"
            data-testid="mobile-library-btn"
            onClick={onOpenLibrary}
            aria-label={`Open saved library (${libraryCount} saved)`}
            className="relative flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-xl border bg-white/[0.05] border-white/10 text-slate-300 hover:text-white transition-colors cursor-pointer shrink-0"
          >
            <FolderClock className="w-4 h-4" aria-hidden="true" />
            {libraryCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-violet-500 px-1 text-[10px] font-bold text-white">
                {libraryCount}
              </span>
            )}
          </button>

          {onShareLink && (
            <button
              type="button"
              data-testid="mobile-share-btn"
              onClick={onShareLink}
              aria-label="Share deep link"
              title="Copy deep link to current video & timestamp"
              className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-xl border bg-white/[0.05] border-white/10 text-slate-300 hover:text-white transition-colors cursor-pointer shrink-0"
            >
              <Share2 className="w-4 h-4 text-cyan-300" aria-hidden="true" />
            </button>
          )}

          <button
            type="button"
            onClick={onToggleUrlBar}
            aria-expanded={urlOpen}
            aria-label="Toggle YouTube URL input"
            className={`flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-xl border transition-colors cursor-pointer shrink-0 ${
              urlOpen
                ? 'bg-violet-500/22 border-violet-400/45 text-violet-200'
                : 'bg-white/[0.05] border-white/10 text-slate-300 hover:text-white'
            }`}
          >
            {urlOpen ? (
              <X className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Link2 className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Collapsible Compact URL Input Drawer */}
      {urlOpen && (
        <form
          onSubmit={handleSubmit}
          className="px-3.5 pb-3.5 pt-2 border-t border-white/[0.07] space-y-2 mf-animate-fade"
          noValidate
        >
          <label htmlFor="mobile-youtube-url" className="sr-only">
            YouTube video URL
          </label>
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 rounded-full bg-[#0b1022] border border-white/15 px-3.5 py-2 min-h-[44px] focus-within:border-cyan-400/60">
              <Link2 className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" />
              <input
                id="mobile-youtube-url"
                type="text"
                value={urlInput}
                onChange={(e) => onUrlChange(e.target.value)}
                placeholder="Paste YouTube URL or ID..."
                className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
              />
              {urlInput && (
                <button
                  type="button"
                  onClick={onUrlClear}
                  aria-label="Clear mobile YouTube URL"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer shrink-0"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>

            <button
              type="submit"
              disabled={isAnalyzing}
              aria-label="Analyze YouTube URL"
              className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-600 hover:from-violet-500 hover:to-cyan-500 px-4 py-2 min-h-[44px] text-xs font-semibold text-white shrink-0 cursor-pointer disabled:opacity-60 active:scale-[0.98]"
            >
              {isAnalyzing ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="w-4 h-4" aria-hidden="true" />
              )}
              <span>Analyze</span>
            </button>
          </div>

          {urlError && (
            <div role="alert" className="px-2 space-y-1">
              <p className="text-xs text-rose-300 leading-relaxed">{urlError}</p>
              {showTranscriptFallback && (
                <button
                  type="button"
                  onClick={onOpenManualTranscript}
                  className="text-xs font-semibold text-cyan-300 underline underline-offset-2 cursor-pointer"
                >
                  Paste transcript manually →
                </button>
              )}
            </div>
          )}
          <button
            type="button"
            data-testid="mobile-apikey-btn"
            onClick={onOpenApiKey}
            className="inline-flex items-center gap-1.5 px-2 text-xs font-semibold text-slate-300 hover:text-white cursor-pointer"
          >
            <KeyRound className={`h-3.5 w-3.5 ${hasOwnKey ? 'text-emerald-400' : 'text-cyan-300'}`} aria-hidden="true" />
            {hasOwnKey ? 'Using your own Gemini key' : 'Use your own Gemini key (no daily cap)'}
          </button>
        </form>
      )}
    </header>
  );
}

interface MobileBottomNavProps {
  activeTab: ActiveTab;
  chatOpen: boolean;
  onTabChange: (tab: ActiveTab) => void;
  onToggleChat: () => void;
  onOpenExport: () => void;
}

export function MobileBottomNav({
  activeTab,
  chatOpen,
  onTabChange,
  onToggleChat,
  onOpenExport,
}: MobileBottomNavProps) {
  const items: Array<{
    id: ActiveTab | 'chat' | 'export';
    label: string;
    shortLabel?: string;
    icon: typeof Network;
    onClick: () => void;
    active: boolean;
    testId?: string;
  }> = [
    {
      id: 'mindmap',
      label: 'Mindmap',
      icon: Network,
      onClick: () => onTabChange('mindmap'),
      active: !chatOpen && activeTab === 'mindmap',
    },
    {
      id: 'cheatsheet',
      label: 'Cheat Sheet',
      shortLabel: 'Sheet',
      icon: FileText,
      onClick: () => onTabChange('cheatsheet'),
      active: !chatOpen && activeTab === 'cheatsheet',
    },
    {
      id: 'script',
      label: 'Script',
      icon: ScrollText,
      onClick: () => onTabChange('script'),
      active: !chatOpen && activeTab === 'script',
    },
    {
      id: 'chat',
      label: 'Ask AI',
      icon: MessageCircle,
      onClick: onToggleChat,
      active: chatOpen,
      testId: 'ask-ai-mobile-nav-btn',
    },
    {
      id: 'export',
      label: 'Export',
      icon: Download,
      onClick: onOpenExport,
      active: false,
      testId: 'mobile-export-nav-btn',
    },
  ];

  return (
    <nav
      aria-label="Mobile navigation"
      className="lg:hidden fixed mf-safe-bottom-nav left-3 right-3 z-40 rounded-2xl mf-modal-surface backdrop-blur-md px-1.5 py-1.5"
    >
      <div className="grid grid-cols-5 gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={item.testId}
              aria-label={item.label}
              onClick={item.onClick}
              aria-current={item.active ? 'page' : undefined}
              className={`flex flex-col items-center justify-center min-h-[48px] rounded-xl px-0.5 py-1.5 transition-colors duration-150 cursor-pointer ${
                item.active
                  ? 'bg-violet-500/24 text-white border border-violet-400/40'
                  : 'border border-transparent text-slate-400 hover:text-slate-100 hover:bg-white/[0.04]'
              }`}
            >
              <Icon
                className={`w-[18px] h-[18px] ${item.active ? 'text-cyan-300' : ''}`}
                aria-hidden="true"
              />
              <span className="mt-1 text-[11px] font-semibold tracking-tight whitespace-nowrap">
                {item.shortLabel ? (
                  <>
                    <span className="sm:hidden">{item.shortLabel}</span>
                    <span className="hidden sm:inline">{item.label}</span>
                  </>
                ) : (
                  item.label
                )}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

interface MobileNodeDrawerProps {
  open: boolean;
  node: SelectedNodeDetail;
  isSimplified: boolean;
  simplifiedText: string;
  simplifiedStructured?: StructuredSimplification | null;
  simplifyLoading: boolean;
  simplifyError: string | null;
  groundingInsight: GroundingInsight | null;
  groundingLoading: boolean;
  groundingError: string | null;
  onClose: () => void;
  onJumpToTimestamp: (seconds: number) => void;
  onToggleSimplify: () => void;
  onFetchWebInsights: () => void;
}

export function MobileNodeDrawer({
  open,
  node,
  isSimplified,
  simplifiedText,
  simplifiedStructured,
  simplifyLoading,
  simplifyError,
  groundingInsight,
  groundingLoading,
  groundingError,
  onClose,
  onJumpToTimestamp,
  onToggleSimplify,
  onFetchWebInsights,
}: MobileNodeDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="lg:hidden fixed inset-0 z-50 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={`${node.title} details`}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close node details drawer"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm cursor-default mf-animate-fade"
      />

      {/* Frosted Glass Bottom Sheet */}
      <div
        data-testid="mobile-node-drawer"
        className="relative z-10 w-full max-w-2xl max-h-[85dvh] flex flex-col rounded-t-3xl mf-modal-surface backdrop-blur-md overflow-hidden mf-animate-sheet"
      >
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="h-1.5 w-11 rounded-full bg-white/20" aria-hidden="true" />
        </div>

        {/* Sheet Header */}
        <div className="flex items-start justify-between gap-3 px-5 pt-2 pb-3.5 border-b border-white/[0.08] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/18 border border-violet-400/25 text-violet-200">
              <NodeIcon name={node.icon} className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              {node.isSubNode && node.parentTitle && (
                <p className="text-xs font-medium text-violet-300 truncate">
                  {node.parentTitle}
                </p>
              )}
              <h2 className="font-display text-base font-semibold tracking-[0.01em] text-white leading-snug">
                {node.title}
              </h2>
              <p className="font-mono tabular-nums text-xs text-cyan-300 mt-0.5">
                Timestamp · {node.timestampLabel}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-slate-300 hover:text-white cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable Key Points */}
        <div className="flex-1 overflow-y-auto glass-scroll px-5 py-4 space-y-4">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2.5">
              Key Points
            </h3>
            <ul className="space-y-3">
              {node.keyPoints.map((point, idx) => (
                <li
                  key={`${point.keyword}-${idx}`}
                  className="flex items-start gap-2.5 text-sm leading-relaxed text-slate-200"
                >
                  <span
                    aria-hidden="true"
                    className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400"
                  />
                  <span>
                    <strong className="font-semibold text-violet-200">
                      {point.keyword}:
                    </strong>{' '}
                    {point.detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {node.realLifeExample && (
            <div className="rounded-xl bg-white/[0.035] border border-white/[0.09] p-3.5 text-sm leading-relaxed text-slate-200">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300 mb-1.5">
                <Lightbulb className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Real-Life Example</span>
              </div>
              <p>{node.realLifeExample}</p>
            </div>
          )}

          {isSimplified && (
            <div
              data-testid="mobile-simplified-analogy"
              className="rounded-2xl bg-violet-500/[0.09] border border-violet-400/28 p-4 text-sm leading-relaxed text-slate-100"
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold text-cyan-200 mb-2.5">
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Beginner Breakdown</span>
              </div>
              {simplifyLoading ? (
                <div className="flex items-center gap-2 py-1 text-slate-300 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin text-cyan-300" aria-hidden="true" />
                  <span>Building beginner breakdown...</span>
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

          {/* Grounded Web Sources on Mobile */}
          <div className="pt-3 border-t border-white/[0.08]">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-medium text-slate-400">
                Google Search Context
              </span>
              <button
                type="button"
                onClick={onFetchWebInsights}
                disabled={groundingLoading}
                className="inline-flex items-center gap-1.5 min-h-[36px] px-2 text-xs font-semibold text-cyan-300 hover:text-cyan-200 cursor-pointer disabled:opacity-50"
              >
                {groundingLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Globe className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>{groundingInsight ? 'Refresh' : 'Live Sources'}</span>
              </button>
            </div>
            {groundingError && (
              <p role="alert" className="text-xs text-amber-300 leading-relaxed">
                {groundingError}
              </p>
            )}
            {groundingInsight && (
              <div className="rounded-xl bg-white/[0.04] border border-white/10 p-3.5 space-y-2 text-sm leading-relaxed text-slate-200">
                <p>{groundingInsight.summary}</p>
                {groundingInsight.sources.filter((src) => isSafeHttpUrl(src.uri)).length > 0 && (
                  <div className="flex flex-wrap gap-2.5 pt-1">
                    {groundingInsight.sources
                      .filter((src) => isSafeHttpUrl(src.uri))
                      .map((src, idx) => (
                        <a
                          key={`${src.uri}-${idx}`}
                          href={src.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-cyan-300 underline"
                        >
                          <span className="max-w-[180px] truncate">{src.title}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                        </a>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Fixed Bottom Action Buttons */}
        <div className="px-5 pt-3.5 mf-safe-pb border-t border-white/[0.08] bg-[#080c1c]/95 flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              onJumpToTimestamp(node.timestampSeconds);
              onClose();
            }}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/12 min-h-[46px] px-3.5 text-sm font-semibold text-white transition-colors cursor-pointer active:scale-[0.98]"
          >
            <Play className="w-3.5 h-3.5 fill-current text-cyan-300" aria-hidden="true" />
            <span>Jump to {node.timestampLabel}</span>
          </button>

          <button
            type="button"
            onClick={onToggleSimplify}
            disabled={simplifyLoading}
            aria-pressed={isSimplified}
            className={`inline-flex items-center justify-center gap-1.5 rounded-xl min-h-[46px] px-4 text-sm font-semibold text-white transition-colors cursor-pointer active:scale-[0.98] disabled:opacity-65 ${
              isSimplified
                ? 'bg-violet-500/25 border border-violet-400/40'
                : 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 border border-white/10'
            }`}
          >
            {simplifyLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="w-4 h-4" aria-hidden="true" />
            )}
            <span>{isSimplified ? 'Simplified' : 'Simplify'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
