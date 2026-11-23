import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  CheckSquare,
  Clock,
  Copy,
  FileCode,
  FileDown,
  Image as ImageIcon,
  Layers,
  Lightbulb,
  Loader2,
  Palette,
  Printer,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Tv,
  X,
} from 'lucide-react';
import type {
  LanguageCode,
  VisualGuideData,
  VisualGuideTheme,
} from '../types/mindflow';
import {
  adaptSvgDiagramToTheme,
  formatVisualGuideAsNotionMarkdown,
  sanitizeSvgDiagram,
} from '../utils/visualGuide';
import {
  buildSafeExportFilename,
  buildStandalonePrintableHtml,
  copyTextWithFallback,
  exportVisualGuideToPdf,
  inlineGuideImages,
  isRunningInIframe,
  triggerBlobDownload,
} from '../utils/pdfExport';

interface VisualPdfStudioModalProps {
  open: boolean;
  guide: VisualGuideData | null;
  language: LanguageCode;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
  onGenerateLongGuide: () => void;
  onNotify: (message: string, variant?: 'success' | 'error' | 'info') => void;
}

interface ThemeStyles {
  label: string;
  swatch: string;
  pageBg: string;
  cardBg: string;
  cardBorder: string;
  heroBg: string;
  titleColor: string;
  bodyColor: string;
  mutedColor: string;
  takeawayBg: string;
  takeawayBorder: string;
  termBg: string;
  termText: string;
  insightBg: string;
  insightBorder: string;
  insightTitle: string;
  insightText: string;
  tableHeaderBg: string;
  tableRowBorder: string;
  tableDivider: string;
  checkBg: string;
  mediaFrameBg: string;
  diagramFrameBg: string;
  categoryBadge: string;
  exampleBg: string;
  summaryBorder: string;
}

const THEME_CONFIG: Record<VisualGuideTheme, ThemeStyles> = {
  obsidian: {
    label: 'Obsidian Magazine',
    swatch: 'bg-[#0F172A] border-cyan-400/60',
    pageBg: 'bg-[#0F172A] text-slate-100',
    cardBg: 'bg-[#162038]',
    cardBorder: 'border-slate-700/70',
    heroBg: 'bg-gradient-to-br from-[#171c3a] via-[#10192f] to-[#0d2236]',
    titleColor: 'text-white',
    bodyColor: 'text-slate-200',
    mutedColor: 'text-slate-400',
    takeawayBg: 'bg-cyan-500/10',
    takeawayBorder: 'border-cyan-400/30',
    termBg: 'bg-violet-500/15 border-violet-400/35',
    termText: 'text-violet-200',
    insightBg: 'bg-gradient-to-r from-violet-500/15 via-indigo-500/12 to-cyan-500/15',
    insightBorder: 'border-cyan-400/35',
    insightTitle: 'text-cyan-300',
    insightText: 'text-slate-100',
    tableHeaderBg: 'bg-slate-900/70 text-slate-300',
    tableRowBorder: 'border-slate-700/60',
    tableDivider: 'divide-slate-700/50',
    checkBg: 'bg-emerald-500/10 border-emerald-400/25',
    mediaFrameBg: 'bg-[#0b1120] border-slate-700/70',
    diagramFrameBg: 'bg-[#0b1120] border-slate-700/70',
    categoryBadge: 'bg-indigo-500/20 border-indigo-400/40 text-indigo-200',
    exampleBg: 'bg-emerald-500/10 border-emerald-400/25',
    summaryBorder: 'border-slate-700/70',
  },
  warm: {
    label: 'Warm Aesthetic',
    swatch: 'bg-[#FAF8F5] border-amber-400/70',
    pageBg: 'bg-[#FAF8F5] text-stone-900',
    cardBg: 'bg-[#FFFDF9]',
    cardBorder: 'border-stone-200/90',
    heroBg: 'bg-gradient-to-br from-[#F3EFE6] via-[#FAF6EE] to-[#EEF5F1]',
    titleColor: 'text-stone-900',
    bodyColor: 'text-stone-700',
    mutedColor: 'text-stone-500',
    takeawayBg: 'bg-[#EEF2FF]',
    takeawayBorder: 'border-indigo-200',
    termBg: 'bg-emerald-50 border-emerald-200',
    termText: 'text-emerald-800',
    insightBg: 'bg-[#FDF6E7]',
    insightBorder: 'border-amber-300/80',
    insightTitle: 'text-amber-800',
    insightText: 'text-stone-800',
    tableHeaderBg: 'bg-[#F3EFE6] text-stone-700',
    tableRowBorder: 'border-stone-200',
    tableDivider: 'divide-stone-200',
    checkBg: 'bg-[#ECFDF5] border-emerald-200',
    mediaFrameBg: 'bg-[#F5F1E8] border-stone-200',
    diagramFrameBg: 'bg-[#FAF6EE] border-stone-300/90',
    categoryBadge: 'bg-amber-100 border-amber-300 text-amber-900',
    exampleBg: 'bg-[#F0FDF4] border-emerald-200',
    summaryBorder: 'border-stone-200',
  },
  blueprint: {
    label: 'Blueprint Pro',
    swatch: 'bg-[#EEF2F6] border-indigo-500/70',
    pageBg: 'bg-[#F1F5F9] text-slate-900',
    cardBg: 'bg-white',
    cardBorder: 'border-slate-200',
    heroBg: 'bg-gradient-to-br from-[#E2E8F0] via-[#F1F5F9] to-[#E0F2FE]',
    titleColor: 'text-slate-950',
    bodyColor: 'text-slate-700',
    mutedColor: 'text-slate-500',
    takeawayBg: 'bg-sky-50',
    takeawayBorder: 'border-sky-200',
    termBg: 'bg-indigo-50 border-indigo-200',
    termText: 'text-indigo-800',
    insightBg: 'bg-slate-50',
    insightBorder: 'border-indigo-300',
    insightTitle: 'text-indigo-700',
    insightText: 'text-slate-800',
    tableHeaderBg: 'bg-slate-100 text-slate-700',
    tableRowBorder: 'border-slate-200',
    tableDivider: 'divide-slate-200',
    checkBg: 'bg-sky-50/70 border-sky-200',
    mediaFrameBg: 'bg-slate-100 border-slate-200',
    diagramFrameBg: 'bg-[#F8FAFC] border-slate-300',
    categoryBadge: 'bg-indigo-100 border-indigo-300 text-indigo-900',
    exampleBg: 'bg-sky-50/80 border-sky-200',
    summaryBorder: 'border-slate-200',
  },
};

const ACCENT_BADGE: Record<string, Record<VisualGuideTheme, string>> = {
  violet: {
    obsidian: 'bg-violet-500/20 text-violet-200 border-violet-400/40',
    warm: 'bg-violet-100 text-violet-800 border-violet-200',
    blueprint: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  },
  cyan: {
    obsidian: 'bg-cyan-500/20 text-cyan-200 border-cyan-400/40',
    warm: 'bg-teal-100 text-teal-800 border-teal-200',
    blueprint: 'bg-sky-100 text-sky-800 border-sky-200',
  },
  emerald: {
    obsidian: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40',
    warm: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    blueprint: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  },
  indigo: {
    obsidian: 'bg-indigo-500/20 text-indigo-200 border-indigo-400/40',
    warm: 'bg-indigo-100 text-indigo-800 border-indigo-200',
    blueprint: 'bg-blue-100 text-blue-800 border-blue-200',
  },
};

function SafePreviewImage({
  src,
  alt,
  caption,
  frameClass,
  mutedClass,
}: {
  src: string;
  alt: string;
  caption?: string;
  frameClass: string;
  mutedClass: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) return null;

  return (
    <figure className={`rounded-xl border overflow-hidden ${frameClass}`}>
      <img
        src={src}
        alt={alt}
        loading="eager"
        onError={() => setFailed(true)}
        className="w-full h-36 object-cover bg-slate-950/30"
      />
      {caption && (
        <figcaption className={`px-3 py-1.5 text-[11px] truncate ${mutedClass}`}>
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

export function VisualPdfStudioModal({
  open,
  guide,
  language,
  isLoading,
  error,
  onClose,
  onRetry,
  onGenerateLongGuide,
  onNotify,
}: VisualPdfStudioModalProps) {
  const [theme, setTheme] = useState<VisualGuideTheme>('warm');
  const [showVideoFrames, setShowVideoFrames] = useState(true);
  const [showWebImages, setShowWebImages] = useState(true);
  const [showDiagrams, setShowDiagrams] = useState(true);
  const [showInsights, setShowInsights] = useState(true);
  const [copiedNotion, setCopiedNotion] = useState(false);
  const [pdfStatus, setPdfStatus] = useState<'idle' | 'rendering' | 'saved'>('idle');
  const [pdfProgressText, setPdfProgressText] = useState('Rendering PDF...');
  const [htmlExporting, setHtmlExporting] = useState(false);
  const [mobileOptionsOpen, setMobileOptionsOpen] = useState(false);
  const documentRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const sanitizedChapters = useMemo(() => {
    if (!guide) return [];
    return guide.chapters.map((ch) => {
      const hasDiagram = typeof ch.svgDiagram === 'string' && ch.svgDiagram.trim().length > 0;
      const sanitized = hasDiagram
        ? sanitizeSvgDiagram(ch.svgDiagram, ch.heading, ch.keyTerms)
        : '';
      return {
        ...ch,
        safeSvg: sanitized ? adaptSvgDiagramToTheme(sanitized, theme) : '',
      };
    });
  }, [guide, theme]);

  if (!open) return null;

  const t = THEME_CONFIG[theme];
  const langBadge =
    language === 'hi' ? 'Hindi (हिंदी)' : language === 'hinglish' ? 'Hinglish' : 'English';
  const inIframe = isRunningInIframe();

  const handleCopyNotionMarkdown = async () => {
    if (!guide) return;
    const md = formatVisualGuideAsNotionMarkdown(guide);
    const copied = await copyTextWithFallback(md);
    if (!copied) {
      onNotify(
        'Clipboard access was blocked — try Download Printable HTML instead',
        'error'
      );
      return;
    }
    setCopiedNotion(true);
    onNotify('Copied Rich Notion Markdown', 'success');
    window.setTimeout(() => setCopiedNotion(false), 2200);
  };

  /** Primary button: Direct multi-page A4 .pdf file generator via html-to-image + jsPDF */
  const handleDownloadDirectPdf = async () => {
    if (!guide || !documentRef.current || pdfStatus === 'rendering') return;
    setPdfStatus('rendering');
    setPdfProgressText('Rendering PDF...');

    try {
      const result = await exportVisualGuideToPdf({
        container: documentRef.current,
        title: guide.title,
        language,
        theme,
        onProgress: (label) => setPdfProgressText(label),
      });

      if (!result.downloaded) {
        setPdfStatus('idle');
        onNotify(
          'Preview sandbox may block downloads — open app in a new tab or use Copy Markdown',
          'error'
        );
        return;
      }

      setPdfStatus('saved');
      if (inIframe) {
        onNotify(
          `Saved ${result.pageCount}-page PDF (${result.filename}). If preview blocks downloads, open in a new tab or use Copy Markdown.`,
          'info'
        );
      } else {
        onNotify(`Saved ${result.pageCount}-page PDF: ${result.filename}`, 'success');
      }
      window.setTimeout(() => setPdfStatus('idle'), 2400);
    } catch {
      setPdfStatus('idle');
      onNotify(
        'PDF rendering hit a browser restriction — try Download Printable HTML or Copy Markdown',
        'error'
      );
    }
  };

  /** Secondary option: Self-contained standalone printable .html file */
  const handleDownloadPrintableHtml = async () => {
    if (!guide || htmlExporting) return;
    setHtmlExporting(true);
    try {
      const inlinedImages = await inlineGuideImages(guide, {
        showVideoFrames,
        showWebImages,
      });
      const html = buildStandalonePrintableHtml(guide, {
        theme,
        showVideoFrames,
        showWebImages,
        showDiagrams,
        showInsights,
        inlinedImages,
      });
      const filename = buildSafeExportFilename(guide.title, language, 'html');
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const downloaded = triggerBlobDownload(blob, filename);
      if (!downloaded) {
        onNotify(
          'Preview sandbox may block downloads — open app in a new tab or use Copy Markdown',
          'error'
        );
      } else if (inIframe) {
        onNotify(
          `Saved ${filename} — open in any browser tab for 1-click PDF print (if preview blocks downloads, open app in a new tab)`,
          'info'
        );
      } else {
        onNotify(`Saved printable HTML: ${filename}`, 'success');
      }
    } catch {
      onNotify('Could not export HTML right now — use Copy Markdown instead', 'error');
    } finally {
      setHtmlExporting(false);
    }
  };

  /** Secondary option: Native browser print / vector PDF */
  const handlePrintPdf = () => {
    if (!guide) return;
    document.body.classList.add('mindflow-printing-pdf');
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      document.body.classList.remove('mindflow-printing-pdf');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);

    if (inIframe) {
      onNotify(
        'Preview sandbox may block print — use Download PDF, Download HTML, or open app in a new tab',
        'info'
      );
    } else {
      onNotify('Opening print preview — select "Save as PDF"', 'info');
    }

    window.setTimeout(() => {
      try {
        window.print();
      } catch {
        onNotify('Print blocked in sandbox — use Download PDF or Download HTML', 'error');
      }
      window.setTimeout(cleanup, 1500);
    }, 120);
  };

  return (
    <div
      data-mindflow-pdf-modal="true"
      data-testid="visual-pdf-studio-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="visual-pdf-studio-title"
      className="fixed inset-0 z-50 flex flex-col bg-[#050814]/94 backdrop-blur-md"
    >
      {/* Top Studio Toolbar (hidden during print) */}
      <div
        data-mindflow-print-hide="true"
        className="shrink-0 border-b border-white/10 bg-[#090e1f]/96 px-3 sm:px-5 lg:px-6 py-2.5 sm:py-3 space-y-2.5"
      >
        {/* Row 1: Brand Title + Primary Actions + Close */}
        <div className="max-w-[1380px] mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <span className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 via-indigo-500 to-cyan-500 shadow-sm shadow-violet-950/40">
              <BookOpen className="w-4 h-4 text-white" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2
                id="visual-pdf-studio-title"
                className="font-display text-sm sm:text-base font-bold text-white leading-tight whitespace-nowrap"
              >
                <span className="sm:hidden">PDF Studio</span>
                <span className="hidden sm:inline">Visual PDF Studio</span>
              </h2>
              <p className="text-[11px] sm:text-xs text-slate-400 truncate leading-snug">
                <span className="sm:hidden">
                  <span className="text-slate-300 font-medium">
                    {language === 'hi' ? 'हिंदी' : language === 'hinglish' ? 'Hinglish' : 'EN'}
                  </span>
                  {guide && <span> · {guide.chapters.length} Ch</span>}
                </span>
                <span className="hidden sm:inline">
                  <span className="text-slate-300 font-medium">{langBadge}</span>
                  {guide && <span> · {guide.chapters.length} Chapters</span>}
                </span>
                <span className="hidden md:inline"> · Live magazine preview &amp; multi-page A4 export</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Desktop Secondary Export Actions */}
            <div className="hidden lg:flex items-center gap-1.5">
              <button
                type="button"
                onClick={onGenerateLongGuide}
                disabled={isLoading || pdfStatus === 'rendering'}
                data-testid="generate-long-ai-pdf-btn"
                title="Use AI to expand this video into a comprehensive 6–8 chapter long-form visual PDF"
                className="inline-flex items-center gap-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-violet-400/35 px-3 py-2 min-h-[38px] text-xs font-semibold text-violet-200 transition-colors cursor-pointer disabled:opacity-45"
              >
                <Sparkles className="w-3.5 h-3.5 text-cyan-300" aria-hidden="true" />
                <span>AI Long PDF</span>
              </button>

              <button
                type="button"
                onClick={handleCopyNotionMarkdown}
                disabled={!guide || isLoading}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/12 px-3 py-2 min-h-[38px] text-xs font-semibold text-slate-100 transition-colors cursor-pointer disabled:opacity-45"
              >
                {copiedNotion ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                    <span className="text-emerald-300">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-violet-300" aria-hidden="true" />
                    <span className="hidden xl:inline">Copy Notion MD</span>
                    <span className="xl:hidden">Copy MD</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleDownloadPrintableHtml}
                disabled={!guide || isLoading || htmlExporting}
                data-testid="download-printable-html-btn"
                title="Download a self-contained HTML guide with embedded styles & 1-click browser PDF print"
                className="inline-flex items-center gap-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/12 px-3 py-2 min-h-[38px] text-xs font-semibold text-slate-100 transition-colors cursor-pointer disabled:opacity-45"
              >
                {htmlExporting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-300" aria-hidden="true" />
                ) : (
                  <FileCode className="w-3.5 h-3.5 text-cyan-300" aria-hidden="true" />
                )}
                <span className="hidden xl:inline">Printable HTML</span>
                <span className="xl:hidden">HTML</span>
              </button>

              <button
                type="button"
                onClick={handlePrintPdf}
                disabled={!guide || isLoading}
                data-testid="print-vector-pdf-btn"
                title="Open native browser print dialog for vector PDF"
                className="inline-flex items-center gap-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/12 px-3 py-2 min-h-[38px] text-xs font-semibold text-slate-100 transition-colors cursor-pointer disabled:opacity-45"
              >
                <Printer className="w-3.5 h-3.5 text-slate-300" aria-hidden="true" />
                <span>Print</span>
              </button>
            </div>

            {/* Primary: Direct Real Multi-Page A4 .pdf File Generator (Always visible) */}
            <button
              type="button"
              onClick={handleDownloadDirectPdf}
              disabled={!guide || isLoading || pdfStatus === 'rendering'}
              data-testid="download-visual-pdf-btn"
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-600 hover:from-violet-500 hover:to-cyan-500 px-3 sm:px-3.5 py-2 min-h-[38px] sm:min-h-[40px] text-xs font-semibold text-white transition-all cursor-pointer disabled:opacity-55 active:scale-[0.98] whitespace-nowrap"
            >
              {pdfStatus === 'rendering' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  <span>{pdfProgressText}</span>
                </>
              ) : pdfStatus === 'saved' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-200" aria-hidden="true" />
                  <span>Saved!</span>
                </>
              ) : (
                <>
                  <FileDown className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Download PDF</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close Visual PDF Studio"
              className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl bg-white/[0.06] hover:bg-white/[0.14] border border-white/10 text-slate-300 hover:text-white cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Mobile/Tablet Compact Row 2: All 3 Themes Visible + Options Drawer Toggle */}
        <div className="lg:hidden flex items-center justify-between gap-1.5 pt-2 border-t border-white/[0.07]">
          <div className="flex items-center gap-1 min-w-0" role="group" aria-label="PDF visual theme">
            {(['obsidian', 'warm', 'blueprint'] as VisualGuideTheme[]).map((themeKey) => {
              const cfg = THEME_CONFIG[themeKey];
              const shortLabel =
                themeKey === 'obsidian' ? 'Obsidian' : themeKey === 'warm' ? 'Warm' : 'Blueprint';
              const active = theme === themeKey;
              return (
                <button
                  key={themeKey}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setTheme(themeKey)}
                  className={`inline-flex items-center gap-1 sm:gap-1.5 rounded-lg border px-2 sm:px-2.5 py-1.5 min-h-[36px] text-[11px] sm:text-xs font-semibold transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
                    active
                      ? 'bg-violet-500/24 border-violet-400/50 text-white'
                      : 'bg-white/[0.04] border-white/10 text-slate-300 hover:text-white'
                  }`}
                >
                  <span
                    className={`h-2 w-2 sm:h-2.5 sm:w-2.5 rounded-full border shrink-0 ${cfg.swatch}`}
                    aria-hidden="true"
                  />
                  <span>{shortLabel}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleCopyNotionMarkdown}
              disabled={!guide || isLoading}
              aria-label="Copy Notion Markdown"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.12] border border-white/10 px-2.5 py-1.5 min-h-[36px] text-xs font-semibold text-slate-200 cursor-pointer disabled:opacity-45"
            >
              {copiedNotion ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-violet-300" aria-hidden="true" />
              )}
              <span>{copiedNotion ? 'Copied' : 'Copy MD'}</span>
            </button>

            <button
              type="button"
              data-testid="pdf-mobile-options-toggle"
              aria-expanded={mobileOptionsOpen}
              onClick={() => setMobileOptionsOpen((v) => !v)}
              className={`inline-flex items-center gap-1 sm:gap-1.5 rounded-lg border px-2.5 py-1.5 min-h-[36px] text-[11px] sm:text-xs font-semibold transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
                mobileOptionsOpen
                  ? 'bg-cyan-500/20 border-cyan-400/45 text-cyan-100'
                  : 'bg-white/[0.05] hover:bg-white/[0.12] border-white/10 text-slate-200'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Options</span>
            </button>
          </div>
        </div>

        {/* Mobile/Tablet Expandable Display & Export Options Panel */}
        {mobileOptionsOpen && (
          <div
            data-testid="pdf-mobile-options-panel"
            className="lg:hidden rounded-2xl bg-[#070b18] border border-white/12 p-3.5 space-y-3.5 mf-animate-fade"
          >
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Display Elements
              </p>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Toggle PDF elements">
                {[
                  {
                    id: 'frames',
                    label: 'Video Frames',
                    icon: Tv,
                    checked: showVideoFrames,
                    toggle: () => setShowVideoFrames((v) => !v),
                  },
                  {
                    id: 'web',
                    label: 'Web Images',
                    icon: ImageIcon,
                    checked: showWebImages,
                    toggle: () => setShowWebImages((v) => !v),
                  },
                  {
                    id: 'diagrams',
                    label: 'AI Diagrams',
                    icon: Layers,
                    checked: showDiagrams,
                    toggle: () => setShowDiagrams((v) => !v),
                  },
                  {
                    id: 'insights',
                    label: 'Bonus Insights',
                    icon: Lightbulb,
                    checked: showInsights,
                    toggle: () => setShowInsights((v) => !v),
                  },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="switch"
                      aria-checked={item.checked}
                      onClick={item.toggle}
                      className={`inline-flex items-center justify-between gap-2 rounded-xl border px-3 py-2 min-h-[40px] text-xs font-medium transition-colors cursor-pointer ${
                        item.checked
                          ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-100'
                          : 'bg-white/[0.03] border-white/10 text-slate-400'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1.5 truncate">
                        <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate">{item.label}</span>
                      </span>
                      <span
                        className={`h-2 w-2 rounded-full shrink-0 ${
                          item.checked ? 'bg-emerald-400' : 'bg-slate-600'
                        }`}
                        aria-hidden="true"
                      />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-white/[0.08]">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                More Export Options
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setMobileOptionsOpen(false);
                    onGenerateLongGuide();
                  }}
                  disabled={isLoading || pdfStatus === 'rendering'}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-violet-500/15 hover:bg-violet-500/25 border border-violet-400/35 px-3 py-2 min-h-[40px] text-xs font-semibold text-violet-100 cursor-pointer disabled:opacity-45"
                >
                  <Sparkles className="w-3.5 h-3.5 text-cyan-300 shrink-0" aria-hidden="true" />
                  <span>AI Long PDF</span>
                </button>

                <button
                  type="button"
                  onClick={handleCopyNotionMarkdown}
                  disabled={!guide || isLoading}
                  className="sm:hidden inline-flex items-center justify-center gap-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/12 px-3 py-2 min-h-[40px] text-xs font-semibold text-slate-100 cursor-pointer disabled:opacity-45"
                >
                  {copiedNotion ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-violet-300 shrink-0" aria-hidden="true" />
                  )}
                  <span>{copiedNotion ? 'Copied!' : 'Copy MD'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadPrintableHtml}
                  disabled={!guide || isLoading || htmlExporting}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/12 px-3 py-2 min-h-[40px] text-xs font-semibold text-slate-100 cursor-pointer disabled:opacity-45"
                >
                  {htmlExporting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-300 shrink-0" aria-hidden="true" />
                  ) : (
                    <FileCode className="w-3.5 h-3.5 text-cyan-300 shrink-0" aria-hidden="true" />
                  )}
                  <span>Printable HTML</span>
                </button>

                <button
                  type="button"
                  onClick={handlePrintPdf}
                  disabled={!guide || isLoading}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/12 px-3 py-2 min-h-[40px] text-xs font-semibold text-slate-100 cursor-pointer disabled:opacity-45"
                >
                  <Printer className="w-3.5 h-3.5 text-slate-300 shrink-0" aria-hidden="true" />
                  <span>Print / Vector</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Desktop Row 2: Theme Switcher & Visual Element Toggles */}
        <div className="hidden lg:flex max-w-[1380px] mx-auto flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/[0.07]">
          {/* 3 Anti-Boring Design Themes */}
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="PDF visual theme">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 mr-1">
              <Palette className="w-3.5 h-3.5 text-cyan-300" aria-hidden="true" />
              <span>Theme:</span>
            </span>
            {(['obsidian', 'warm', 'blueprint'] as VisualGuideTheme[]).map((themeKey) => {
              const cfg = THEME_CONFIG[themeKey];
              const active = theme === themeKey;
              return (
                <button
                  key={themeKey}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setTheme(themeKey)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                    active
                      ? 'bg-violet-500/24 border-violet-400/50 text-white'
                      : 'bg-white/[0.04] border-white/10 text-slate-300 hover:text-white hover:bg-white/[0.08]'
                  }`}
                >
                  <span
                    className={`h-2.5 w-2.5 rounded-full border ${cfg.swatch}`}
                    aria-hidden="true"
                  />
                  <span>{cfg.label}</span>
                </button>
              );
            })}
          </div>

          {/* Toggleable Visual Elements */}
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Toggle PDF elements">
            {[
              {
                id: 'frames',
                label: 'Video Frames',
                icon: Tv,
                checked: showVideoFrames,
                toggle: () => setShowVideoFrames((v) => !v),
              },
              {
                id: 'web',
                label: 'Web Images',
                icon: ImageIcon,
                checked: showWebImages,
                toggle: () => setShowWebImages((v) => !v),
              },
              {
                id: 'diagrams',
                label: 'AI Diagrams',
                icon: Layers,
                checked: showDiagrams,
                toggle: () => setShowDiagrams((v) => !v),
              },
              {
                id: 'insights',
                label: 'Bonus Insights',
                icon: Lightbulb,
                checked: showInsights,
                toggle: () => setShowInsights((v) => !v),
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="switch"
                  aria-checked={item.checked}
                  onClick={item.toggle}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                    item.checked
                      ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-200'
                      : 'bg-white/[0.03] border-white/10 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{item.label}</span>
                  <span
                    className={`ml-0.5 inline-block h-1.5 w-1.5 rounded-full ${
                      item.checked ? 'bg-emerald-400' : 'bg-slate-600'
                    }`}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Live Scrollable Magazine Document Preview */}
      <div
        data-mindflow-pdf-scroll="true"
        className="flex-1 overflow-y-auto glass-scroll px-3 sm:px-6 py-6"
      >
        {isLoading ? (
          <div className="max-w-3xl mx-auto rounded-3xl bg-[#0b1024]/90 border border-cyan-400/25 p-12 text-center space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-400 shadow-[0_0_32px_rgba(34,211,238,0.4)]">
              <Loader2 className="w-7 h-7 text-white animate-spin" aria-hidden="true" />
            </div>
            <h3 className="font-display text-lg font-bold text-white">
              Crafting your Long-Form Visual PDF Study Guide...
            </h3>
            <p className="text-xs sm:text-sm text-slate-300 max-w-md mx-auto leading-relaxed">
              Designing 6–8 deep visual chapters, custom vector diagrams, bonus memory tricks, and a complete rapid-recall sheet in {langBadge}.
            </p>
          </div>
        ) : error && !guide ? (
          <div className="max-w-xl mx-auto rounded-3xl bg-[#0b1024]/90 border border-rose-400/35 p-8 text-center space-y-4">
            <p className="text-sm font-semibold text-rose-200">{error}</p>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Retry Visual Guide</span>
            </button>
          </div>
        ) : guide ? (
          <article
            ref={documentRef}
            data-mindflow-pdf-document="true"
            data-testid="visual-pdf-document"
            className={`pdf-guide-font max-w-[900px] mx-auto rounded-3xl border shadow-[0_28px_80px_-20px_rgba(0,0,0,0.85)] overflow-hidden transition-colors duration-300 ${t.pageBg} ${t.cardBorder}`}
          >
            {/* ==================== HERO MAGAZINE COVER ==================== */}
            <header
              data-pdf-block="true"
              className={`p-6 sm:p-9 border-b ${t.heroBg} ${t.cardBorder} pdf-avoid-break`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs mb-4">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold tracking-wide ${t.categoryBadge}`}>
                    <Sparkles className="w-3 h-3" aria-hidden="true" />
                    <span>{guide.category}</span>
                  </span>
                  <span className={`inline-flex items-center gap-1 font-medium ${t.mutedColor}`}>
                    <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{guide.estimatedReadTime} read</span>
                  </span>
                </div>
                <span className={`font-semibold text-[11px] ${t.mutedColor}`}>
                  MindFlow AI · Visual Study Edition
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
                <div className={showVideoFrames && guide.coverFrameUrl ? 'md:col-span-7' : 'md:col-span-12'}>
                  <h1 className={`font-display text-2xl sm:text-3xl font-extrabold leading-tight tracking-tight ${t.titleColor}`}>
                    {guide.title}
                  </h1>
                  <p className={`mt-2.5 text-sm leading-relaxed ${t.bodyColor}`}>
                    {guide.subtitle}
                  </p>
                  <p className={`mt-2 text-xs font-medium ${t.mutedColor}`}>
                    Source: {guide.channel}
                  </p>
                </div>

                {showVideoFrames && guide.coverFrameUrl && (
                  <div className="md:col-span-5">
                    <SafePreviewImage
                      src={guide.coverFrameUrl}
                      alt={`${guide.title} cover frame`}
                      frameClass={t.mediaFrameBg}
                      mutedClass={t.mutedColor}
                    />
                  </div>
                )}
              </div>

              {/* 3-Bullet "Skip the Video" Hero Box */}
              {guide.heroTakeaways.length > 0 && (
                <div className={`mt-6 rounded-2xl border p-4 sm:p-5 ${t.takeawayBg} ${t.takeawayBorder}`}>
                  <p className={`text-xs font-bold uppercase tracking-wider mb-3 ${t.insightTitle}`}>
                    Skip the Video — {guide.heroTakeaways.length} Core Takeaways
                  </p>
                  <ol className="space-y-2">
                    {guide.heroTakeaways.map((point, idx) => (
                      <li key={idx} className={`flex items-start gap-2.5 text-[13.5px] leading-relaxed ${t.bodyColor}`}>
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-[11px] font-bold text-white">
                          {idx + 1}
                        </span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </header>

            {/* ==================== VISUAL TOPIC CHAPTERS ==================== */}
            <div className="p-6 sm:p-9 space-y-7">
              {sanitizedChapters.map((chapter, idx) => {
                const badgeClass =
                  ACCENT_BADGE[chapter.accent]?.[theme] ?? ACCENT_BADGE.cyan[theme];
                const hasVideoImg = Boolean(showVideoFrames && chapter.videoFrameUrl);
                const hasWebImg = Boolean(showWebImages && chapter.webImageUrl);
                const showMediaGrid = hasVideoImg || hasWebImg;

                return (
                  <section
                    key={chapter.id}
                    data-pdf-block="true"
                    className={`rounded-2xl border p-5 sm:p-6 space-y-4 pdf-avoid-break ${t.cardBg} ${t.cardBorder}`}
                  >
                    {/* Chapter Header */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-current/10">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="font-mono text-xs font-bold opacity-55">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <h2 className={`font-display text-lg font-bold leading-snug ${t.titleColor}`}>
                          {chapter.heading}
                        </h2>
                      </div>
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold ${badgeClass}`}
                      >
                        ▶ {chapter.timestamp}
                      </span>
                    </div>

                    {/* Micro-Paragraph Video Explanation */}
                    <div className="space-y-2.5">
                      {chapter.videoExplanation.map((paragraph, pIdx) => (
                        <p
                          key={pIdx}
                          className={`text-[14px] leading-[1.7] ${t.bodyColor}`}
                        >
                          {paragraph}
                        </p>
                      ))}
                    </div>

                    {/* Highlighted Key Terms */}
                    {chapter.keyTerms.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {chapter.keyTerms.map((term) => (
                          <span
                            key={term}
                            className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-[11.5px] font-semibold ${t.termBg} ${t.termText}`}
                          >
                            {term}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Sanitized AI Conceptual SVG Diagram */}
                    {showDiagrams && chapter.safeSvg && (
                      <div
                        className={`rounded-xl border p-2.5 overflow-hidden ${t.diagramFrameBg}`}
                      >
                        <div
                          className="w-full [&>svg]:w-full [&>svg]:h-auto [&>svg]:block"
                          dangerouslySetInnerHTML={{ __html: chapter.safeSvg }}
                        />
                      </div>
                    )}

                    {/* Video Frame + Wikipedia Reference Image Row */}
                    {showMediaGrid && (
                      <div
                        className={`grid gap-3 ${
                          hasVideoImg && hasWebImg ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'
                        }`}
                      >
                        {hasVideoImg && chapter.videoFrameUrl && (
                          <SafePreviewImage
                            src={chapter.videoFrameUrl}
                            alt={`Video snapshot for ${chapter.heading}`}
                            caption={`Video moment · ${chapter.timestamp}`}
                            frameClass={t.mediaFrameBg}
                            mutedClass={t.mutedColor}
                          />
                        )}
                        {hasWebImg && chapter.webImageUrl && (
                          <SafePreviewImage
                            src={chapter.webImageUrl}
                            alt={chapter.webImageCaption || chapter.webImageQuery}
                            caption={chapter.webImageCaption || `Reference: ${chapter.webImageQuery}`}
                            frameClass={t.mediaFrameBg}
                            mutedClass={t.mutedColor}
                          />
                        )}
                      </div>
                    )}

                    {/* Practical Example Callout */}
                    {chapter.practicalExample && (
                      <div className={`rounded-xl border p-3.5 ${t.exampleBg}`}>
                        <p className={`text-[11px] font-bold uppercase tracking-wide mb-1 ${t.titleColor}`}>
                          Practical Example
                        </p>
                        <p className={`text-[13.5px] leading-relaxed ${t.bodyColor}`}>
                          {chapter.practicalExample}
                        </p>
                      </div>
                    )}

                    {/* Bonus AI Insight / Memory Trick Callout */}
                    {showInsights && chapter.extraAiInsight && (
                      <div
                        className={`rounded-xl border p-4 ${t.insightBg} ${t.insightBorder}`}
                      >
                        <div className={`flex items-center gap-1.5 text-xs font-bold mb-1 ${t.insightTitle}`}>
                          <Lightbulb className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>{chapter.insightLabel || 'Key Insight'}</span>
                        </div>
                        <p className={`text-[13.5px] leading-relaxed ${t.insightText}`}>
                          {chapter.extraAiInsight}
                        </p>
                      </div>
                    )}

                    {/* Chapter Revision Takeaway */}
                    {chapter.chapterSummary && (
                      <p className={`pt-2.5 border-t text-[13px] leading-relaxed ${t.summaryBorder} ${t.bodyColor}`}>
                        <strong className={`font-semibold ${t.titleColor}`}>
                          Revision Takeaway:{' '}
                        </strong>
                        {chapter.chapterSummary}
                      </p>
                    )}
                  </section>
                );
              })}

              {/* ==================== FINAL PAGE: QUICK RECALL SHEET ==================== */}
              <section
                data-pdf-block="true"
                className={`rounded-2xl border p-5 sm:p-7 space-y-6 pdf-page-break-before pdf-avoid-break ${t.cardBg} ${t.cardBorder}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-current/10">
                  <div>
                    <p className={`text-[11px] font-bold uppercase tracking-wider ${t.insightTitle}`}>
                      Final Page · One-Glance Cheat Card
                    </p>
                    <h2 className={`font-display text-xl font-extrabold mt-0.5 ${t.titleColor}`}>
                      Quick Recall Sheet &amp; Rapid Revision
                    </h2>
                  </div>
                  <span className={`text-xs font-semibold ${t.mutedColor}`}>
                    {guide.quickRecall.terms.length} Key Terms · {guide.quickRecall.checklist.length} Checks
                  </span>
                </div>

                {/* Key Terms & Formulas Table */}
                {guide.quickRecall.terms.length > 0 && (
                  <div className={`overflow-x-auto rounded-xl border ${t.tableRowBorder}`}>
                    <table className="w-full text-left border-collapse text-xs sm:text-[13px]">
                      <thead>
                        <tr className={t.tableHeaderBg}>
                          <th className="py-2.5 px-3.5 font-bold">Key Term / Formula</th>
                          <th className="py-2.5 px-3.5 font-bold">Core Definition</th>
                          <th className="py-2.5 px-3.5 font-bold">Quick Memory Note</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${t.tableDivider}`}>
                        {guide.quickRecall.terms.map((item) => (
                          <tr key={item.term}>
                            <td className={`py-2.5 px-3.5 font-bold whitespace-nowrap ${t.titleColor}`}>
                              {item.term}
                            </td>
                            <td className={`py-2.5 px-3.5 ${t.bodyColor}`}>
                              {item.definition}
                            </td>
                            <td className={`py-2.5 px-3.5 ${t.mutedColor}`}>
                              {item.note}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* 5-Point Rapid Revision Checklist */}
                {guide.quickRecall.checklist.length > 0 && (
                  <div className={`rounded-xl border p-4 sm:p-5 space-y-2.5 ${t.checkBg}`}>
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-500">
                      <CheckSquare className="w-4 h-4" aria-hidden="true" />
                      <span>{guide.quickRecall.checklist.length}-Point Rapid Revision Checklist</span>
                    </div>
                    <ul className="space-y-2">
                      {guide.quickRecall.checklist.map((item, idx) => (
                        <li
                          key={idx}
                          className={`flex items-start gap-2.5 text-[13.5px] leading-relaxed ${t.bodyColor}`}
                        >
                          <span
                            aria-hidden="true"
                            className="mt-1 h-4 w-4 shrink-0 rounded border border-emerald-500/60"
                          />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <footer className={`pt-2 flex items-center justify-between text-[11px] ${t.mutedColor}`}>
                  <span>Generated by MindFlow AI · Smart Visual PDF Studio</span>
                  <span>{guide.category} · {langBadge}</span>
                </footer>
              </section>
            </div>
          </article>
        ) : null}
      </div>
    </div>
  );
}
