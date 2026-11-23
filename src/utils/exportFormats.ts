import type { LectureWorkspace, TranscriptSection } from '../types/mindflow';

/**
 * Filters transcript sections and individual lines by a case-insensitive query.
 * Matches against section titles, topic tags, timestamps, and spoken text.
 */
export function filterTranscriptSections(
  sections: TranscriptSection[],
  query: string
): TranscriptSection[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return sections;

  const filtered: TranscriptSection[] = [];

  for (const section of sections) {
    const headerMatches =
      section.title.toLowerCase().includes(normalized) ||
      section.topicTag.toLowerCase().includes(normalized) ||
      (section.keyTakeaway?.toLowerCase().includes(normalized) ?? false);

    const matchingLines = section.lines.filter(
      (line) =>
        line.text.toLowerCase().includes(normalized) ||
        line.timestampLabel.toLowerCase().includes(normalized)
    );

    if (headerMatches) {
      filtered.push(section);
    } else if (matchingLines.length > 0) {
      filtered.push({
        ...section,
        lines: matchingLines,
      });
    }
  }

  return filtered;
}

export function formatCheatSheetMarkdown(workspace: LectureWorkspace): string {
  const cols = workspace.cheatSheet.comparisonColumns ?? [
    'Structure / Algorithm',
    'Access',
    'Search',
    'Insert',
    'Space',
    'Profile',
  ];

  const lines: string[] = [
    `# ${workspace.title} — Cheat Sheet (${workspace.videoCategory})`,
    `Source: ${workspace.youtubeUrl}`,
    '',
    '## Skip the Video (TL;DW)',
    ...workspace.tldw.map((item, i) => `${i + 1}. ${item}`),
    '',
    `## ${workspace.cheatSheet.definitionsTitle ?? 'Core Definitions'}`,
    ...workspace.cheatSheet.definitions.map(
      (d) => `- **${d.term}**: ${d.summary} (${d.formulaOrNote})`
    ),
    '',
    `## ${workspace.cheatSheet.comparisonTableTitle ?? 'Time & Space Complexity'}`,
    `| ${cols.slice(0, 5).join(' | ')} |`,
    '| --- | --- | --- | --- | --- |',
    ...workspace.cheatSheet.complexityRows.map(
      (r) =>
        `| ${r.structureOrAlgo} | ${r.access} | ${r.search} | ${r.insert} | ${r.space} |`
    ),
    '',
    `## ${workspace.cheatSheet.examplesTitle ?? 'Real-World Applications'}`,
    ...workspace.cheatSheet.realWorldExamples.map(
      (ex) => `- **${ex.domain}** (${ex.structure} · ${ex.timestampLabel}): ${ex.explanation}`
    ),
  ];

  if (workspace.cheatSheet.keyRulesOrSteps && workspace.cheatSheet.keyRulesOrSteps.length > 0) {
    lines.push('', '## Rules, Processes, Formulas & Code Patterns');
    for (const item of workspace.cheatSheet.keyRulesOrSteps) {
      const ts = item.timestampLabel ? ` (${item.timestampLabel})` : '';
      lines.push(`- **${item.title}**${ts}: ${item.detail}`);
      if (item.codeSnippet) {
        lines.push('```', item.codeSnippet, '```');
      }
    }
  }

  if (workspace.cheatSheet.commonMistakes && workspace.cheatSheet.commonMistakes.length > 0) {
    lines.push('', '## Common Mistakes & Key Distinctions');
    for (const item of workspace.cheatSheet.commonMistakes) {
      const ts = item.timestampLabel ? ` (${item.timestampLabel})` : '';
      lines.push(`- **Avoid${ts}:** ${item.mistake} → **Instead:** ${item.correction}`);
    }
  }

  if (workspace.cheatSheet.quickRevisionPoints && workspace.cheatSheet.quickRevisionPoints.length > 0) {
    lines.push('', '## Quick Revision Points');
    for (const pt of workspace.cheatSheet.quickRevisionPoints) {
      lines.push(`- ${pt}`);
    }
  }

  return lines.join('\n');
}

export function formatAsMarkdown(workspace: LectureWorkspace): string {
  const nodeBlocks = workspace.nodes.map((node) => {
    const bullets = node.keyPoints
      .map((kp) => `  - **${kp.keyword}**: ${kp.detail}`)
      .join('\n');

    const subBlocks =
      node.subNodes && node.subNodes.length > 0
        ? '\n\n' +
          node.subNodes
            .map((sub) => {
              const subBullets = sub.keyPoints
                .map((kp) => `    - **${kp.keyword}**: ${kp.detail}`)
                .join('\n');
              return `#### ↳ ${sub.title} (${sub.timestampLabel})\n${subBullets}\n  > Real-life example: ${sub.realLifeExample}`;
            })
            .join('\n\n')
        : '';

    return `### ${node.title} (${node.timestampLabel})\n${bullets}\n\n> Simple Analogy: ${node.simplifiedAnalogy}${subBlocks}`;
  });

  return [
    `# MindFlow AI — ${workspace.title}`,
    `Category: ${workspace.videoCategory} | YouTube: ${workspace.youtubeUrl}`,
    '',
    '## Interactive Mindmap Nodes',
    ...nodeBlocks,
    '',
    formatCheatSheetMarkdown(workspace),
  ].join('\n\n');
}

export function formatAsPlainText(workspace: LectureWorkspace): string {
  const sections: string[] = [
    `MINDFLOW AI STUDY PACK: ${workspace.title.toUpperCase()}`,
    `Category: ${workspace.videoCategory} | Video: ${workspace.youtubeUrl}`,
    '------------------------------------------------------------',
    '',
    'SKIP THE VIDEO (TL;DW)',
    ...workspace.tldw.map((item, i) => `  ${i + 1}. ${item}`),
    '',
    'MINDMAP NOTES',
  ];

  for (const node of workspace.nodes) {
    sections.push(`\n[${node.timestampLabel}] ${node.title}`);
    for (const point of node.keyPoints) {
      sections.push(`  * ${point.keyword}: ${point.detail}`);
    }
    sections.push(`  Analogy: ${node.simplifiedAnalogy}`);
    if (node.subNodes) {
      for (const sub of node.subNodes) {
        sections.push(`    -> [${sub.timestampLabel}] ${sub.title}`);
        for (const sp of sub.keyPoints) {
          sections.push(`       - ${sp.keyword}: ${sp.detail}`);
        }
      }
    }
  }

  if (workspace.cheatSheet.quickRevisionPoints && workspace.cheatSheet.quickRevisionPoints.length > 0) {
    sections.push('\n------------------------------------------------------------');
    sections.push('QUICK REVISION POINTS\n');
    for (const pt of workspace.cheatSheet.quickRevisionPoints) {
      sections.push(`  * ${pt}`);
    }
  }

  sections.push('\n------------------------------------------------------------');
  sections.push('TIMESTAMPED TRANSCRIPT\n');

  for (const sec of workspace.transcript) {
    sections.push(`${sec.title} (${sec.startLabel})`);
    if (sec.keyTakeaway) {
      sections.push(`  Summary: ${sec.keyTakeaway}`);
    }
    for (const line of sec.lines) {
      sections.push(`  [${line.timestampLabel}] ${line.text}`);
    }
    sections.push('');
  }

  return sections.join('\n');
}

export function formatAsJson(workspace: LectureWorkspace): string {
  return JSON.stringify(workspace, null, 2);
}

export function formatSectionTranscript(section: TranscriptSection): string {
  return [
    `${section.title} (${section.startLabel})`,
    ...section.lines.map((l) => `[${l.timestampLabel}] ${l.text}`),
  ].join('\n');
}
