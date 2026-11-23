import { useEffect, useMemo, useState } from 'react';
import {
  Clock,
  FileText,
  FolderClock,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { LanguageCode, SavedLibraryEntry } from '../types/mindflow';
import {
  filterLibraryItems,
  isDemoLibraryEntry,
  MAX_LIBRARY_ITEMS,
} from '../utils/libraryStorage';
import { isManualTranscriptWorkspace } from '../utils/manualTranscript';

interface LibraryDrawerProps {
  open: boolean;
  items: SavedLibraryEntry[];
  activeVideoId: string;
  storageNotice?: string | null;
  onClose: () => void;
  onSelectEntry: (entry: SavedLibraryEntry) => void;
  onDeleteEntry: (videoId: string) => void;
}

const LANG_LABEL: Record<LanguageCode, string> = {
  en: 'EN',
  hi: 'हिंदी',
  hinglish: 'Hinglish',
};

function formatRelativeTime(timestamp: number): string {
  const diffSec = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

export function LibraryDrawer({
  open,
  items,
  activeVideoId,
  storageNotice,
  onClose,
  onSelectEntry,
  onDeleteEntry,
}: LibraryDrawerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [failedThumbnails, setFailedThumbnails] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const visibleItems = useMemo(
    () => filterLibraryItems(items, searchQuery),
    [items, searchQuery]
  );

  if (!open) return null;

  return (
    <div
      data-mindflow-print-hide="true"
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="library-drawer-title"
    >
      <button
        type="button"
        aria-label="Close library drawer"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm cursor-default mf-animate-fade"
      />

      <aside
        data-testid="library-drawer"
        className="relative z-10 w-full max-w-md h-full flex flex-col mf-modal-surface backdrop-blur-md border-l border-white/12 mf-animate-fade"
      >
        {/* Drawer Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-white/[0.08]">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/18 border border-violet-400/30 text-violet-200">
              <FolderClock className="w-4.5 h-4.5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2
                id="library-drawer-title"
                className="font-display text-base font-bold text-white"
              >
                Saved Library &amp; History
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {items.length}/{MAX_LIBRARY_ITEMS} videos saved locally
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close library"
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-slate-300 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Transparent Local Capacity Meter */}
        <div className="px-5 py-2.5 border-b border-white/[0.06] bg-white/[0.015] space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Browser storage slots</span>
            <span className="font-mono text-slate-300">
              {items.length} / {MAX_LIBRARY_ITEMS}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-white/[0.07] overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                items.length >= MAX_LIBRARY_ITEMS
                  ? 'bg-amber-400'
                  : items.length >= MAX_LIBRARY_ITEMS - 2
                    ? 'bg-cyan-400'
                    : 'bg-gradient-to-r from-violet-500 to-cyan-400'
              }`}
              style={{
                width: `${Math.min(100, Math.round((items.length / MAX_LIBRARY_ITEMS) * 100))}%`,
              }}
            />
          </div>
          {items.length >= MAX_LIBRARY_ITEMS - 2 && (
            <p className="text-[11.5px] text-amber-200/90 leading-snug">
              {items.length >= MAX_LIBRARY_ITEMS
                ? 'Library is full (15/15). Saving a new video replaces the oldest entry unless you delete one first.'
                : `Approaching the ${MAX_LIBRARY_ITEMS}-video local limit. Delete older items anytime to keep favorites.`}
            </p>
          )}
          {storageNotice && (
            <p className="text-[11.5px] text-rose-200/90 leading-snug">{storageNotice}</p>
          )}
        </div>

        {/* Instant Filter Bar */}
        {items.length > 1 && (
          <div className="px-4 pt-3.5 pb-1">
            <div className="relative">
              <label htmlFor="library-search-input" className="sr-only">
                Search saved library
              </label>
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
                aria-hidden="true"
              />
              <input
                id="library-search-input"
                type="text"
                role="searchbox"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by title, channel, or topic..."
                className="w-full rounded-xl bg-white/[0.05] border border-white/12 pl-10 pr-9 py-2.5 min-h-[42px] text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400/60"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear library filter"
                  className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Saved Items List */}
        <div className="flex-1 overflow-y-auto glass-scroll p-4 mf-safe-pb space-y-3">
          {items.length === 0 ? (
            <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-8 text-center space-y-2.5">
              <Sparkles className="w-6 h-6 text-cyan-300 mx-auto" aria-hidden="true" />
              <p className="text-[15px] font-semibold text-white">No saved videos yet</p>
              <p className="text-sm text-slate-400 leading-relaxed">
                Every YouTube video you analyze is saved automatically here so you can reopen mindmaps &amp; PDF guides instantly.
              </p>
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-6 text-center space-y-2.5">
              <p className="text-sm font-semibold text-slate-200">
                No saved videos match &ldquo;{searchQuery}&rdquo;
              </p>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="inline-flex items-center gap-1 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 px-3.5 py-2 min-h-[38px] text-xs font-semibold text-white cursor-pointer"
              >
                Clear filter
              </button>
            </div>
          ) : (
            visibleItems.map((entry) => {
              const isActive = entry.videoId === activeVideoId;
              const isDemo = isDemoLibraryEntry(entry);
              const isTranscriptOnly = !isDemo && isManualTranscriptWorkspace(entry);
              const hasPdfGuide = Object.keys(entry.visualGuidesByLang ?? {}).length > 0;
              const showImage =
                Boolean(entry.thumbnailUrl) && !failedThumbnails[entry.videoId];

              return (
                <div
                  key={entry.videoId}
                  data-testid={`library-item-${entry.videoId}`}
                  className={`group relative rounded-2xl border p-3.5 transition-colors ${
                    isActive
                      ? 'bg-violet-500/[0.11] border-violet-400/40'
                      : 'bg-white/[0.03] hover:bg-white/[0.055] border-white/[0.09] hover:border-white/16'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => onSelectEntry(entry)}
                      className="flex items-start gap-3 flex-1 min-w-0 text-left cursor-pointer"
                    >
                      {showImage ? (
                        <img
                          src={entry.thumbnailUrl}
                          alt={entry.title}
                          onError={() =>
                            setFailedThumbnails((prev) => ({
                              ...prev,
                              [entry.videoId]: true,
                            }))
                          }
                          className="w-24 h-16 shrink-0 rounded-xl object-cover bg-slate-900 border border-white/10"
                        />
                      ) : (
                        <div className="w-24 h-16 shrink-0 rounded-xl bg-gradient-to-br from-violet-600/25 via-indigo-900/40 to-cyan-500/20 border border-white/12 flex flex-col items-center justify-center text-cyan-200 gap-1">
                          <FileText className="w-4 h-4" aria-hidden="true" />
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                            Notes
                          </span>
                        </div>
                      )}

                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-start gap-1.5">
                          <p className="font-display text-sm font-semibold text-white line-clamp-2 leading-snug flex-1">
                            {entry.title}
                          </p>
                          {isDemo && (
                            <span
                              data-testid="demo-badge-library"
                              className="shrink-0 mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase bg-amber-500/12 text-amber-200/90 border border-amber-400/25"
                            >
                              DEMO
                            </span>
                          )}
                          {isTranscriptOnly && (
                            <span
                              data-testid="transcript-badge-library"
                              className="shrink-0 mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase bg-violet-500/15 text-violet-200 border border-violet-400/30"
                            >
                              TRANSCRIPT
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 truncate">
                          {entry.channel}
                        </p>

                        <p className="text-xs text-slate-400 truncate pt-0.5">
                          <span className="text-slate-300">{entry.videoCategory}</span>
                          <span> · {entry.languages.map((lang) => LANG_LABEL[lang]).join(', ')}</span>
                          {hasPdfGuide && <span className="text-emerald-300"> · PDF</span>}
                        </p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => onDeleteEntry(entry.videoId)}
                      aria-label={`Delete ${entry.title} from saved library`}
                      title="Remove from library"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:text-rose-300 hover:bg-rose-500/15 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="mt-2.5 pt-2.5 border-t border-white/[0.06] flex items-center justify-between text-xs text-slate-400">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Saved {formatRelativeTime(entry.savedAt)}</span>
                    </span>
                    <span className={isActive ? 'text-cyan-300 font-semibold' : 'text-slate-400'}>
                      {isActive ? 'Currently open' : 'Saved locally'}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
}
