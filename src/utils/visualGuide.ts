import type {
  LanguageCode,
  VisualGuideData,
  VisualGuideTheme,
} from '../types/mindflow';

export const ALLOWED_IMAGE_HOSTS = new Set([
  'i.ytimg.com',
  'img.youtube.com',
  'upload.wikimedia.org',
  'thumb.wikimedia.org',
]);

export function isAllowedRemoteImageUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    return ALLOWED_IMAGE_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function buildProxyImageUrl(rawUrl: string | undefined): string {
  if (!rawUrl) return '';
  if (rawUrl.startsWith('/api/image-proxy?')) return rawUrl;
  if (!isAllowedRemoteImageUrl(rawUrl)) return '';
  return `/api/image-proxy?url=${encodeURIComponent(rawUrl)}`;
}

export function buildYouTubeFrameUrl(
  videoId: string,
  frame: 'maxresdefault' | 'hqdefault' | '1' | '2' | '3'
): string {
  const safeId = videoId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16);
  if (!safeId) return '';
  return buildProxyImageUrl(`https://i.ytimg.com/vi/${safeId}/${frame}.jpg`);
}

export function buildVisualGuideCacheKey(
  videoId: string,
  language: LanguageCode
): string {
  return `mindflow_vguide_v3:${videoId}:${language}`;
}

function escapeXmlText(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildFallbackSvgDiagram(
  title: string,
  terms: string[] = []
): string {
  const safeTitle = escapeXmlText(title.slice(0, 40) || 'Concept Flow');
  const chips = (terms.length > 0 ? terms : ['Input', 'Core Logic', 'Output']).slice(0, 3);
  const boxColors = ['#6366f1', '#06b6d4', '#10b981'];

  const boxes = chips
    .map((term, i) => {
      const x = 36 + i * 186;
      const safeTerm = escapeXmlText(term.slice(0, 20));
      const arrow =
        i < chips.length - 1
          ? `<path d="M ${x + 156} 126 L ${x + 182} 126" stroke="#94a3b8" stroke-width="2.2" stroke-linecap="round"/><polygon points="${x + 186},126 ${x + 178},121 ${x + 178},131" fill="#94a3b8"/>`
          : '';
      return `
        <rect x="${x}" y="94" width="154" height="64" rx="14" fill="#111827" stroke="${boxColors[i]}" stroke-width="2"/>
        <text x="${x + 77}" y="121" text-anchor="middle" fill="#94a3b8" font-size="10" font-family="Inter, sans-serif">STEP 0${i + 1}</text>
        <text x="${x + 77}" y="140" text-anchor="middle" fill="#f8fafc" font-size="12.5" font-weight="600" font-family="Inter, sans-serif">${safeTerm}</text>
        ${arrow}
      `;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 220" width="100%" role="img" aria-label="${safeTitle}">
    <rect width="600" height="220" rx="16" fill="#0b1120"/>
    <rect x="14" y="14" width="572" height="192" rx="12" fill="none" stroke="#1e293b" stroke-width="1.5"/>
    <text x="300" y="54" text-anchor="middle" fill="#e2e8f0" font-size="15" font-weight="700" font-family="Inter, sans-serif">${safeTitle}</text>
    <text x="300" y="74" text-anchor="middle" fill="#94a3b8" font-size="11" font-family="Inter, sans-serif">Structured Conceptual Blueprint</text>
    ${boxes}
  </svg>`;
}

/**
 * Strictly sanitizes AI-generated inline SVG markup before rendering in the DOM.
 * Strips executable elements, event handlers, external references, and unsafe URI schemes.
 */
export function sanitizeSvgDiagram(
  rawSvg: string | undefined,
  fallbackTitle = 'Concept Diagram',
  fallbackTerms: string[] = []
): string {
  if (!rawSvg || typeof rawSvg !== 'string') {
    return buildFallbackSvgDiagram(fallbackTitle, fallbackTerms);
  }

  let cleaned = rawSvg.trim();
  const startIdx = cleaned.search(/<svg[\s>]/i);
  const endIdx = cleaned.toLowerCase().lastIndexOf('</svg>');
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return buildFallbackSvgDiagram(fallbackTitle, fallbackTerms);
  }

  cleaned = cleaned.slice(startIdx, endIdx + 6);

  // Strip dangerous block tags and their contents
  cleaned = cleaned.replace(
    /<(script|foreignObject|iframe|object|embed|style|link|meta|audio|video|animate|animateTransform|animateMotion|set|handler)[^>]*>[\s\S]*?<\/\1>/gi,
    ''
  );
  // Strip self-closing dangerous tags & external image/use/animation fetches
  cleaned = cleaned.replace(
    /<(script|foreignObject|iframe|object|embed|style|link|meta|image|use|feImage|animate|animateTransform|animateMotion|set|handler)[^>]*\/?>/gi,
    ''
  );

  // Strip inline event handlers (onload, onclick, onerror, etc.)
  cleaned = cleaned.replace(/[\s/]on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ' ');

  // Strip javascript:, vbscript:, external URLs, and data: URI schemes inside attributes
  cleaned = cleaned.replace(
    /(href|xlink:href|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
    (_match, attr: string, value: string) => {
      const inner =
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
          ? value.slice(1, -1).trim()
          : value.trim();
      if (/^#[A-Za-z0-9_-]+$/.test(inner)) {
        return `${attr}="${inner}"`;
      }
      return '';
    }
  );
  cleaned = cleaned.replace(/url\(\s*['"]?\s*(?:https?:|data:|javascript:|\/\/)[^)]*\)/gi, 'none');
  cleaned = cleaned.replace(/javascript\s*:/gi, '');
  cleaned = cleaned.replace(/vbscript\s*:/gi, '');
  cleaned = cleaned.replace(/data\s*:\s*text\/html/gi, '');

  // Strip invalid SVG attribute height="auto" / width="auto" (CSS handles responsive height)
  cleaned = cleaned.replace(/\s(height|width)\s*=\s*("auto"|'auto')/gi, '');

  // Enforce safe responsive sizing while preserving viewBox
  if (!/viewBox\s*=/i.test(cleaned)) {
    cleaned = cleaned.replace(/<svg/i, '<svg viewBox="0 0 600 220"');
  }

  // Verify basic structural validity after stripping
  if (!cleaned.toLowerCase().startsWith('<svg') || !cleaned.toLowerCase().endsWith('</svg>')) {
    return buildFallbackSvgDiagram(fallbackTitle, fallbackTerms);
  }

  return cleaned;
}

/**
 * Sanitizes an optional diagram: returns empty string when a chapter deliberately
 * omits a diagram (so purely narrative chapters don't get repetitive filler boxes).
 */
export function sanitizeOptionalSvgDiagram(
  rawSvg: string | undefined,
  includeDiagram: boolean,
  fallbackTitle = 'Concept Diagram',
  fallbackTerms: string[] = []
): string {
  if (!includeDiagram) return '';
  if (!rawSvg || !rawSvg.trim()) return '';
  return sanitizeSvgDiagram(rawSvg, fallbackTitle, fallbackTerms);
}

const LIGHT_SVG_PALETTES: Record<
  Exclude<VisualGuideTheme, 'obsidian'>,
  Record<string, string>
> = {
  warm: {
    // Dark canvas backgrounds -> warm editorial parchment
    '#0b1120': '#FAF6EE',
    '#0f172a': '#FAF6EE',
    '#060812': '#F6F1E6',
    '#070b18': '#F6F1E6',
    '#0a0f1f': '#F6F1E6',
    // Dark card/node surfaces -> crisp warm ivory
    '#111827': '#FFFFFF',
    '#162038': '#FFFFFF',
    '#1e293b': '#D6CFC2',
    '#1e1b4b': '#F3EFE6',
    '#172554': '#EEF2FF',
    '#083344': '#ECFDF5',
    '#064e3b': '#ECFDF5',
    '#334155': '#D6CFC2',
    // Light ink -> high-contrast warm charcoal & stone
    '#ffffff': '#1C1917',
    '#f8fafc': '#1C1917',
    '#f1f5f9': '#1C1917',
    '#e2e8f0': '#292524',
    '#cbd5e1': '#44403C',
    '#94a3b8': '#57534E',
    // Neon pastel strokes -> richer print-ready editorial tones
    '#22d3ee': '#0F766E',
    '#38bdf8': '#0369A1',
    '#67e8f9': '#0F766E',
    '#a78bfa': '#6D28D9',
    '#c4b5fd': '#6D28D9',
    '#818cf8': '#4338CA',
    '#34d399': '#047857',
    '#6ee7b7': '#047857',
  },
  blueprint: {
    // Dark canvas backgrounds -> clean technical blueprint paper
    '#0b1120': '#F8FAFC',
    '#0f172a': '#F8FAFC',
    '#060812': '#F1F5F9',
    '#070b18': '#F1F5F9',
    '#0a0f1f': '#F1F5F9',
    // Dark card/node surfaces -> pure white technical cards
    '#111827': '#FFFFFF',
    '#162038': '#FFFFFF',
    '#1e293b': '#CBD5E1',
    '#1e1b4b': '#EEF2FF',
    '#172554': '#EFF6FF',
    '#083344': '#F0F9FF',
    '#064e3b': '#ECFDF5',
    '#334155': '#CBD5E1',
    // Light ink -> crisp navy-slate ink
    '#ffffff': '#0F172A',
    '#f8fafc': '#0F172A',
    '#f1f5f9': '#0F172A',
    '#e2e8f0': '#1E293B',
    '#cbd5e1': '#334155',
    '#94a3b8': '#475569',
    // Neon pastel strokes -> crisp technical blueprint inks
    '#22d3ee': '#0284C7',
    '#38bdf8': '#0284C7',
    '#67e8f9': '#0369A1',
    '#a78bfa': '#4F46E5',
    '#c4b5fd': '#4F46E5',
    '#818cf8': '#4338CA',
    '#34d399': '#059669',
    '#6ee7b7': '#059669',
  },
};

/**
 * Harmonizes a sanitized dark-slate SVG diagram with the active Visual PDF Studio theme
 * (Obsidian, Warm Aesthetic, or Blueprint Pro) so light themes never show jarring pitch-black boxes.
 */
export function adaptSvgDiagramToTheme(
  sanitizedSvg: string,
  theme: VisualGuideTheme
): string {
  if (!sanitizedSvg || theme === 'obsidian') return sanitizedSvg;
  const palette = LIGHT_SVG_PALETTES[theme];
  return sanitizedSvg.replace(/#[0-9a-fA-F]{6}\b/g, (hex) => {
    const mapped = palette[hex.toLowerCase()];
    return mapped ?? hex;
  });
}

/**
 * Formats a Visual PDF Guide into rich Notion-ready Markdown with callout blocks,
 * timestamps, highlighted key terms, practical examples, bonus insights, and a revision checklist.
 */
export function formatVisualGuideAsNotionMarkdown(guide: VisualGuideData): string {
  const lines: string[] = [
    `# ${guide.title}`,
    `> **${guide.category}** · ${guide.channel} · ${guide.estimatedReadTime} read`,
    '',
    '## Skip the Video (TL;DW)',
    ...guide.heroTakeaways.map((item) => `- ${item}`),
    '',
    '---',
    '',
  ];

  guide.chapters.forEach((chapter, index) => {
    lines.push(`## ${String(index + 1).padStart(2, '0')}. ${chapter.heading} (\`${chapter.timestamp}\`)`);
    lines.push('');
    chapter.videoExplanation.forEach((para) => {
      lines.push(para);
      lines.push('');
    });
    if (chapter.practicalExample) {
      lines.push(`**Practical Example:** ${chapter.practicalExample}`);
      lines.push('');
    }
    if (chapter.keyTerms.length > 0) {
      lines.push(`**Key Terms:** ${chapter.keyTerms.map((t) => `\`${t}\``).join(' · ')}`);
      lines.push('');
    }
    if (chapter.chapterSummary) {
      lines.push(`**Revision Summary:** ${chapter.chapterSummary}`);
      lines.push('');
    }
    if (chapter.extraAiInsight) {
      lines.push(`> **${chapter.insightLabel || 'Supplementary Insight'}:** ${chapter.extraAiInsight}`);
      lines.push('');
    }
  });

  lines.push('---');
  lines.push('');
  lines.push('## Quick Recall Sheet');
  lines.push('');
  lines.push('| Term / Formula | Definition | Quick Note |');
  lines.push('| --- | --- | --- |');
  guide.quickRecall.terms.forEach((row) => {
    lines.push(`| **${row.term}** | ${row.definition} | ${row.note} |`);
  });
  lines.push('');
  lines.push('### Rapid Revision Checklist');
  guide.quickRecall.checklist.forEach((item) => {
    lines.push(`- [ ] ${item}`);
  });

  return lines.join('\n');
}
