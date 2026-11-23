export type ActiveTab = 'mindmap' | 'cheatsheet' | 'script';

export type LanguageCode = 'en' | 'hi' | 'hinglish';

export type NodeAccent = 'violet' | 'cyan' | 'emerald' | 'indigo' | 'root';

export type NodeIconName = 'cpu' | 'book' | 'layers' | 'git-branch' | 'globe';

export interface KeyPoint {
  keyword: string;
  detail: string;
}

export interface MindmapSubNode {
  id: string;
  parentId: string;
  title: string;
  shortSubtitle: string;
  timestampLabel: string;
  timestampSeconds: number;
  accent: Exclude<NodeAccent, 'root'>;
  icon: NodeIconName;
  keyPoints: KeyPoint[];
  realLifeExample: string;
  simplifiedAnalogy: string;
}

export interface MindmapNode {
  id: string;
  title: string;
  shortSubtitle: string;
  timestampLabel: string;
  timestampSeconds: number;
  isRoot?: boolean;
  accent: NodeAccent;
  icon: NodeIconName;
  /** Default desktop canvas coordinates */
  position: {
    x: number;
    y: number;
  };
  keyPoints: KeyPoint[];
  realLifeExample?: string;
  simplifiedAnalogy: string;
  subNodes?: MindmapSubNode[];
}

/** Unified selected node view for Root, Main Topic, or Sub-Node */
export interface SelectedNodeDetail {
  id: string;
  title: string;
  shortSubtitle: string;
  timestampLabel: string;
  timestampSeconds: number;
  accent: NodeAccent;
  icon: NodeIconName;
  keyPoints: KeyPoint[];
  realLifeExample?: string;
  simplifiedAnalogy: string;
  parentTitle?: string;
  isSubNode: boolean;
}

export interface StructuredSimplification {
  simpleDefinition: string;
  easyExplanation: string;
  realLifeAnalogy: string;
  relevantExample: string;
  oneLineTakeaway: string;
}

export interface DefinitionCard {
  term: string;
  summary: string;
  formulaOrNote: string;
  accent: Exclude<NodeAccent, 'root'>;
  timestampLabel?: string;
  timestampSeconds?: number;
  moduleLabel?: string;
  /** Optional educational role tag (e.g., Definition, Formula, Rule, Code Pattern) */
  category?: string;
}

export interface ComplexityRow {
  structureOrAlgo: string;
  access: string;
  search: string;
  insert: string;
  space: string;
  rating: 'optimal' | 'balanced' | 'caution';
  ratingLabel: string;
}

export interface RealWorldExample {
  domain: string;
  structure: string;
  explanation: string;
  timestampSeconds: number;
  timestampLabel: string;
}

export interface CheatSheetRuleOrStep {
  title: string;
  detail: string;
  category?: 'rule' | 'process' | 'formula' | 'code' | 'distinction';
  codeSnippet?: string;
  timestampLabel?: string;
  timestampSeconds?: number;
}

export interface CheatSheetMistakeItem {
  mistake: string;
  correction: string;
  timestampLabel?: string;
  timestampSeconds?: number;
}

export interface CheatSheetData {
  definitionsTitle?: string;
  comparisonTableTitle?: string;
  comparisonColumns?: [string, string, string, string, string, string];
  examplesTitle?: string;
  definitions: DefinitionCard[];
  complexityRows: ComplexityRow[];
  realWorldExamples: RealWorldExample[];
  /** Subject-relevant rules, formulas, step-by-step processes, or source-supported code patterns */
  keyRulesOrSteps?: CheatSheetRuleOrStep[];
  /** Important distinctions, advantages/disadvantages, or common mistakes covered in the video */
  commonMistakes?: CheatSheetMistakeItem[];
  /** High-yield rapid revision bullets */
  quickRevisionPoints?: string[];
}

export interface TranscriptLine {
  id: string;
  timestampLabel: string;
  timestampSeconds: number;
  text: string;
}

export interface TranscriptSection {
  id: string;
  nodeId: string;
  title: string;
  topicTag: string;
  startLabel: string;
  startSeconds: number;
  endLabel?: string;
  endSeconds?: number;
  keyTakeaway?: string;
  accent: Exclude<NodeAccent, 'root'> | 'root';
  lines: TranscriptLine[];
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface GroundingInsight {
  summary: string;
  highlights: string[];
  sources: GroundingSource[];
  fetchedAt: string;
}

export type VideoCoverageMode =
  | 'full-transcript'
  | 'timeline-sampled'
  | 'chapters-metadata';

export interface LectureWorkspace {
  id: string;
  title: string;
  channel: string;
  youtubeUrl: string;
  videoId: string;
  durationLabel: string;
  videoDurationSeconds?: number;
  coverageMode?: VideoCoverageMode;
  videoCategory: string;
  language: LanguageCode;
  /** High-signal executive summary takeaways ("Skip the Video / TL;DW") */
  tldw: string[];
  nodes: MindmapNode[];
  cheatSheet: CheatSheetData;
  transcript: TranscriptSection[];
  sources?: GroundingSource[];
  /** True only for the built-in demonstration sample workspace */
  isDemo?: boolean;
  /** Distinguishes YouTube-backed workspaces from transcript-only notes */
  sourceType?: 'youtube' | 'manual-transcript';
}

export type VisualGuideTheme = 'obsidian' | 'warm' | 'blueprint';

export interface VisualGuideChapter {
  id: string;
  timestamp: string;
  timestampSeconds: number;
  heading: string;
  accent: Exclude<NodeAccent, 'root'>;
  /** Micro-paragraphs explaining what was actually taught in the video */
  videoExplanation: string[];
  /** Highlighted key terms for quick scanning */
  keyTerms: string[];
  /** Concrete worked/practical example grounded in the chapter */
  practicalExample?: string;
  /** Concise revision takeaway for the chapter */
  chapterSummary?: string;
  /** Bonus AI analogy, memory trick, or pro tip beyond the video */
  extraAiInsight: string;
  insightLabel: string;
  /** Clean 2-3 word English query for Wikipedia reference image lookup (empty when decorative) */
  webImageQuery: string;
  webImageUrl?: string;
  webImageCaption?: string;
  videoFrameUrl?: string;
  /** Sanitized inline <svg viewBox="0 0 600 220"> conceptual diagram (empty if diagram adds no value) */
  svgDiagram: string;
}

export interface VisualGuideQuickTerm {
  term: string;
  definition: string;
  note: string;
}

export interface VisualGuideData {
  id: string;
  videoId: string;
  language: LanguageCode;
  title: string;
  subtitle: string;
  channel: string;
  category: string;
  estimatedReadTime: string;
  heroTakeaways: string[];
  coverFrameUrl: string;
  chapters: VisualGuideChapter[];
  quickRecall: {
    terms: VisualGuideQuickTerm[];
    checklist: string[];
  };
  generatedAt: string;
}

export interface SavedLibraryEntry {
  videoId: string;
  title: string;
  channel: string;
  videoCategory: string;
  youtubeUrl: string;
  thumbnailUrl: string;
  activeLanguage: LanguageCode;
  languages: LanguageCode[];
  savedAt: number;
  workspacesByLang: Partial<Record<LanguageCode, LectureWorkspace>>;
  visualGuidesByLang: Partial<Record<LanguageCode, VisualGuideData>>;
  /** True only when the saved entry is the built-in sample demo */
  isDemo?: boolean;
  /** Distinguishes YouTube-backed entries from transcript-only notes */
  sourceType?: 'youtube' | 'manual-transcript';
}

export interface VideoChatCitation {
  label: string;
  seconds: number;
  topic?: string;
}

export interface VideoChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: VideoChatCitation[];
  /** True when the assistant message represents a network or API failure */
  isError?: boolean;
  /** Original user question when isError is true, enabling reliable Retry across reloads */
  failedQuestion?: string;
  createdAt: number;
}
