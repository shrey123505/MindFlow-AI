import { jsPDF } from 'jspdf';
import { getFontEmbedCSS, toCanvas } from 'html-to-image';
import type {
  LanguageCode,
  LectureWorkspace,
  VisualGuideData,
  VisualGuideTheme,
} from '../types/mindflow';
import { adaptSvgDiagramToTheme, sanitizeSvgDiagram } from './visualGuide';

export const THEME_BG_HEX: Record<VisualGuideTheme, string> = {
  obsidian: '#0F172A',
  warm: '#FAF8F5',
  blueprint: '#F1F5F9',
};

const THEME_FOOTER_HEX: Record<VisualGuideTheme, string> = {
  obsidian: '#94A3B8',
  warm: '#78716C',
  blueprint: '#64748B',
};

const LANG_FILE_TAG: Record<LanguageCode, string> = {
  en: 'EN',
  hi: 'HI',
  hinglish: 'Hinglish',
};

/** Detects whether the app is running inside a sandboxed iframe (e.g. AI Studio Preview). */
export function isRunningInIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/** Builds a clean, cross-platform safe export filename such as MindFlow-DSA-Guide-EN.pdf */
export function buildSafeExportFilename(
  title: string,
  language: LanguageCode,
  ext: 'pdf' | 'html' | 'md' | 'json' | 'txt' | 'png'
): string {
  const cleaned = title
    .replace(/[^a-zA-Z0-9\s-]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 48)
    .replace(/^-|-$/g, '');
  const base = cleaned || 'Study-Guide';
  const langTag = LANG_FILE_TAG[language] ?? 'EN';
  return `MindFlow-${base}-${langTag}.${ext}`;
}

/** Strict HTML entity escaping for safe standalone HTML export. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Triggers a direct Blob download via a temporary anchor element.
 * Delays URL.revokeObjectURL so mobile browsers & iframe sandboxes finish reading the Blob.
 */
export function triggerBlobDownload(blob: Blob, filename: string): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    return false;
  }
  try {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener noreferrer';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignore cleanup errors
      }
    }, 5000);
    return true;
  } catch {
    return false;
  }
}

/** Safe clipboard write with textarea fallback for iframe/mobile contexts. */
export async function copyTextWithFallback(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand fallback
    }
  }
  if (typeof document === 'undefined') return false;
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export interface PdfBlockPlacement {
  pageIndex: number;
  yMm: number;
  heightMm: number;
  /** Non-zero when a single tall block had to be sliced across multiple pages */
  sliceStartRatio: number;
  sliceEndRatio: number;
}

/**
 * Pure pagination planner for multi-page A4 PDF assembly.
 * Prevents cutting normal cards across pages; slices extra-tall blocks cleanly.
 */
export function planA4BlockPlacements(
  blockHeightsMm: number[],
  usableHeightMm: number,
  gapMm = 4.5
): { placements: PdfBlockPlacement[]; pageCount: number } {
  const placements: PdfBlockPlacement[] = [];
  let pageIndex = 0;
  let cursorY = 0;

  for (const rawHeight of blockHeightsMm) {
    const heightMm = Math.max(1, rawHeight);

    if (heightMm <= usableHeightMm) {
      if (cursorY > 0 && cursorY + gapMm + heightMm > usableHeightMm) {
        pageIndex += 1;
        cursorY = 0;
      } else if (cursorY > 0) {
        cursorY += gapMm;
      }

      placements.push({
        pageIndex,
        yMm: cursorY,
        heightMm,
        sliceStartRatio: 0,
        sliceEndRatio: 1,
      });
      cursorY += heightMm;
      continue;
    }

    // Extra-tall block (> 1 full page): start on fresh page if current page is already used
    if (cursorY > 0) {
      pageIndex += 1;
      cursorY = 0;
    }

    let consumedMm = 0;
    while (consumedMm < heightMm - 0.1) {
      const sliceMm = Math.min(usableHeightMm, heightMm - consumedMm);
      const startRatio = consumedMm / heightMm;
      const endRatio = Math.min(1, (consumedMm + sliceMm) / heightMm);
      placements.push({
        pageIndex,
        yMm: 0,
        heightMm: sliceMm,
        sliceStartRatio: startRatio,
        sliceEndRatio: endRatio,
      });
      consumedMm += sliceMm;
      if (consumedMm < heightMm - 0.1) {
        pageIndex += 1;
      } else {
        cursorY = sliceMm;
      }
    }
  }

  return {
    placements,
    pageCount: Math.max(1, pageIndex + 1),
  };
}

async function waitForImagesInContainer(container: HTMLElement): Promise<void> {
  const imgs = Array.from(container.querySelectorAll('img'));
  await Promise.all(
    imgs.map((img) => {
      if (img.complete) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 2500);
        const done = () => {
          window.clearTimeout(timer);
          resolve();
        };
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      });
    })
  );
}

function paintPdfPageBackground(pdf: jsPDF, bgHex: string, widthMm: number, heightMm: number) {
  pdf.setFillColor(bgHex);
  pdf.rect(0, 0, widthMm, heightMm, 'F');
}

function sliceCanvasRegion(
  source: HTMLCanvasElement,
  startRatio: number,
  endRatio: number
): HTMLCanvasElement {
  const sy = Math.floor(source.height * startRatio);
  const sh = Math.max(1, Math.ceil(source.height * (endRatio - startRatio)));
  const slice = document.createElement('canvas');
  slice.width = source.width;
  slice.height = sh;
  const ctx = slice.getContext('2d');
  if (ctx) {
    ctx.drawImage(source, 0, sy, source.width, sh, 0, 0, source.width, sh);
  }
  return slice;
}

export interface ExportVisualPdfOptions {
  container: HTMLElement;
  title: string;
  language: LanguageCode;
  theme: VisualGuideTheme;
  onProgress?: (label: string) => void;
}

let cachedFontEmbedCssPromise: Promise<string> | null = null;

function getCachedFontEmbedCss(container: HTMLElement): Promise<string> {
  if (!cachedFontEmbedCssPromise) {
    cachedFontEmbedCssPromise = getFontEmbedCSS(container).catch(() => '');
  }
  return cachedFontEmbedCssPromise;
}

/**
 * Captures each card/section of the Visual PDF Studio document at 2x retina pixelRatio
 * and assembles a clean, theme-faithful multi-page A4 .pdf file using jsPDF.
 */
export async function exportVisualGuideToPdf({
  container,
  title,
  language,
  theme,
  onProgress,
}: ExportVisualPdfOptions): Promise<{
  filename: string;
  pageCount: number;
  blob: Blob;
  downloaded: boolean;
}> {
  onProgress?.('Preparing fonts & visuals...');

  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Proceed even if font readiness rejects
    }
  }

  const [fontEmbedCSS] = await Promise.all([
    getCachedFontEmbedCss(container),
    waitForImagesInContainer(container),
  ]);

  const rawBlocks = Array.from(
    container.querySelectorAll<HTMLElement>('[data-pdf-block="true"]')
  );
  const blocks = rawBlocks.length > 0 ? rawBlocks : [container];

  const bgHex = THEME_BG_HEX[theme];
  const footerHex = THEME_FOOTER_HEX[theme];
  const pageWidthMm = 210;
  const pageHeightMm = 297;
  const marginX = 10;
  const marginTop = 10;
  const marginBottom = 13;
  const contentWidthMm = pageWidthMm - marginX * 2;
  const usableHeightMm = pageHeightMm - marginTop - marginBottom;

  const capturedCanvases: HTMLCanvasElement[] = [];

  for (let i = 0; i < blocks.length; i++) {
    onProgress?.(`Rendering section ${i + 1}/${blocks.length}...`);
    const block = blocks[i];
    const canvas = await toCanvas(block, {
      pixelRatio: 2,
      backgroundColor: bgHex,
      cacheBust: false,
      skipAutoScale: true,
      fontEmbedCSS,
      filter: (node) => {
        if (node instanceof HTMLImageElement) {
          return node.complete && node.naturalWidth > 0;
        }
        return true;
      },
    });
    capturedCanvases.push(canvas);
  }

  onProgress?.('Assembling A4 PDF...');

  const blockHeightsMm = capturedCanvases.map(
    (c) => (c.height / Math.max(1, c.width)) * contentWidthMm
  );
  const { placements, pageCount } = planA4BlockPlacements(
    blockHeightsMm,
    usableHeightMm,
    4.5
  );

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  paintPdfPageBackground(pdf, bgHex, pageWidthMm, pageHeightMm);
  let currentPdfPage = 0;

  // Map each placement back to its originating block index
  let blockCursor = 0;
  for (let pIdx = 0; pIdx < placements.length; pIdx++) {
    const place = placements[pIdx];
    while (place.pageIndex > currentPdfPage) {
      pdf.addPage('a4', 'portrait');
      currentPdfPage += 1;
      paintPdfPageBackground(pdf, bgHex, pageWidthMm, pageHeightMm);
    }

    const sourceCanvas = capturedCanvases[blockCursor];
    const isFullBlock = place.sliceStartRatio === 0 && place.sliceEndRatio === 1;
    const targetCanvas = isFullBlock
      ? sourceCanvas
      : sliceCanvasRegion(sourceCanvas, place.sliceStartRatio, place.sliceEndRatio);

    const dataUrl = targetCanvas.toDataURL('image/jpeg', 0.94);
    pdf.addImage(
      dataUrl,
      'JPEG',
      marginX,
      marginTop + place.yMm,
      contentWidthMm,
      place.heightMm,
      undefined,
      'FAST'
    );

    if (place.sliceEndRatio >= 0.999) {
      blockCursor += 1;
    }
  }

  // Paint crisp page footers on every page
  for (let p = 1; p <= pageCount; p++) {
    pdf.setPage(p);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.setTextColor(footerHex);
    pdf.text(
      `MindFlow AI · Visual Study Edition`,
      marginX,
      pageHeightMm - 5.5
    );
    pdf.text(
      `Page ${p} of ${pageCount}`,
      pageWidthMm - marginX,
      pageHeightMm - 5.5,
      { align: 'right' }
    );
  }

  const filename = buildSafeExportFilename(title, language, 'pdf');
  const blob = pdf.output('blob');
  const downloaded = triggerBlobDownload(blob, filename);

  return { filename, pageCount, blob, downloaded };
}

export interface StandaloneHtmlOptions {
  theme: VisualGuideTheme;
  showVideoFrames: boolean;
  showWebImages: boolean;
  showDiagrams: boolean;
  showInsights: boolean;
  inlinedImages?: Record<string, string>;
}

const STANDALONE_THEME_CSS: Record<
  VisualGuideTheme,
  {
    pageBg: string;
    cardBg: string;
    heroBg: string;
    border: string;
    title: string;
    body: string;
    muted: string;
    accentBg: string;
    accentText: string;
    insightBg: string;
    insightBorder: string;
    insightTitle: string;
    tableHead: string;
    checkBg: string;
    diagramBg: string;
  }
> = {
  obsidian: {
    pageBg: '#0F172A',
    cardBg: '#162038',
    heroBg: 'linear-gradient(135deg, #171c3a 0%, #10192f 55%, #0d2236 100%)',
    border: 'rgba(148, 163, 184, 0.25)',
    title: '#FFFFFF',
    body: '#E2E8F0',
    muted: '#94A3B8',
    accentBg: 'rgba(139, 92, 246, 0.18)',
    accentText: '#DDD6FE',
    insightBg: 'linear-gradient(90deg, rgba(139,92,246,0.16), rgba(34,211,238,0.14))',
    insightBorder: 'rgba(34, 211, 238, 0.35)',
    insightTitle: '#67E8F9',
    tableHead: 'rgba(15, 23, 42, 0.75)',
    checkBg: 'rgba(16, 185, 129, 0.12)',
    diagramBg: '#0b1120',
  },
  warm: {
    pageBg: '#FAF8F5',
    cardBg: '#FFFDF9',
    heroBg: 'linear-gradient(135deg, #F3EFE6 0%, #FAF6EE 55%, #EEF5F1 100%)',
    border: '#E7E5E4',
    title: '#1C1917',
    body: '#44403C',
    muted: '#78716C',
    accentBg: '#ECFDF5',
    accentText: '#065F46',
    insightBg: '#FDF6E7',
    insightBorder: '#FCD34D',
    insightTitle: '#92400E',
    tableHead: '#F3EFE6',
    checkBg: '#ECFDF5',
    diagramBg: '#FAF6EE',
  },
  blueprint: {
    pageBg: '#F1F5F9',
    cardBg: '#FFFFFF',
    heroBg: 'linear-gradient(135deg, #E2E8F0 0%, #F1F5F9 55%, #E0F2FE 100%)',
    border: '#CBD5E1',
    title: '#020617',
    body: '#334155',
    muted: '#64748B',
    accentBg: '#EEF2FF',
    accentText: '#3730A3',
    insightBg: '#F8FAFC',
    insightBorder: '#A5B4FC',
    insightTitle: '#4338CA',
    tableHead: '#F1F5F9',
    checkBg: '#F0F9FF',
    diagramBg: '#F8FAFC',
  },
};

/** Best-effort image inlining so the downloaded printable HTML displays frames offline. */
export async function inlineGuideImages(
  guide: VisualGuideData,
  options: Pick<StandaloneHtmlOptions, 'showVideoFrames' | 'showWebImages'>
): Promise<Record<string, string>> {
  const urls = new Set<string>();
  if (options.showVideoFrames && guide.coverFrameUrl) {
    urls.add(guide.coverFrameUrl);
  }
  for (const ch of guide.chapters) {
    if (options.showVideoFrames && ch.videoFrameUrl) urls.add(ch.videoFrameUrl);
    if (options.showWebImages && ch.webImageUrl) urls.add(ch.webImageUrl);
  }

  const resolved: Record<string, string> = {};
  await Promise.all(
    Array.from(urls).map(async (url) => {
      try {
        const resp = await fetch(url);
        if (!resp.ok) return;
        const blob = await resp.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () =>
            typeof reader.result === 'string' ? resolve(reader.result) : reject();
          reader.onerror = () => reject();
          reader.readAsDataURL(blob);
        });
        if (dataUrl.startsWith('data:image/')) {
          resolved[url] = dataUrl;
        }
      } catch {
        // Keep graceful omission when offline/blocked
      }
    })
  );
  return resolved;
}

/**
 * Generates a self-contained printable HTML5 magazine guide with Google Fonts
 * (Inter + Noto Sans Devanagari), embedded theme CSS, sanitized SVG diagrams,
 * and a 1-click "Print / Save as PDF" toolbar for any browser.
 */
export function buildStandalonePrintableHtml(
  guide: VisualGuideData,
  options: StandaloneHtmlOptions
): string {
  const palette = STANDALONE_THEME_CSS[options.theme];
  const imgMap = options.inlinedImages ?? {};
  const resolveSrc = (url?: string) => (url ? imgMap[url] ?? '' : '');
  const langName =
    guide.language === 'hi'
      ? 'Hindi (हिंदी)'
      : guide.language === 'hinglish'
        ? 'Hinglish'
        : 'English';

  const coverImg = options.showVideoFrames ? resolveSrc(guide.coverFrameUrl) : '';

  const chaptersHtml = guide.chapters
    .map((ch, idx) => {
      const hasDiagram =
        options.showDiagrams &&
        typeof ch.svgDiagram === 'string' &&
        ch.svgDiagram.trim().length > 0;
      const safeSvg = hasDiagram
        ? adaptSvgDiagramToTheme(
            sanitizeSvgDiagram(ch.svgDiagram, ch.heading, ch.keyTerms),
            options.theme
          )
        : '';
      const vImg = options.showVideoFrames ? resolveSrc(ch.videoFrameUrl) : '';
      const wImg = options.showWebImages ? resolveSrc(ch.webImageUrl) : '';

      const mediaHtml =
        vImg || wImg
          ? `<div class="media-grid ${vImg && wImg ? 'two-col' : ''}">
              ${
                vImg
                  ? `<figure class="media-card"><img src="${escapeHtml(vImg)}" alt="${escapeHtml(ch.heading)}" /><figcaption>Video moment · ${escapeHtml(ch.timestamp)}</figcaption></figure>`
                  : ''
              }
              ${
                wImg
                  ? `<figure class="media-card"><img src="${escapeHtml(wImg)}" alt="${escapeHtml(ch.webImageCaption || ch.webImageQuery)}" /><figcaption>${escapeHtml(ch.webImageCaption || ch.webImageQuery)}</figcaption></figure>`
                  : ''
              }
            </div>`
          : '';

      const termsHtml =
        ch.keyTerms.length > 0
          ? `<div class="terms">${ch.keyTerms
              .map((term) => `<span class="term-chip">${escapeHtml(term)}</span>`)
              .join('')}</div>`
          : '';

      const exampleHtml = ch.practicalExample
        ? `<div class="example-box">
            <div class="example-label">Practical Example</div>
            <p>${escapeHtml(ch.practicalExample)}</p>
          </div>`
        : '';

      const insightHtml =
        options.showInsights && ch.extraAiInsight
          ? `<div class="insight-box">
              <div class="insight-label">💡 ${escapeHtml(ch.insightLabel || 'Key Insight')}</div>
              <p>${escapeHtml(ch.extraAiInsight)}</p>
            </div>`
          : '';

      const summaryHtml = ch.chapterSummary
        ? `<p class="chapter-summary"><strong>Revision Takeaway:</strong> ${escapeHtml(ch.chapterSummary)}</p>`
        : '';

      return `<section class="card avoid-break">
        <div class="chapter-head">
          <h2><span class="chapter-num">${String(idx + 1).padStart(2, '0')}</span> ${escapeHtml(ch.heading)}</h2>
          <span class="ts-badge">▶ ${escapeHtml(ch.timestamp)}</span>
        </div>
        <div class="paragraphs">
          ${ch.videoExplanation.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}
        </div>
        ${termsHtml}
        ${safeSvg ? `<div class="diagram-box">${safeSvg}</div>` : ''}
        ${mediaHtml}
        ${exampleHtml}
        ${insightHtml}
        ${summaryHtml}
      </section>`;
    })
    .join('\n');

  const termsRows = guide.quickRecall.terms
    .map(
      (item) => `<tr>
        <td><strong>${escapeHtml(item.term)}</strong></td>
        <td>${escapeHtml(item.definition)}</td>
        <td class="muted">${escapeHtml(item.note)}</td>
      </tr>`
    )
    .join('');

  const checklistHtml = guide.quickRecall.checklist
    .map((item) => `<li><span class="checkbox"></span><span>${escapeHtml(item)}</span></li>`)
    .join('');

  return `<!doctype html>
<html lang="${guide.language === 'hi' ? 'hi' : 'en'}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(guide.title)} — MindFlow AI Visual Guide</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px 16px 48px;
      background: ${palette.pageBg};
      color: ${palette.body};
      font-family: 'Inter', 'Noto Sans Devanagari', system-ui, -apple-system, sans-serif;
      line-height: 1.68;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .print-bar {
      max-width: 880px;
      margin: 0 auto 20px;
      padding: 12px 16px;
      border-radius: 14px;
      background: rgba(15, 23, 42, 0.92);
      color: #f8fafc;
      border: 1px solid rgba(56, 189, 248, 0.35);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .print-bar button {
      background: linear-gradient(90deg, #7c3aed, #06b6d4);
      color: #fff;
      border: 0;
      border-radius: 10px;
      padding: 9px 16px;
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
    }
    .sheet {
      max-width: 880px;
      margin: 0 auto;
      border-radius: 22px;
      overflow: hidden;
      border: 1px solid ${palette.border};
      background: ${palette.pageBg};
    }
    .hero {
      padding: 32px;
      background: ${palette.heroBg};
      border-bottom: 1px solid ${palette.border};
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      font-size: 12px;
      color: ${palette.muted};
      margin-bottom: 16px;
    }
    .hero-grid {
      display: grid;
      grid-template-columns: ${coverImg ? '1.35fr 0.85fr' : '1fr'};
      gap: 20px;
      align-items: center;
    }
    h1 {
      margin: 0;
      font-size: 28px;
      line-height: 1.25;
      color: ${palette.title};
      font-weight: 800;
    }
    .subtitle { margin: 10px 0 6px; font-size: 14.5px; color: ${palette.body}; }
    .channel { margin: 0; font-size: 12px; color: ${palette.muted}; font-weight: 600; }
    .hero-img { width: 100%; border-radius: 14px; border: 1px solid ${palette.border}; display: block; }
    .takeaways {
      margin-top: 22px;
      padding: 18px 20px;
      border-radius: 16px;
      background: ${palette.accentBg};
      border: 1px solid ${palette.border};
    }
    .takeaways h3 {
      margin: 0 0 10px;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: ${palette.insightTitle};
    }
    .takeaways ol { margin: 0; padding-left: 20px; }
    .takeaways li { margin-bottom: 6px; font-size: 13.5px; }
    .content { padding: 28px; display: flex; flex-direction: column; gap: 22px; }
    .card {
      background: ${palette.cardBg};
      border: 1px solid ${palette.border};
      border-radius: 18px;
      padding: 22px 24px;
    }
    .chapter-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding-bottom: 12px;
      margin-bottom: 14px;
      border-bottom: 1px solid ${palette.border};
    }
    .chapter-head h2 { margin: 0; font-size: 18px; color: ${palette.title}; }
    .chapter-num { font-family: ui-monospace, monospace; opacity: 0.55; margin-right: 6px; font-size: 13px; }
    .ts-badge {
      font-family: ui-monospace, monospace;
      font-size: 11.5px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 999px;
      background: ${palette.accentBg};
      color: ${palette.accentText};
      white-space: nowrap;
    }
    .paragraphs p { margin: 0 0 10px; font-size: 14px; }
    .terms { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }
    .term-chip {
      font-size: 11.5px;
      font-weight: 600;
      padding: 3px 10px;
      border-radius: 7px;
      background: ${palette.accentBg};
      color: ${palette.accentText};
      border: 1px solid ${palette.border};
    }
    .diagram-box {
      margin: 14px 0;
      padding: 10px;
      border-radius: 14px;
      background: ${palette.diagramBg};
      border: 1px solid ${palette.border};
    }
    .diagram-box svg { width: 100%; height: auto; display: block; }
    .media-grid { display: grid; gap: 12px; margin: 14px 0; }
    .media-grid.two-col { grid-template-columns: 1fr 1fr; }
    .media-card {
      margin: 0;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid ${palette.border};
    }
    .media-card img { width: 100%; height: 150px; object-fit: cover; display: block; }
    .media-card figcaption { padding: 6px 10px; font-size: 11px; color: ${palette.muted}; }
    .example-box {
      margin-top: 12px;
      padding: 12px 14px;
      border-radius: 12px;
      background: ${palette.checkBg};
      border: 1px solid ${palette.border};
    }
    .example-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: ${palette.title}; margin-bottom: 4px; }
    .example-box p { margin: 0; font-size: 13.5px; }
    .chapter-summary {
      margin: 12px 0 0;
      padding-top: 10px;
      border-top: 1px solid ${palette.border};
      font-size: 13px;
    }
    .insight-box {
      margin-top: 14px;
      padding: 14px 16px;
      border-radius: 13px;
      background: ${palette.insightBg};
      border: 1px solid ${palette.insightBorder};
    }
    .insight-label { font-size: 12px; font-weight: 700; color: ${palette.insightTitle}; margin-bottom: 5px; }
    .insight-box p { margin: 0; font-size: 13.5px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 10px; }
    th, td { padding: 10px 12px; border-bottom: 1px solid ${palette.border}; text-align: left; vertical-align: top; }
    th { background: ${palette.tableHead}; color: ${palette.title}; font-weight: 700; }
    .muted { color: ${palette.muted}; }
    .checklist {
      margin-top: 18px;
      padding: 16px 18px;
      border-radius: 14px;
      background: ${palette.checkBg};
      border: 1px solid ${palette.border};
    }
    .checklist ul { list-style: none; padding: 0; margin: 10px 0 0; }
    .checklist li { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 8px; font-size: 13.5px; }
    .checkbox { width: 15px; height: 15px; border: 1.5px solid #10b981; border-radius: 4px; flex-shrink: 0; margin-top: 4px; }
    .footer { margin-top: 16px; display: flex; justify-content: space-between; font-size: 11px; color: ${palette.muted}; }
    .avoid-break { break-inside: avoid; page-break-inside: avoid; }
    @media (max-width: 640px) {
      .hero-grid, .media-grid.two-col { grid-template-columns: 1fr; }
      .hero, .content { padding: 18px; }
    }
    @media print {
      @page { size: A4 portrait; margin: 10mm; }
      body { padding: 0; }
      .print-bar { display: none !important; }
      .sheet { border: none; border-radius: 0; max-width: 100%; }
    }
  </style>
</head>
<body>
  <div class="print-bar">
    <span><strong>MindFlow AI Visual Guide</strong> · Ready for crisp 1-click PDF saving</span>
    <button type="button" onclick="window.print()">Print / Save as PDF</button>
  </div>
  <article class="sheet">
    <header class="hero avoid-break">
      <div class="meta-row">
        <span><strong>${escapeHtml(guide.category)}</strong> · ⏱ ${escapeHtml(guide.estimatedReadTime)} read</span>
        <span>MindFlow AI · Visual Study Edition (${escapeHtml(langName)})</span>
      </div>
      <div class="hero-grid">
        <div>
          <h1>${escapeHtml(guide.title)}</h1>
          <p class="subtitle">${escapeHtml(guide.subtitle)}</p>
          <p class="channel">Source: ${escapeHtml(guide.channel)}</p>
        </div>
        ${coverImg ? `<img class="hero-img" src="${escapeHtml(coverImg)}" alt="${escapeHtml(guide.title)}" />` : ''}
      </div>
      <div class="takeaways">
        <h3>Skip the Video — Core Takeaways</h3>
        <ol>${guide.heroTakeaways.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ol>
      </div>
    </header>
    <div class="content">
      ${chaptersHtml}
      <section class="card avoid-break">
        <div class="chapter-head">
          <h2>Quick Recall Sheet &amp; Rapid Revision</h2>
          <span class="ts-badge">${guide.quickRecall.terms.length} Terms · ${guide.quickRecall.checklist.length} Checks</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Key Term / Formula</th>
              <th>Core Definition</th>
              <th>Quick Memory Note</th>
            </tr>
          </thead>
          <tbody>${termsRows}</tbody>
        </table>
        <div class="checklist">
          <strong>Rapid Revision Checklist</strong>
          <ul>${checklistHtml}</ul>
        </div>
        <div class="footer">
          <span>Generated by MindFlow AI · Smart Visual PDF Studio</span>
          <span>${escapeHtml(guide.category)} · ${escapeHtml(langName)}</span>
        </div>
      </section>
    </div>
  </article>
</body>
</html>`;
}

/**
 * Exports the interactive mindmap as a crisp high-res PNG.
 * Captures the live canvas if mounted, or renders a clean high-DPI fallback graphic
 * from workspace data when called from the Cheat Sheet or Script tabs.
 */
export async function exportMindmapPng(
  workspace: LectureWorkspace
): Promise<{ filename: string; downloaded: boolean }> {
  const filename = buildSafeExportFilename(workspace.title, workspace.language, 'png');
  const liveCanvas = document.querySelector<HTMLElement>(
    '[data-testid="desktop-mindmap-canvas"], [data-testid="mindmap-canvas"]'
  );

  if (liveCanvas && liveCanvas.offsetWidth > 120 && liveCanvas.offsetHeight > 120) {
    try {
      const rendered = await toCanvas(liveCanvas, {
        pixelRatio: 2,
        backgroundColor: '#070b18',
        cacheBust: false,
      });
      const blob = await new Promise<Blob | null>((resolve) =>
        rendered.toBlob((b) => resolve(b), 'image/png')
      );
      if (blob) {
        return { filename, downloaded: triggerBlobDownload(blob, filename) };
      }
    } catch {
      // Fall through to clean procedural canvas fallback
    }
  }

  // Offscreen crisp vector-style mindmap PNG fallback (works from ANY tab!)
  const width = 1400;
  const height = 840;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { filename, downloaded: false };

  ctx.fillStyle = '#070b18';
  ctx.fillRect(0, 0, width, height);

  // Subtle dot grid
  ctx.fillStyle = 'rgba(148, 163, 184, 0.16)';
  for (let x = 24; x < width; x += 28) {
    for (let y = 24; y < height; y += 28) {
      ctx.fillRect(x, y, 2, 2);
    }
  }

  // Header
  ctx.fillStyle = '#F8FAFC';
  ctx.font = '700 28px Inter, system-ui, sans-serif';
  ctx.fillText(workspace.title.slice(0, 68), 52, 68);
  ctx.fillStyle = '#94A3B8';
  ctx.font = '500 16px Inter, system-ui, sans-serif';
  ctx.fillText(
    `MindFlow AI · ${workspace.videoCategory} · ${workspace.channel}`,
    52,
    98
  );

  const root = workspace.nodes[0];
  const children = workspace.nodes.slice(1, 5);
  const rootCenter = { x: 700, y: 440 };
  const childCenters = [
    { x: 250, y: 260, color: '#8B5CF6' },
    { x: 1150, y: 260, color: '#22D3EE' },
    { x: 250, y: 620, color: '#10B981' },
    { x: 1150, y: 620, color: '#818CF8' },
  ];

  // Curved Bezier edges
  children.forEach((_child, idx) => {
    const pos = childCenters[idx];
    if (!pos) return;
    ctx.beginPath();
    ctx.moveTo(rootCenter.x, rootCenter.y);
    const midX = (rootCenter.x + pos.x) / 2;
    ctx.bezierCurveTo(midX, rootCenter.y, midX, pos.y, pos.x, pos.y);
    ctx.strokeStyle = pos.color;
    ctx.lineWidth = 3.5;
    ctx.stroke();
  });

  const drawBox = (
    cx: number,
    cy: number,
    w: number,
    h: number,
    border: string,
    titleText: string,
    subText: string
  ) => {
    const x = cx - w / 2;
    const y = cy - h / 2;
    ctx.fillStyle = '#111936';
    ctx.strokeStyle = border;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 18);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 18px Inter, system-ui, sans-serif';
    ctx.fillText(titleText.slice(0, 28), x + 20, y + 42);
    ctx.fillStyle = '#94A3B8';
    ctx.font = '500 14px Inter, system-ui, sans-serif';
    ctx.fillText(subText.slice(0, 34), x + 20, y + 70);
  };

  if (root) {
    drawBox(
      rootCenter.x,
      rootCenter.y,
      320,
      104,
      '#6366F1',
      root.title,
      `▶ ${root.timestampLabel} · Root Overview`
    );
  }

  children.forEach((child, idx) => {
    const pos = childCenters[idx];
    if (!pos) return;
    drawBox(
      pos.x,
      pos.y,
      310,
      98,
      pos.color,
      child.title,
      `▶ ${child.timestampLabel} · ${child.shortSubtitle}`
    );
  });

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png')
  );
  if (!blob) return { filename, downloaded: false };
  return { filename, downloaded: triggerBlobDownload(blob, filename) };
}
