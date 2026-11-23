import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  Copy,
  Download,
  FileCode2,
  FileText,
  Image as ImageIcon,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';
import type { LectureWorkspace } from '../types/mindflow';
import {
  formatAsJson,
  formatAsMarkdown,
  formatAsPlainText,
} from '../utils/exportFormats';
import {
  buildSafeExportFilename,
  copyTextWithFallback,
  exportMindmapPng,
  isRunningInIframe,
  triggerBlobDownload,
} from '../utils/pdfExport';

interface ExportModalProps {
  open: boolean;
  workspace: LectureWorkspace;
  onClose: () => void;
  onNotify: (message: string, variant?: 'success' | 'error' | 'info') => void;
  onOpenVisualPdfStudio: () => void;
}

export function ExportModal({
  open,
  workspace,
  onClose,
  onNotify,
  onOpenVisualPdfStudio,
}: ExportModalProps) {
  const [copiedKey, setCopiedKey] = useState<'md' | 'json' | 'txt' | null>(null);
  const [exportingPng, setExportingPng] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const inIframe = isRunningInIframe();

  const notifyDownloadResult = (label: string, filename: string, downloaded: boolean) => {
    if (!downloaded) {
      onNotify(
        'Preview sandbox may block downloads — open app in a new tab or use the Copy button',
        'error'
      );
      return;
    }
    if (inIframe) {
      onNotify(
        `Saved ${label} (${filename}) — if preview blocks downloads, open in a new tab or use Copy`,
        'info'
      );
      return;
    }
    onNotify(`Downloaded ${label}: ${filename}`, 'success');
  };

  const handleCopyFormat = async (kind: 'md' | 'json' | 'txt') => {
    const content =
      kind === 'md'
        ? formatAsMarkdown(workspace)
        : kind === 'json'
          ? formatAsJson(workspace)
          : formatAsPlainText(workspace);
    const copied = await copyTextWithFallback(content);
    if (!copied) {
      onNotify('Clipboard access was blocked — try downloading the file instead', 'error');
      return;
    }
    setCopiedKey(kind);
    onNotify(
      kind === 'md'
        ? 'Full Markdown study pack copied'
        : kind === 'json'
          ? 'Mindmap JSON copied to clipboard'
          : 'Plain text study notes copied',
      'success'
    );
    window.setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleDownloadMarkdown = () => {
    const filename = buildSafeExportFilename(workspace.title, workspace.language, 'md');
    const blob = new Blob([formatAsMarkdown(workspace)], {
      type: 'text/markdown;charset=utf-8',
    });
    const downloaded = triggerBlobDownload(blob, filename);
    notifyDownloadResult('Markdown', filename, downloaded);
  };

  const handleDownloadJson = () => {
    const filename = buildSafeExportFilename(workspace.title, workspace.language, 'json');
    const blob = new Blob([formatAsJson(workspace)], {
      type: 'application/json;charset=utf-8',
    });
    const downloaded = triggerBlobDownload(blob, filename);
    notifyDownloadResult('JSON', filename, downloaded);
  };

  const handleDownloadText = () => {
    const filename = buildSafeExportFilename(workspace.title, workspace.language, 'txt');
    const blob = new Blob([formatAsPlainText(workspace)], {
      type: 'text/plain;charset=utf-8',
    });
    const downloaded = triggerBlobDownload(blob, filename);
    notifyDownloadResult('study notes (.txt)', filename, downloaded);
  };

  const handleDownloadMindmapPng = async () => {
    if (exportingPng) return;
    setExportingPng(true);
    try {
      const { filename, downloaded } = await exportMindmapPng(workspace);
      notifyDownloadResult('Mindmap PNG', filename, downloaded);
    } catch {
      onNotify('Could not export Mindmap PNG right now — try Copy Markdown', 'error');
    } finally {
      setExportingPng(false);
    }
  };

  const portableFormats: Array<{
    key: 'md' | 'json' | 'txt';
    title: string;
    ext: string;
    description: string;
    icon: typeof FileText;
    iconBg: string;
    downloadBtnClass: string;
    testId: string;
    onDownload: () => void;
    copyAriaLabel: string;
  }> = [
    {
      key: 'md',
      title: 'Markdown Notes',
      ext: '.md',
      description: 'Ready for Notion, Obsidian, and GitHub study repositories',
      icon: FileText,
      iconBg: 'bg-violet-500/18 border-violet-400/30 text-violet-200',
      downloadBtnClass:
        'bg-violet-500/18 hover:bg-violet-500/30 border-violet-400/35 text-violet-100',
      testId: 'export-download-md-btn',
      onDownload: handleDownloadMarkdown,
      copyAriaLabel: 'Copy Markdown study pack',
    },
    {
      key: 'json',
      title: 'Structured Graph',
      ext: '.json',
      description: 'Complete mindmap hierarchy, nodes, and synced timestamps',
      icon: FileCode2,
      iconBg: 'bg-cyan-500/16 border-cyan-400/30 text-cyan-200',
      downloadBtnClass:
        'bg-cyan-500/16 hover:bg-cyan-500/28 border-cyan-400/35 text-cyan-100',
      testId: 'export-download-json-btn',
      onDownload: handleDownloadJson,
      copyAriaLabel: 'Copy structured JSON',
    },
    {
      key: 'txt',
      title: 'Plain Text Guide',
      ext: '.txt',
      description: 'Clean universal study notes & chapter transcript',
      icon: FileText,
      iconBg: 'bg-emerald-500/16 border-emerald-400/30 text-emerald-200',
      downloadBtnClass:
        'bg-emerald-500/16 hover:bg-emerald-500/28 border-emerald-400/35 text-emerald-100',
      testId: 'export-download-txt-btn',
      onDownload: handleDownloadText,
      copyAriaLabel: 'Copy plain text study notes',
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3.5 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
    >
      <button
        type="button"
        aria-label="Close export modal"
        onClick={onClose}
        className="absolute inset-0 bg-black/72 backdrop-blur-sm cursor-default mf-animate-fade"
      />

      <div
        data-testid="export-modal"
        className="relative z-10 w-full max-w-[560px] max-h-[92dvh] flex flex-col rounded-3xl mf-modal-surface backdrop-blur-md overflow-hidden mf-animate-modal"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-4 pb-3.5 border-b border-white/[0.08] shrink-0">
          <div className="min-w-0">
            <h2
              id="export-modal-title"
              className="font-display text-lg font-bold text-white leading-tight"
            >
              Export Study Pack
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 truncate">
              {workspace.title} · {workspace.nodes.length} mindmap nodes
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close export modal"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-slate-300 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto glass-scroll px-5 sm:px-6 py-3.5 sm:py-4 space-y-4">
          {/* Group 1: Visual Exports */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 px-0.5">
              Visual Exports
            </p>

            {/* Flagship: Visual PDF Guide Studio */}
            <button
              type="button"
              data-testid="export-open-visual-pdf-btn"
              onClick={() => {
                onClose();
                onOpenVisualPdfStudio();
              }}
              className="group w-full flex items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-violet-500/[0.16] via-indigo-500/[0.14] to-cyan-500/[0.12] hover:from-violet-500/[0.24] hover:to-cyan-500/[0.18] border border-violet-400/38 px-4 py-3 text-left transition-colors cursor-pointer"
            >
              <div className="flex items-start gap-3 min-w-0">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-cyan-400 text-white shadow-sm shadow-violet-950/50 mt-0.5">
                  <BookOpen className="w-4.5 h-4.5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-white flex items-center gap-1.5 leading-snug">
                    <span>Visual PDF Guide Studio</span>
                    <Sparkles className="w-3.5 h-3.5 text-cyan-300 shrink-0" aria-hidden="true" />
                  </p>
                  <p className="text-[13px] text-slate-200/85 mt-0.5 leading-snug">
                    Direct multi-page A4 PDF, printable HTML &amp; 3 magazine themes
                  </p>
                </div>
              </div>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.08] text-cyan-200 group-hover:translate-x-0.5 transition-transform">
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </span>
            </button>

            {/* Mindmap PNG */}
            <div className="rounded-2xl bg-white/[0.03] hover:bg-white/[0.05] border border-white/[0.09] hover:border-white/[0.16] p-3.5 transition-colors">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/20 border border-indigo-400/30 text-indigo-200 mt-0.5">
                    {exportingPng ? (
                      <Loader2 className="w-4.5 h-4.5 animate-spin text-cyan-300" aria-hidden="true" />
                    ) : (
                      <ImageIcon className="w-4.5 h-4.5" aria-hidden="true" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-nowrap">
                      <p className="text-sm font-semibold text-white leading-snug whitespace-nowrap truncate">
                        {exportingPng ? 'Rendering Mindmap PNG...' : 'Mindmap Snapshot'}
                      </p>
                      <span className="rounded-md bg-white/[0.06] border border-white/10 px-1.5 py-0.5 font-mono text-xs text-slate-300 shrink-0">
                        .png
                      </span>
                    </div>
                    <p className="text-[13px] text-slate-400 mt-0.5 leading-snug">
                      High-resolution 2x visual diagram of the full mindmap
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  data-testid="export-mindmap-png-btn"
                  onClick={handleDownloadMindmapPng}
                  disabled={exportingPng}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-500/18 hover:bg-indigo-500/30 border border-indigo-400/35 px-3.5 py-2 min-h-[38px] text-xs font-semibold text-indigo-100 transition-colors shrink-0 cursor-pointer disabled:opacity-55 whitespace-nowrap"
                >
                  {exportingPng ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span>{exportingPng ? 'Rendering...' : 'Download'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Group 2: Portable Study Files (Markdown, JSON, Plain Text) */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 px-0.5">
              Portable Study Files
            </p>

            <div className="space-y-2">
              {portableFormats.map((item) => {
                const Icon = item.icon;
                const isCopied = copiedKey === item.key;

                return (
                  <div
                    key={item.key}
                    className="rounded-2xl bg-white/[0.03] hover:bg-white/[0.05] border border-white/[0.09] hover:border-white/[0.16] p-3.5 transition-colors"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <span
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border mt-0.5 ${item.iconBg}`}
                        >
                          <Icon className="w-4.5 h-4.5" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-nowrap">
                            <p className="text-sm font-semibold text-white leading-snug whitespace-nowrap truncate">
                              {item.title}
                            </p>
                            <span className="rounded-md bg-white/[0.06] border border-white/10 px-1.5 py-0.5 font-mono text-xs text-slate-300 shrink-0">
                              {item.ext}
                            </span>
                          </div>
                          <p className="text-[13px] text-slate-400 mt-0.5 leading-snug">
                            {item.description}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 sm:ml-2">
                        <button
                          type="button"
                          data-testid={item.testId}
                          onClick={item.onDownload}
                          className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 rounded-xl border px-3.5 py-2 min-h-[38px] text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${item.downloadBtnClass}`}
                        >
                          <Download className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Download</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleCopyFormat(item.key)}
                          aria-label={item.copyAriaLabel}
                          className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 min-h-[38px] text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                            isCopied
                              ? 'bg-emerald-500/18 border-emerald-400/40 text-emerald-200'
                              : 'bg-white/[0.05] hover:bg-white/[0.12] border-white/12 text-slate-200 hover:text-white'
                          }`}
                        >
                          {isCopied ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-300" aria-hidden="true" />
                              <span>Copied</span>
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
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
