import { type FormEvent } from 'react';
import {
  BrainCircuit,
  Download,
  FileText,
  FolderClock,
  Link2,
  Loader2,
  MessageCircle,
  Network,
  ScrollText,
  Share2,
  Sparkles,
  X,
  KeyRound,
} from 'lucide-react';
import type { ActiveTab, LanguageCode } from '../types/mindflow';
import { LanguageSwitcher } from './LanguageSwitcher';

interface DesktopNavbarProps {
  urlInput: string;
  urlError: string | null;
  showTranscriptFallback: boolean;
  activeTab: ActiveTab;
  language: LanguageCode;
  isAnalyzing: boolean;
  isTranslating: boolean;
  libraryCount: number;
  chatOpen: boolean;
  hasOwnKey: boolean;
  onUrlChange: (value: string) => void;
  onUrlClear: () => void;
  onUrlSubmit: () => void;
  onTabChange: (tab: ActiveTab) => void;
  onLanguageChange: (lang: LanguageCode) => void;
  onShareLink: () => void;
  onOpenExport: () => void;
  onOpenLibrary: () => void;
  onOpenManualTranscript: () => void;
  onToggleChat: () => void;
  onOpenApiKey: () => void;
}

const TABS: Array<{ id: ActiveTab; label: string; icon: typeof Network }> = [
  { id: 'mindmap', label: 'Mindmap', icon: Network },
  { id: 'cheatsheet', label: 'Cheat Sheet', icon: FileText },
  { id: 'script', label: 'Script', icon: ScrollText },
];

export function DesktopNavbar({
  urlInput,
  urlError,
  showTranscriptFallback,
  activeTab,
  language,
  isAnalyzing,
  isTranslating,
  libraryCount,
  chatOpen,
  hasOwnKey,
  onUrlChange,
  onUrlClear,
  onUrlSubmit,
  onTabChange,
  onLanguageChange,
  onShareLink,
  onOpenExport,
  onOpenLibrary,
  onOpenManualTranscript,
  onToggleChat,
  onOpenApiKey,
}: DesktopNavbarProps) {
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onUrlSubmit();
  };

  return (
    <header className="hidden lg:block sticky top-0 z-30 px-4 xl:px-5 pt-3 pb-1.5">
      <div className="mx-auto max-w-[1800px] rounded-2xl mf-panel backdrop-blur-md px-3.5 xl:px-4 py-2 flex items-center justify-between gap-2.5 xl:gap-3.5">
        {/* Left: Brand Logo + Title + Subtitle */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 via-indigo-500 to-cyan-400 shrink-0 shadow-sm shadow-violet-900/40">
            <BrainCircuit className="h-5 w-5 text-white" aria-hidden="true" />
          </div>
          <div className="leading-tight">
            <h1 className="text-[15px] font-bold tracking-[0.01em] text-white whitespace-nowrap">
              MindFlow AI
            </h1>
            <p className="hidden xl:block text-xs font-medium text-slate-400 whitespace-nowrap">
              YouTube → Interactive Mindmap
            </p>
          </div>
        </div>

        {/* Center-Left: YouTube URL Input + Primary Analyze Action */}
        <form
          onSubmit={handleSubmit}
          className="relative flex-1 max-w-[420px] min-w-[210px]"
          noValidate
        >
          <label htmlFor="desktop-youtube-url" className="sr-only">
            YouTube video URL
          </label>
          <div
            className={`flex items-center gap-1.5 rounded-full bg-[#070a15] border pl-3.5 pr-1 py-1 transition-colors duration-150 ${
              urlError
                ? 'border-rose-400/75'
                : 'border-white/[0.12] focus-within:border-cyan-400/60'
            }`}
          >
            <Link2 className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            <input
              id="desktop-youtube-url"
              type="text"
              value={urlInput}
              onChange={(e) => onUrlChange(e.target.value)}
              placeholder="Paste any YouTube URL or video ID..."
              disabled={isAnalyzing}
              className="w-full bg-transparent text-[13px] text-slate-100 placeholder:text-slate-500 focus:outline-none truncate"
            />
            {urlInput && !isAnalyzing && (
              <button
                type="button"
                onClick={onUrlClear}
                aria-label="Clear YouTube URL"
                className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-colors shrink-0 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
            <button
              type="submit"
              disabled={isAnalyzing}
              aria-label="Analyze YouTube URL"
              className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-violet-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400 px-3.5 py-1.5 min-h-[34px] text-xs font-semibold text-white shadow-sm shadow-indigo-950/50 transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-65 active:scale-[0.98]"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  <span>Analyzing</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Analyze</span>
                </>
              )}
            </button>
          </div>

          {urlError && (
            <div
              role="alert"
              className="absolute left-1 right-0 top-full mt-2 rounded-xl mf-modal-surface border-rose-500/40 px-3.5 py-2.5 text-xs text-rose-200 z-40 space-y-1.5 mf-animate-fade"
            >
              <p className="leading-relaxed">{urlError}</p>
              {showTranscriptFallback && (
                <button
                  type="button"
                  onClick={onOpenManualTranscript}
                  className="text-cyan-300 hover:text-cyan-200 font-semibold underline underline-offset-2 cursor-pointer"
                >
                  Have a private video or caption error? Paste transcript manually →
                </button>
              )}
            </div>
          )}
        </form>

        {/* Center-Right: Clean Segmented View Switcher */}
        <nav aria-label="Workspace views" className="shrink-0">
          <div
            role="tablist"
            aria-label="Workspace views"
            className="flex items-center gap-0.5 rounded-full bg-[#070a15] border border-white/[0.1] p-1"
          >
            {TABS.map((tab, index) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => onTabChange(tab.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                      e.preventDefault();
                      const delta = e.key === 'ArrowRight' ? 1 : -1;
                      const nextTab = TABS[(index + delta + TABS.length) % TABS.length];
                      onTabChange(nextTab.id);
                    }
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 min-h-[34px] text-[13px] font-semibold transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
                    isActive
                      ? 'bg-violet-500/24 text-white border border-violet-400/40'
                      : 'border border-transparent text-slate-400 hover:text-slate-100 hover:bg-white/[0.06]'
                  }`}
                >
                  <Icon
                    className={`h-3.5 w-3.5 ${isActive ? 'text-cyan-300' : ''}`}
                    aria-hidden="true"
                  />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Right: Language Switcher + Ask AI Docked Toggle + Secondary Utility Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="hidden 2xl:block">
            <LanguageSwitcher
              value={language}
              isTranslating={isTranslating}
              onChange={onLanguageChange}
            />
          </div>

          <button
            type="button"
            data-testid="desktop-apikey-btn"
            onClick={onOpenApiKey}
            aria-label="Use your own Gemini API key"
            title="Use your own free Gemini key (no daily cap from this site)"
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 min-h-[36px] text-xs font-semibold border bg-white/[0.06] hover:bg-white/[0.11] text-slate-100 border-white/[0.12] transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <KeyRound className={`h-3.5 w-3.5 shrink-0 ${hasOwnKey ? 'text-emerald-400' : 'text-cyan-300'}`} aria-hidden="true" />
            <span className="hidden xl:inline">{hasOwnKey ? 'My key' : 'Own key'}</span>
          </button>

          <button
            type="button"
            data-testid="ask-ai-desktop-toggle"
            onClick={onToggleChat}
            aria-pressed={chatOpen}
            aria-label={chatOpen ? 'Close Ask This Video panel' : 'Open Ask This Video AI chat'}
            title="Ask This Video AI Tutor"
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 min-h-[36px] text-xs font-semibold border transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer active:scale-[0.98] ${
              chatOpen
                ? 'bg-gradient-to-r from-violet-600/90 to-indigo-600/90 border-cyan-400/45 text-white shadow-sm shadow-violet-950/50'
                : 'bg-violet-500/14 hover:bg-violet-500/22 border-violet-400/35 text-violet-100'
            }`}
          >
            <MessageCircle className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />
            <span>Ask AI</span>
          </button>

          <button
            type="button"
            data-testid="desktop-library-btn"
            onClick={onOpenLibrary}
            aria-label={`Open saved library (${libraryCount} saved)`}
            title="Saved Library & History"
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.1] text-slate-300 hover:text-white transition-colors cursor-pointer"
          >
            <FolderClock className="h-4 w-4" aria-hidden="true" />
            {libraryCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-violet-500 px-1 text-[10px] font-bold text-white">
                {libraryCount}
              </span>
            )}
          </button>

          <button
            type="button"
            data-testid="desktop-export-btn"
            onClick={onOpenExport}
            aria-label="Export study pack"
            title="Export Visual PDF, Mindmap PNG, Markdown, JSON, or Text"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.1] text-slate-300 hover:text-white transition-colors cursor-pointer"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onShareLink}
            aria-label="Share deep link"
            title="Copy deep link to current video & timestamp"
            className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] px-3 py-1.5 min-h-[36px] text-xs font-semibold text-slate-100 border border-white/[0.12] transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer active:scale-[0.98]"
          >
            <Share2 className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />
            <span className="hidden xl:inline">Share</span>
          </button>
        </div>
      </div>
    </header>
  );
}
