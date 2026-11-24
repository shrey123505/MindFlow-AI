import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { SAMPLE_DSA_BY_LANGUAGE, SAMPLE_DSA_LECTURE } from './data/sampleLecture';
import { SAMPLE_VISUAL_GUIDES_BY_LANGUAGE } from './data/sampleVisualGuide';
import type {
  ActiveTab,
  GroundingInsight,
  LanguageCode,
  LectureWorkspace,
  MindmapNode,
  MindmapSubNode,
  SavedLibraryEntry,
  SelectedNodeDetail,
  StructuredSimplification,
  VisualGuideData,
} from './types/mindflow';
import {
  buildWorkspaceCacheKey,
  extractYouTubeId,
  formatSeconds,
  normalizeYouTubeUrl,
  parseDetailedShareParams,
} from './utils/youtube';
import { findAnyNodeById, findClosestNodeForTimestamp } from './utils/mindmapMath';
import {
  isManualTranscriptWorkspace,
  resolveManualTranscriptIdentity,
} from './utils/manualTranscript';
import { buildVisualGuideCacheKey } from './utils/visualGuide';
import { compactWorkspaceForVisualGuide } from './utils/serverGuards';
import { copyTextWithFallback } from './utils/pdfExport';
import {
  deleteLibraryItem,
  isDemoWorkspace,
  loadLibraryWithReport,
  MAX_LIBRARY_ITEMS,
  saveLibraryToStorage,
  upsertLibraryItem,
  upsertLibraryItemWithReport,
} from './utils/libraryStorage';
import { DesktopNavbar } from './components/DesktopNavbar';
import { YouTubePlayerCard, type SeekRequest } from './components/YouTubePlayerCard';
import { KeyTakeawaysCard } from './components/KeyTakeawaysCard';
import { MindmapCanvas } from './components/MindmapCanvas';
import { CheatSheetView } from './components/CheatSheetView';
import { ScriptView } from './components/ScriptView';
import {
  MobileBottomNav,
  MobileHeader,
  MobileNodeDrawer,
} from './components/MobileShell';
import { VideoChatWidget } from './components/VideoChatWidget';
import { AuthModal } from './components/AuthModal';
import { apiFetch } from './utils/apiFetch';
import type { AccountUsage, AccountUser, AuthSessionResponse } from './types/auth';

// Code-split heavy modals & PDF generation dependencies out of the initial bundle
const ExportModal = lazy(() =>
  import('./components/ExportModal').then((m) => ({ default: m.ExportModal }))
);
const ManualTranscriptModal = lazy(() =>
  import('./components/ManualTranscriptModal').then((m) => ({
    default: m.ManualTranscriptModal,
  }))
);
const VisualPdfStudioModal = lazy(() =>
  import('./components/VisualPdfStudioModal').then((m) => ({
    default: m.VisualPdfStudioModal,
  }))
);
const LibraryDrawer = lazy(() =>
  import('./components/LibraryDrawer').then((m) => ({ default: m.LibraryDrawer }))
);

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(min-width: 1024px)').matches;
  });

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    setIsDesktop(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return isDesktop;
}

function readCachedWorkspace(
  videoId: string,
  language: LanguageCode
): LectureWorkspace | null {
  if (videoId === SAMPLE_DSA_LECTURE.videoId) {
    return SAMPLE_DSA_BY_LANGUAGE[language];
  }
  const cacheKey = buildWorkspaceCacheKey(videoId, language);
  try {
    const raw = sessionStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LectureWorkspace> | null;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.videoId !== 'string' ||
      typeof parsed.title !== 'string' ||
      !Array.isArray(parsed.nodes) ||
      parsed.nodes.length === 0 ||
      !parsed.cheatSheet ||
      !Array.isArray(parsed.transcript)
    ) {
      sessionStorage.removeItem(cacheKey);
      return null;
    }
    return parsed as LectureWorkspace;
  } catch {
    try {
      sessionStorage.removeItem(cacheKey);
    } catch {
      // Ignore storage errors
    }
    return null;
  }
}

function writeCachedWorkspace(workspace: LectureWorkspace) {
  try {
    sessionStorage.setItem(
      buildWorkspaceCacheKey(workspace.videoId, workspace.language),
      JSON.stringify(workspace)
    );
  } catch {
    // Ignore quota limits
  }
}

async function safeParseJsonResponse<T = Record<string, unknown>>(
  response: Response
): Promise<T | null> {
  try {
    const raw = await response.text();
    if (!raw.trim()) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const ANALYSIS_STEPS = [
  'Fetching video info & captions...',
  'Analyzing concepts & chapters...',
  'Building interactive 3-level mindmap...',
];

export default function App() {
  const isDesktop = useIsDesktop();

  const [accountUser, setAccountUser] = useState<AccountUser | null>(null);
  const [accountUsage, setAccountUsage] = useState<AccountUsage | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);

  const [language, setLanguage] = useState<LanguageCode>('en');
  const [workspace, setWorkspace] = useState<LectureWorkspace>(SAMPLE_DSA_LECTURE);
  const [urlInput, setUrlInput] = useState<string>(SAMPLE_DSA_LECTURE.youtubeUrl);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [showTranscriptFallback, setShowTranscriptFallback] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('mindmap');

  // Multi-level tree selection & expansion state
  const [selectedNodeId, setSelectedNodeId] = useState<string>(
    SAMPLE_DSA_LECTURE.nodes[0].id
  );
  const [expandedNodeIds, setExpandedNodeIds] = useState<string[]>([]);
  const [takeawaysCollapsed, setTakeawaysCollapsed] = useState(false);

  // Per-(videoId:nodeId:language) Simplify AI toggle & cache
  const [simplifiedOpenMap, setSimplifiedOpenMap] = useState<Record<string, boolean>>({});
  const [simplifiedCache, setSimplifiedCache] = useState<Record<string, string>>({});
  const [simplifiedStructuredCache, setSimplifiedStructuredCache] = useState<
    Record<string, StructuredSimplification | null>
  >({});
  const [simplifyLoading, setSimplifyLoading] = useState(false);
  const [simplifyError, setSimplifyError] = useState<string | null>(null);

  // Mobile-specific state
  const [mobileUrlOpen, setMobileUrlOpen] = useState(false);
  const [mobilePlayerMinimized, setMobilePlayerMinimized] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  // Modals, drawers, docked chat & desktop split-panel sizing
  const [chatOpen, setChatOpen] = useState(false);
  const [leftPaneWidthPct, setLeftPaneWidthPct] = useState<number>(33);
  const [isResizingPane, setIsResizingPane] = useState(false);
  const desktopMainRef = useRef<HTMLElement | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [manualTranscriptOpen, setManualTranscriptOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [visualStudioOpen, setVisualStudioOpen] = useState(false);
  const [visualGuideLoading, setVisualGuideLoading] = useState(false);
  const [visualGuideError, setVisualGuideError] = useState<string | null>(null);
  const [activeVisualGuide, setActiveVisualGuide] = useState<VisualGuideData | null>(
    SAMPLE_VISUAL_GUIDES_BY_LANGUAGE.en
  );
  const [toast, setToast] = useState<{
    message: string;
    variant: 'success' | 'error' | 'info';
  } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const inFlightAnalysisKeyRef = useRef<string | null>(null);

  // Saved Library / History (versioned localStorage v4, capped at 15 videos)
  const initialLibraryReportRef = useRef<ReturnType<typeof loadLibraryWithReport> | null>(null);
  const [libraryStorageNotice, setLibraryStorageNotice] = useState<string | null>(null);
  const [libraryItems, setLibraryItems] = useState<SavedLibraryEntry[]>(() => {
    const report = loadLibraryWithReport();
    initialLibraryReportRef.current = report;
    if (report.items.length > 0) return report.items;
    const seeded = upsertLibraryItem(
      [],
      SAMPLE_DSA_LECTURE,
      SAMPLE_VISUAL_GUIDES_BY_LANGUAGE.en
    );
    saveLibraryToStorage(seeded);
    return seeded;
  });

  // YouTube Player seek sync state (honors valid deep-link ?t= immediately on first render)
  const [seekRequest, setSeekRequest] = useState<SeekRequest>(() => {
    if (typeof window !== 'undefined') {
      const share = parseDetailedShareParams(window.location.search);
      if (!share.invalidVideoId && share.startSeconds !== null) {
        return { seconds: share.startSeconds, nonce: 1 };
      }
    }
    return {
      seconds: SAMPLE_DSA_LECTURE.nodes[0].timestampSeconds,
      nonce: 0,
    };
  });
  const [activeTimestampLabel, setActiveTimestampLabel] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const share = parseDetailedShareParams(window.location.search);
      if (!share.invalidVideoId && share.startSeconds !== null) {
        return formatSeconds(share.startSeconds);
      }
    }
    return SAMPLE_DSA_LECTURE.nodes[0].timestampLabel;
  });

  // Analysis, translation, & Google Search Grounding state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStep, setAnalysisStep] = useState<string>(ANALYSIS_STEPS[0]);
  const [isTranslating, setIsTranslating] = useState(false);
  const [groundingByNode, setGroundingByNode] = useState<
    Record<string, GroundingInsight>
  >({});
  const [groundingLoading, setGroundingLoading] = useState(false);
  const [groundingError, setGroundingError] = useState<string | null>(null);

  // In-memory caches mirrored with sessionStorage & localStorage for zero duplicate API calls
  const workspaceCacheRef = useRef<Record<string, LectureWorkspace>>({
    [buildWorkspaceCacheKey(SAMPLE_DSA_LECTURE.videoId, 'en')]: SAMPLE_DSA_BY_LANGUAGE.en,
    [buildWorkspaceCacheKey(SAMPLE_DSA_LECTURE.videoId, 'hi')]: SAMPLE_DSA_BY_LANGUAGE.hi,
    [buildWorkspaceCacheKey(SAMPLE_DSA_LECTURE.videoId, 'hinglish')]:
      SAMPLE_DSA_BY_LANGUAGE.hinglish,
  });

  const visualGuideCacheRef = useRef<Record<string, VisualGuideData>>({
    [buildVisualGuideCacheKey(SAMPLE_DSA_LECTURE.videoId, 'en')]:
      SAMPLE_VISUAL_GUIDES_BY_LANGUAGE.en,
    [buildVisualGuideCacheKey(SAMPLE_DSA_LECTURE.videoId, 'hi')]:
      SAMPLE_VISUAL_GUIDES_BY_LANGUAGE.hi,
    [buildVisualGuideCacheKey(SAMPLE_DSA_LECTURE.videoId, 'hinglish')]:
      SAMPLE_VISUAL_GUIDES_BY_LANGUAGE.hinglish,
  });

  const showToast = useCallback(
    (message: string, variant: 'success' | 'error' | 'info' = 'success') => {
      setToast({ message, variant });
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      toastTimerRef.current = window.setTimeout(() => {
        setToast(null);
      }, 4500);
    },
    []
  );

  const refreshAccount = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
      const data = (await response.json().catch(() => null)) as AuthSessionResponse | null;
      if (!response.ok || !data) return;
      setAccountUser(data.user ?? null);
      setAccountUsage(data.usage ?? null);
    } catch {
      // Account status is optional for the built-in demo and will retry on the next API action.
    }
  }, []);

  useEffect(() => {
    void refreshAccount();
    const onAuthRequired = () => setAccountOpen(true);
    const onUsageUpdated = () => void refreshAccount();
    window.addEventListener('mindflow:auth-required', onAuthRequired);
    window.addEventListener('mindflow:usage-updated', onUsageUpdated);
    return () => {
      window.removeEventListener('mindflow:auth-required', onAuthRequired);
      window.removeEventListener('mindflow:usage-updated', onUsageUpdated);
    };
  }, [refreshAccount]);

  const handleAuthenticated = useCallback(
    (session: AuthSessionResponse) => {
      setAccountUser(session.user ?? null);
      setAccountUsage(session.usage ?? null);
      setAccountOpen(false);
      showToast('Signed in. Your study tools are ready.');
    },
    [showToast]
  );

  const handleSignedOut = useCallback(() => {
    setAccountUser(null);
    setAccountUsage(null);
    setAccountOpen(false);
    setChatOpen(false);
    showToast('You have been signed out.', 'info');
  }, [showToast]);

  // Inform user if corrupted library data was recovered on startup
  useEffect(() => {
    const report = initialLibraryReportRef.current;
    if (report?.recoveredFromCorruption) {
      const msg =
        report.droppedInvalidEntries > 0
          ? `Recovered saved library (${report.droppedInvalidEntries} corrupted ${
              report.droppedInvalidEntries === 1 ? 'entry was' : 'entries were'
            } cleaned up).`
          : 'Recovered from corrupted browser storage. Your library has been reset cleanly.';
      setLibraryStorageNotice(msg);
      showToast(msg, 'info');
    }
  }, [showToast]);

  const persistToLibrary = useCallback(
    (ws: LectureWorkspace, guide?: VisualGuideData | null) => {
      let pendingToast: { message: string; variant: 'info' | 'error' } | null = null;
      let nextNotice: string | null = null;

      setLibraryItems((prev) => {
        const upserted = upsertLibraryItemWithReport(prev, ws, guide);
        const saveResult = saveLibraryToStorage(upserted.items);

        if (!saveResult.ok) {
          const msg =
            'Browser storage is full — this workspace is active now, but could not be saved locally. Delete older library items to free space.';
          nextNotice = msg;
          pendingToast = { message: msg, variant: 'error' };
          return upserted.items;
        }

        if (saveResult.droppedForQuota > 0) {
          const msg = `Browser storage is tight — kept your ${saveResult.savedCount} most recent videos locally.`;
          nextNotice = msg;
          pendingToast = { message: msg, variant: 'info' };
          return upserted.items.slice(0, saveResult.savedCount);
        }

        if (upserted.evictedTitles.length > 0) {
          const evictedTitle = upserted.evictedTitles[0].slice(0, 42);
          pendingToast = {
            message: `Library reached ${MAX_LIBRARY_ITEMS}/${MAX_LIBRARY_ITEMS} — replaced oldest entry "${evictedTitle}" to save this video.`,
            variant: 'info',
          };
        }

        return upserted.items;
      });

      setLibraryStorageNotice(nextNotice);
      if (pendingToast) {
        const { message, variant } = pendingToast as { message: string; variant: 'info' | 'error' };
        window.setTimeout(() => showToast(message, variant), 0);
      }
    },
    [showToast]
  );

  const selectedNode = useMemo<SelectedNodeDetail>(() => {
    const found = findAnyNodeById(workspace.nodes, selectedNodeId);
    if (found) return found;
    const fallback = workspace.nodes[0];
    return {
      id: fallback.id,
      title: fallback.title,
      shortSubtitle: fallback.shortSubtitle,
      timestampLabel: fallback.timestampLabel,
      timestampSeconds: fallback.timestampSeconds,
      accent: fallback.accent,
      icon: fallback.icon,
      keyPoints: fallback.keyPoints,
      realLifeExample: fallback.realLifeExample,
      simplifiedAnalogy: fallback.simplifiedAnalogy,
      isSubNode: false,
    };
  }, [workspace.nodes, selectedNodeId]);

  const simplifyKey = `${workspace.videoId}:${selectedNode.id}:${language}`;
  const isCurrentNodeSimplified = Boolean(simplifiedOpenMap[simplifyKey]);
  const currentSimplifiedText =
    simplifiedCache[simplifyKey] ?? selectedNode.simplifiedAnalogy;
  const currentSimplifiedStructured = simplifiedStructuredCache[simplifyKey] ?? null;

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // Multi-step loading caption progression during /api/analyze
  useEffect(() => {
    if (!isAnalyzing) return;
    setAnalysisStep(ANALYSIS_STEPS[0]);
    const t1 = window.setTimeout(() => setAnalysisStep(ANALYSIS_STEPS[1]), 1400);
    const t2 = window.setTimeout(() => setAnalysisStep(ANALYSIS_STEPS[2]), 3400);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [isAnalyzing]);

  const jumpVideoTo = useCallback((seconds: number, nodeId?: string) => {
    const safeSec = Math.max(0, Math.floor(seconds));
    setSeekRequest((prev) => ({ seconds: safeSec, nonce: prev.nonce + 1 }));
    setActiveTimestampLabel(formatSeconds(safeSec));
    if (nodeId) {
      setSelectedNodeId(nodeId);
    }
    setMobilePlayerMinimized(false);
  }, []);

  const handleSelectNode = useCallback(
    (
      node: MindmapNode | MindmapSubNode,
      options?: { openMobileDrawer?: boolean }
    ) => {
      setSelectedNodeId(node.id);
      setGroundingError(null);
      setSimplifyError(null);
      setSeekRequest((prev) => ({
        seconds: node.timestampSeconds,
        nonce: prev.nonce + 1,
      }));
      setActiveTimestampLabel(node.timestampLabel);

      if (options?.openMobileDrawer) {
        setMobileDrawerOpen(true);
      }
    },
    []
  );

  const handleToggleExpand = useCallback((nodeId: string) => {
    setExpandedNodeIds((prev) =>
      prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId]
    );
  }, []);

  const handleToggleExpandAll = useCallback(() => {
    const expandableIds = workspace.nodes
      .filter((n) => !n.isRoot && (n.subNodes?.length ?? 0) > 0)
      .map((n) => n.id);
    if (expandableIds.length === 0) return;

    setExpandedNodeIds((prev) => {
      const allExpanded = expandableIds.every((id) => prev.includes(id));
      return allExpanded ? [] : expandableIds;
    });
  }, [workspace.nodes]);

  const handleCollapseAll = useCallback(() => {
    setExpandedNodeIds([]);
  }, []);

  const handleStartPaneResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const mainEl = desktopMainRef.current;
      if (!mainEl) return;
      e.preventDefault();
      setIsResizingPane(true);
      const rect = mainEl.getBoundingClientRect();

      const onMove = (ev: PointerEvent) => {
        const relativeX = ev.clientX - rect.left;
        const pct = (relativeX / rect.width) * 100;
        const clamped = Math.max(25, Math.min(44, pct));
        setLeftPaneWidthPct(Math.round(clamped * 10) / 10);
      };

      const onUp = () => {
        setIsResizingPane(false);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    []
  );

  // Keep activeVisualGuide synced to the active video + language cache
  useEffect(() => {
    const vKey = buildVisualGuideCacheKey(workspace.videoId, language);
    const cached =
      visualGuideCacheRef.current[vKey] ??
      libraryItems.find((item) => item.videoId === workspace.videoId)?.visualGuidesByLang?.[
        language
      ] ??
      null;
    setActiveVisualGuide(cached);
  }, [workspace.videoId, language, libraryItems]);

  /** Working "Simplify with AI" wired to /api/simplify + smart per-node/language cache */
  const handleToggleSimplify = useCallback(async () => {
    if (isCurrentNodeSimplified) {
      setSimplifiedOpenMap((prev) => ({ ...prev, [simplifyKey]: false }));
      return;
    }

    setSimplifiedOpenMap((prev) => ({ ...prev, [simplifyKey]: true }));
    setSimplifyError(null);

    // Cache hit -> instant zero-API display
    if (simplifiedCache[simplifyKey]) {
      return;
    }

    // Gather nearest transcript chapter excerpt for richer, grounded simplification
    let transcriptExcerpt = '';
    if (workspace.transcript.length > 0) {
      let nearest = workspace.transcript[0];
      let bestDist = Math.abs(nearest.startSeconds - selectedNode.timestampSeconds);
      for (const sec of workspace.transcript) {
        if (sec.nodeId === selectedNode.id) {
          nearest = sec;
          break;
        }
        const dist = Math.abs(sec.startSeconds - selectedNode.timestampSeconds);
        if (dist < bestDist) {
          bestDist = dist;
          nearest = sec;
        }
      }
      transcriptExcerpt = [
        nearest.keyTakeaway ?? '',
        ...nearest.lines.slice(0, 4).map((l) => l.text),
      ]
        .filter(Boolean)
        .join(' ')
        .slice(0, 1000);
    }

    setSimplifyLoading(true);
    try {
      const response = await apiFetch('/api/simplify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeTitle: selectedNode.title,
          videoTitle: workspace.title,
          shortSubtitle: selectedNode.shortSubtitle,
          realLifeExample: selectedNode.realLifeExample,
          transcriptExcerpt,
          keyPoints: selectedNode.keyPoints,
          language,
        }),
      });
      const data = await safeParseJsonResponse<{
        analogy?: string;
        structured?: StructuredSimplification | null;
        error?: string;
      }>(response);

      const trimmedAnalogy = typeof data?.analogy === 'string' ? data.analogy.trim() : '';

      if (response.ok && (trimmedAnalogy || data?.structured)) {
        setSimplifiedCache((prev) => ({
          ...prev,
          [simplifyKey]: trimmedAnalogy || selectedNode.simplifiedAnalogy,
        }));
        setSimplifiedStructuredCache((prev) => ({
          ...prev,
          [simplifyKey]: data?.structured ?? null,
        }));
      } else {
        // Gracefully display the built-in analogy if API key is missing/rate-limited
        setSimplifiedCache((prev) => ({
          ...prev,
          [simplifyKey]: selectedNode.simplifiedAnalogy,
        }));
        if (!selectedNode.simplifiedAnalogy) {
          setSimplifyError(data?.error || 'Could not simplify right now.');
        }
      }
    } catch {
      setSimplifiedCache((prev) => ({
        ...prev,
        [simplifyKey]: selectedNode.simplifiedAnalogy,
      }));
    } finally {
      setSimplifyLoading(false);
    }
  }, [
    isCurrentNodeSimplified,
    simplifyKey,
    simplifiedCache,
    selectedNode,
    workspace.title,
    workspace.transcript,
    language,
  ]);

  /** Smart cached English / Hindi / Hinglish language switcher */
  const handleLanguageChange = useCallback(
    async (nextLang: LanguageCode) => {
      if (nextLang === language || isTranslating) return;

      const cacheKey = buildWorkspaceCacheKey(workspace.videoId, nextLang);
      const fromLibrary = libraryItems.find((item) => item.videoId === workspace.videoId)
        ?.workspacesByLang?.[nextLang];
      const cached =
        workspaceCacheRef.current[cacheKey] ??
        fromLibrary ??
        readCachedWorkspace(workspace.videoId, nextLang);

      if (cached) {
        workspaceCacheRef.current[cacheKey] = cached;
        setLanguage(nextLang);
        setWorkspace(cached);
        showToast(
          nextLang === 'hi'
            ? 'Switched to Hindi (cached)'
            : nextLang === 'hinglish'
              ? 'Switched to Hinglish (cached)'
              : 'Switched to English (cached)'
        );
        return;
      }

      // Call fast /api/translate once and cache it per (videoId + language)
      setIsTranslating(true);
      try {
      const response = await apiFetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspace,
            targetLanguage: nextLang,
          }),
        });
        const data = await safeParseJsonResponse<{
          workspace?: LectureWorkspace;
          error?: string;
        }>(response);
        if (!response.ok || !data?.workspace) {
          showToast(data?.error || 'Translation unavailable right now', 'error');
          return;
        }
        const translated = data.workspace;
        workspaceCacheRef.current[cacheKey] = translated;
        writeCachedWorkspace(translated);
        persistToLibrary(translated);
        setLanguage(nextLang);
        setWorkspace(translated);
        showToast(
          `Translated workspace to ${
            nextLang === 'hi' ? 'Hindi' : nextLang === 'hinglish' ? 'Hinglish' : 'English'
          }`,
          'success'
        );
      } catch {
        showToast('Network error while translating', 'error');
      } finally {
        setIsTranslating(false);
      }
    },
    [language, isTranslating, workspace, libraryItems, showToast, persistToLibrary]
  );

  const applyLoadedWorkspace = useCallback(
    (nextWorkspace: LectureWorkspace, seekAfterLoad?: number) => {
      const hasExplicitSeek =
        typeof seekAfterLoad === 'number' && Number.isFinite(seekAfterLoad);
      const targetSeconds = hasExplicitSeek
        ? Math.max(0, Math.floor(seekAfterLoad))
        : nextWorkspace.nodes[0].timestampSeconds;

      const matchedNode =
        (hasExplicitSeek
          ? findClosestNodeForTimestamp(nextWorkspace.nodes, targetSeconds)
          : null) ?? {
          nodeId: nextWorkspace.nodes[0].id,
          parentIdToExpand: null,
          timestampSeconds: nextWorkspace.nodes[0].timestampSeconds,
          timestampLabel: nextWorkspace.nodes[0].timestampLabel,
        };

      const isTranscriptOnly = isManualTranscriptWorkspace(nextWorkspace);

      setLanguage(nextWorkspace.language);
      setWorkspace(nextWorkspace);
      setUrlInput(isTranscriptOnly ? '' : nextWorkspace.youtubeUrl);
      setSelectedNodeId(matchedNode.nodeId);
      setExpandedNodeIds(
        matchedNode.parentIdToExpand ? [matchedNode.parentIdToExpand] : []
      );
      setActiveTimestampLabel(
        hasExplicitSeek ? formatSeconds(targetSeconds) : matchedNode.timestampLabel
      );
      setSeekRequest((prev) => ({
        seconds: targetSeconds,
        nonce: prev.nonce + 1,
      }));
    },
    []
  );

  /** Resilient 3-layer Universal Video Analyzer (/api/analyze) */
  const runAnalysis = useCallback(
    async (options?: {
      manualTranscript?: string;
      optionalYouTubeUrl?: string;
      overrideUrl?: string;
      overrideLanguage?: LanguageCode;
      seekAfterLoad?: number;
    }) => {
      const manualTranscript = options?.manualTranscript?.trim();
      const targetLang = options?.overrideLanguage ?? language;

      let videoIdToSend = '';
      let normalizedUrl = '';
      let requestDedupKey = '';

      if (manualTranscript) {
        const identity = resolveManualTranscriptIdentity({
          transcript: manualTranscript,
          optionalYouTubeUrl: options?.optionalYouTubeUrl,
        });
        if (!identity.ok) {
          const msg =
            identity.error ||
            'Optional YouTube URL is invalid. Enter a valid YouTube link or leave it blank for a transcript-only workspace.';
          setUrlError(msg);
          showToast(msg, 'error');
          return;
        }
        videoIdToSend = identity.sourceType === 'youtube' ? identity.videoId : '';
        normalizedUrl = identity.sourceType === 'youtube' ? identity.youtubeUrl : '';
        requestDedupKey = `manual:${identity.videoId}:${targetLang}`;
      } else {
        const trimmed = (options?.overrideUrl ?? urlInput).trim();
        const extractedId = extractYouTubeId(trimmed);
        if (!trimmed) {
          setUrlError('Please paste a YouTube URL or 11-character video ID.');
          setShowTranscriptFallback(true);
          return;
        }
        if (!extractedId) {
          setUrlError(
            'Invalid YouTube URL. Supports watch?v=, youtu.be/, shorts/, live/, or an 11-char ID.'
          );
          setShowTranscriptFallback(true);
          return;
        }
        videoIdToSend = extractedId;
        normalizedUrl = normalizeYouTubeUrl(extractedId);
        requestDedupKey = `yt:${extractedId}:${targetLang}`;

        // Instant cache hit check when analyzing by URL (not manual transcript override)
        const cacheKey = buildWorkspaceCacheKey(extractedId, targetLang);
        const fromLibrary = libraryItems.find((item) => item.videoId === extractedId)
          ?.workspacesByLang?.[targetLang];
        const cached =
          workspaceCacheRef.current[cacheKey] ??
          fromLibrary ??
          readCachedWorkspace(extractedId, targetLang);
        if (cached) {
          workspaceCacheRef.current[cacheKey] = cached;
          setUrlError(null);
          setShowTranscriptFallback(false);
          applyLoadedWorkspace(cached, options?.seekAfterLoad);
          setMobileUrlOpen(false);
          showToast(`Loaded ${cached.title} (${cached.videoCategory})`, 'success');
          return;
        }
      }

      // Guard against duplicate in-flight /api/analyze requests for the same target
      if (inFlightAnalysisKeyRef.current === requestDedupKey) {
        return;
      }

      setUrlError(null);
      setShowTranscriptFallback(false);
      inFlightAnalysisKeyRef.current = requestDedupKey;
      setIsAnalyzing(true);
      try {
        const requestPayload = JSON.stringify({
          videoId: videoIdToSend,
          youtubeUrl: normalizedUrl,
          language: targetLang,
          ...(manualTranscript ? { manualTranscript } : {}),
        });

        let response: Response | null = null;
        let lastFetchError: unknown = null;

        // Automatic 1-time transparent retry for transient proxy/network hiccups
        for (let attempt = 0; attempt < 2; attempt++) {
          const controller = new AbortController();
          const timer = window.setTimeout(() => controller.abort(), 70000);
          try {
            response = await apiFetch('/api/analyze', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: requestPayload,
              signal: controller.signal,
            });
            window.clearTimeout(timer);
            if (response.status >= 502 && response.status <= 504 && attempt === 0) {
              continue;
            }
            break;
          } catch (err) {
            window.clearTimeout(timer);
            lastFetchError = err;
            if (attempt === 1) throw err;
          }
        }

        if (!response) {
          throw lastFetchError ?? new Error('No response received from analysis server.');
        }

        const data = await safeParseJsonResponse<{
          workspace?: LectureWorkspace;
          error?: string;
          canPasteTranscript?: boolean;
        }>(response);

        if (!response.ok || !data?.workspace?.nodes?.length) {
          // Never corrupt the currently active workspace's videoId/youtubeUrl on failure
          const statusFallback =
            response.status === 504
              ? 'Video analysis took too long for this link. Please retry once or paste transcript manually.'
              : `Could not analyze this YouTube video automatically (HTTP ${response.status}).`;
          const errMessage = data?.error || statusFallback;
          setUrlError(errMessage);
          setShowTranscriptFallback(Boolean(data?.canPasteTranscript ?? true));
          showToast(errMessage, 'error');
          return;
        }

        const nextWorkspace = data.workspace;
        const cacheKey = buildWorkspaceCacheKey(
          nextWorkspace.videoId,
          nextWorkspace.language
        );
        workspaceCacheRef.current[cacheKey] = nextWorkspace;
        writeCachedWorkspace(nextWorkspace);
        persistToLibrary(nextWorkspace);

        applyLoadedWorkspace(nextWorkspace, options?.seekAfterLoad);
        setGroundingByNode({});
        setMobileUrlOpen(false);
        setManualTranscriptOpen(false);
        showToast(
          isManualTranscriptWorkspace(nextWorkspace)
            ? `Transcript mindmap ready · ${nextWorkspace.videoCategory}`
            : `Mindmap ready · ${nextWorkspace.videoCategory}`,
          'success'
        );
      } catch (err) {
        const isAbort = err instanceof Error && err.name === 'AbortError';
        const message = isAbort
          ? 'Analysis timed out for this video. Please retry or paste transcript manually.'
          : 'Connection interrupted while analyzing this video. Please retry or paste transcript manually.';
        setUrlError(message);
        setShowTranscriptFallback(true);
        showToast(message, 'error');
      } finally {
        if (inFlightAnalysisKeyRef.current === requestDedupKey) {
          inFlightAnalysisKeyRef.current = null;
        }
        setIsAnalyzing(false);
      }
    },
    [
      urlInput,
      language,
      libraryItems,
      applyLoadedWorkspace,
      showToast,
      persistToLibrary,
    ]
  );

  // Restore shared deep-link parameters (?v=...&t=...&lang=...) once on initial mount
  const initializedShareRef = useRef(false);
  useEffect(() => {
    if (initializedShareRef.current || typeof window === 'undefined') return;
    initializedShareRef.current = true;

    const share = parseDetailedShareParams(window.location.search);
    if (!share.hasShareParams) return;

    if (share.invalidVideoId) {
      showToast(
        'Invalid shared YouTube video ID in link — showing default lecture',
        'error'
      );
      return;
    }

    const targetLang: LanguageCode = share.language ?? 'en';
    const targetVideoId = share.videoId ?? SAMPLE_DSA_LECTURE.videoId;
    const cacheKey = buildWorkspaceCacheKey(targetVideoId, targetLang);
    const fromLibrary = libraryItems.find((item) => item.videoId === targetVideoId)
      ?.workspacesByLang?.[targetLang];
    const cached =
      workspaceCacheRef.current[cacheKey] ??
      fromLibrary ??
      readCachedWorkspace(targetVideoId, targetLang);

    const paramWarnings: string[] = [];
    if (share.invalidTimestamp) paramWarnings.push('timestamp');
    if (share.invalidLanguage) paramWarnings.push('language');

    if (cached) {
      workspaceCacheRef.current[cacheKey] = cached;
      applyLoadedWorkspace(cached, share.startSeconds ?? undefined);
      if (paramWarnings.length > 0) {
        showToast(
          `Restored shared workspace (ignored invalid ${paramWarnings.join(' & ')})`,
          'info'
        );
      }
      return;
    }

    if (share.videoId) {
      const targetUrl = normalizeYouTubeUrl(share.videoId);
      setLanguage(targetLang);
      setUrlInput(targetUrl);
      if (paramWarnings.length > 0) {
        showToast(
          `Loading shared video (ignored invalid ${paramWarnings.join(' & ')})`,
          'info'
        );
      }
      void runAnalysis({
        overrideUrl: targetUrl,
        overrideLanguage: targetLang,
        seekAfterLoad: share.startSeconds ?? undefined,
      });
    }
  }, [libraryItems, applyLoadedWorkspace, runAnalysis, showToast]);

  /** Open & generate/load cached Long-Form Visual PDF Guide for (videoId + language) */
  const handleOpenVisualPdfStudio = useCallback(
    async (
      forceRegenerate = false,
      options?: { includeDiagrams?: boolean }
    ) => {
      setVisualStudioOpen(true);
      setVisualGuideError(null);

      const includeDiagrams = options?.includeDiagrams ?? true;
      const vKey = buildVisualGuideCacheKey(workspace.videoId, language);

      if (!forceRegenerate) {
        // 1. In-memory cache (includes pre-seeded DSA en/hi/hinglish guides)
        const inMem = visualGuideCacheRef.current[vKey];
        if (inMem) {
          setActiveVisualGuide(inMem);
          return;
        }

        // 2. Saved Library localStorage cache
        const savedEntry = libraryItems.find((item) => item.videoId === workspace.videoId);
        const fromLibrary = savedEntry?.visualGuidesByLang?.[language];
        if (fromLibrary) {
          visualGuideCacheRef.current[vKey] = fromLibrary;
          setActiveVisualGuide(fromLibrary);
          return;
        }
      }

      setActiveVisualGuide(null);
      setVisualGuideLoading(true);
      try {
        const compactedAnalysis = compactWorkspaceForVisualGuide(
          workspace as unknown as Record<string, unknown>
        );
        const response = await apiFetch('/api/generate-visual-guide', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoId: workspace.videoId,
            analysisData: compactedAnalysis,
            language,
            guideLength: 'long',
            includeDiagrams,
          }),
        });
        const data = await safeParseJsonResponse<{
          guide?: VisualGuideData;
          error?: string;
        }>(response);
        if (!response.ok || !data?.guide) {
          setVisualGuideError(
            data?.error || 'Could not generate the Long-Form Visual PDF Guide right now.'
          );
          return;
        }

        const generatedGuide = data.guide;
        visualGuideCacheRef.current[vKey] = generatedGuide;
        setActiveVisualGuide(generatedGuide);
        persistToLibrary(workspace, generatedGuide);
        showToast(
          `Long-Form Visual PDF ready (${generatedGuide.chapters.length} chapters)`
        );
      } catch {
        setVisualGuideError('Network error while generating Visual PDF Guide. Please retry.');
      } finally {
        setVisualGuideLoading(false);
      }
    },
    [workspace, language, libraryItems, persistToLibrary, showToast]
  );

  /** Instant 0ms reload from Saved Library / History drawer */
  const handleSelectLibraryEntry = useCallback(
    (entry: SavedLibraryEntry) => {
      const targetLang =
        entry.workspacesByLang[language] !== undefined
          ? language
          : entry.workspacesByLang[entry.activeLanguage] !== undefined
            ? entry.activeLanguage
            : entry.languages[0] ?? 'en';

      const loadedWorkspace =
        entry.workspacesByLang[targetLang] ??
        Object.values(entry.workspacesByLang)[0];
      if (!loadedWorkspace) return;

      // Hydrate in-memory workspace & visual guide caches cleanly
      (Object.entries(entry.workspacesByLang) as Array<[LanguageCode, LectureWorkspace | undefined]>).forEach(
        ([langKey, ws]) => {
          if (ws) {
            workspaceCacheRef.current[buildWorkspaceCacheKey(ws.videoId, langKey)] = ws;
          }
        }
      );
      (Object.entries(entry.visualGuidesByLang ?? {}) as Array<[LanguageCode, VisualGuideData | undefined]>).forEach(
        ([langKey, vg]) => {
          if (vg) {
            visualGuideCacheRef.current[buildVisualGuideCacheKey(entry.videoId, langKey)] = vg;
          }
        }
      );

      setLanguage(targetLang);
      setWorkspace(loadedWorkspace);
      setUrlInput(loadedWorkspace.youtubeUrl);
      setUrlError(null);
      setShowTranscriptFallback(false);
      setSelectedNodeId(loadedWorkspace.nodes[0].id);
      setExpandedNodeIds([]);
      setActiveTimestampLabel(loadedWorkspace.nodes[0].timestampLabel);
      setSeekRequest((prev) => ({
        seconds: loadedWorkspace.nodes[0].timestampSeconds,
        nonce: prev.nonce + 1,
      }));
      setGroundingByNode({});
      setLibraryOpen(false);
      showToast(`Loaded "${loadedWorkspace.title}" instantly`);
    },
    [language, showToast]
  );

  const handleDeleteLibraryEntry = useCallback(
    (videoId: string) => {
      setLibraryItems((prev) => {
        const next = deleteLibraryItem(prev, videoId);
        saveLibraryToStorage(next);
        return next;
      });
      showToast('Removed video from saved library');
    },
    [showToast]
  );

  const handleShareLink = useCallback(async () => {
    if (isManualTranscriptWorkspace(workspace)) {
      showToast(
        'Transcript-only notes are stored locally — use Export Markdown or PDF to share them',
        'info'
      );
      return;
    }

    const shareUrl = new URL(window.location.href);
    shareUrl.searchParams.set('v', workspace.videoId);
    shareUrl.searchParams.set('t', String(selectedNode.timestampSeconds));
    shareUrl.searchParams.set('lang', language);

    try {
      window.history.replaceState(
        null,
        '',
        `${shareUrl.pathname}${shareUrl.search}${shareUrl.hash}`
      );
    } catch {
      // Ignore restricted history mutations in sandboxed frames
    }

    const copied = await copyTextWithFallback(shareUrl.toString());
    if (copied) {
      showToast('Share link copied to clipboard', 'success');
    } else {
      showToast(
        'Clipboard access blocked — copy the link from your browser address bar',
        'error'
      );
    }
  }, [workspace, selectedNode.timestampSeconds, language, showToast]);

  const handleFetchWebInsights = useCallback(async () => {
    setGroundingLoading(true);
    setGroundingError(null);

    try {
      const response = await apiFetch('/api/grounding/node', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeTitle: selectedNode.title,
          lectureTitle: workspace.title,
          keyPoints: selectedNode.keyPoints,
        }),
      });
      const data = await safeParseJsonResponse<GroundingInsight & { error?: string }>(response);

      if (!response.ok || !data?.summary) {
        setGroundingError(
          data?.error || 'Could not load Google Search insights right now.'
        );
        return;
      }

      setGroundingByNode((prev) => ({
        ...prev,
        [selectedNode.id]: data,
      }));
      showToast('Updated with live Google Search sources');
    } catch {
      setGroundingError(
        'Network error reaching Search Grounding endpoint. Local study notes remain active.'
      );
    } finally {
      setGroundingLoading(false);
    }
  }, [selectedNode, workspace.title, showToast]);

  const currentGroundingInsight = groundingByNode[selectedNode.id] ?? null;
  const isDemo = isDemoWorkspace(workspace);
  const isTranscriptOnly = isManualTranscriptWorkspace(workspace);
  const hasCachedVisualGuide = Boolean(
    visualGuideCacheRef.current[buildVisualGuideCacheKey(workspace.videoId, language)] ||
      libraryItems.find((item) => item.videoId === workspace.videoId)?.visualGuidesByLang?.[
        language
      ]
  );

  return (
    <>
      <div
        data-mindflow-app-shell="true"
        className="relative min-h-screen ambient-bg text-slate-100 flex flex-col"
      >
        {/* Desktop Top Floating Glass Navbar */}
        <DesktopNavbar
          urlInput={urlInput}
          urlError={urlError}
          showTranscriptFallback={showTranscriptFallback}
          activeTab={activeTab}
          language={language}
          isAnalyzing={isAnalyzing}
          isTranslating={isTranslating}
          libraryCount={libraryItems.length}
          chatOpen={chatOpen}
          accountUser={accountUser}
          accountUsage={accountUsage}
          onUrlChange={(val) => {
            setUrlInput(val);
            if (urlError) {
              setUrlError(null);
              setShowTranscriptFallback(false);
            }
          }}
          onUrlClear={() => {
            setUrlInput('');
            setUrlError(null);
            setShowTranscriptFallback(false);
          }}
          onUrlSubmit={() => runAnalysis()}
          onTabChange={setActiveTab}
          onLanguageChange={handleLanguageChange}
          onShareLink={handleShareLink}
          onOpenExport={() => setExportOpen(true)}
          onOpenLibrary={() => setLibraryOpen(true)}
          onOpenManualTranscript={() => setManualTranscriptOpen(true)}
          onToggleChat={() => setChatOpen((prev) => !prev)}
          onOpenAccount={() => setAccountOpen(true)}
        />

        {/* Mobile Top Header */}
        <MobileHeader
          urlOpen={mobileUrlOpen}
          urlInput={urlInput}
          urlError={urlError}
          showTranscriptFallback={showTranscriptFallback}
          language={language}
          isAnalyzing={isAnalyzing}
          isTranslating={isTranslating}
          libraryCount={libraryItems.length}
          accountUser={accountUser}
          accountUsage={accountUsage}
          onToggleUrlBar={() => setMobileUrlOpen((prev) => !prev)}
          onUrlChange={(val) => {
            setUrlInput(val);
            if (urlError) {
              setUrlError(null);
              setShowTranscriptFallback(false);
            }
          }}
          onUrlClear={() => {
            setUrlInput('');
            setUrlError(null);
            setShowTranscriptFallback(false);
          }}
          onUrlSubmit={() => runAnalysis()}
          onLanguageChange={handleLanguageChange}
          onOpenLibrary={() => setLibraryOpen(true)}
          onOpenAccount={() => setAccountOpen(true)}
          onOpenManualTranscript={() => setManualTranscriptOpen(true)}
        />

        <AuthModal
          open={accountOpen}
          user={accountUser}
          usage={accountUsage}
          onClose={() => setAccountOpen(false)}
          onAuthenticated={handleAuthenticated}
          onSignedOut={handleSignedOut}
        />

        {/* ==================== DESKTOP SPLIT-SCREEN WORKSPACE (lg+) ==================== */}
        {isDesktop ? (
          <main
            ref={desktopMainRef}
            className={`relative z-10 flex-1 w-full max-w-[1800px] mx-auto px-4 xl:px-5 pt-2 pb-4 flex items-stretch min-h-0 h-[calc(100vh-100px)] max-h-[calc(100vh-100px)] overflow-hidden ${
              isResizingPane ? 'select-none cursor-col-resize' : ''
            }`}
          >
            {/* Left Column (Resizable split panel) */}
            <aside
              style={{ width: `${chatOpen ? Math.min(leftPaneWidthPct, 31) : leftPaneWidthPct}%` }}
              className="min-w-[290px] xl:min-w-[330px] max-w-[520px] shrink-0 flex flex-col gap-3.5 min-h-0"
            >
              <YouTubePlayerCard
                videoId={workspace.videoId}
                title={workspace.title}
                channel={`${workspace.channel} · ${workspace.videoCategory}`}
                seekRequest={seekRequest}
                activeTimestampLabel={activeTimestampLabel}
                isDemo={isDemo}
              />

              <KeyTakeawaysCard
                node={selectedNode}
                language={language}
                isTranslating={isTranslating}
                collapsed={takeawaysCollapsed}
                isSimplified={isCurrentNodeSimplified}
                simplifiedText={currentSimplifiedText}
                simplifiedStructured={currentSimplifiedStructured}
                simplifyLoading={simplifyLoading}
                simplifyError={simplifyError}
                isGenerating={isAnalyzing}
                groundingInsight={currentGroundingInsight}
                groundingLoading={groundingLoading}
                groundingError={groundingError}
                onLanguageChange={handleLanguageChange}
                onToggleCollapse={() => setTakeawaysCollapsed((prev) => !prev)}
                onToggleSimplify={handleToggleSimplify}
                onJumpToTimestamp={(sec) => jumpVideoTo(sec)}
                onGenerateMindmap={() => runAnalysis()}
                onFetchWebInsights={handleFetchWebInsights}
              />
            </aside>

            {/* Subtle Accessible Desktop Split-Pane Resizer */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize video panel and workspace"
              aria-valuemin={25}
              aria-valuemax={44}
              aria-valuenow={Math.round(leftPaneWidthPct)}
              tabIndex={0}
              title="Drag to resize panels · Double-click to reset"
              onPointerDown={handleStartPaneResize}
              onDoubleClick={() => setLeftPaneWidthPct(33)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') {
                  e.preventDefault();
                  setLeftPaneWidthPct((p) => Math.max(25, p - 2));
                } else if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  setLeftPaneWidthPct((p) => Math.min(44, p + 2));
                }
              }}
              className="group w-3.5 shrink-0 flex items-center justify-center cursor-col-resize focus-visible:outline-none"
            >
              <span
                aria-hidden="true"
                className={`h-14 w-1 rounded-full transition-colors duration-150 ${
                  isResizingPane
                    ? 'bg-cyan-400/80'
                    : 'bg-white/[0.1] group-hover:bg-cyan-400/55 group-focus-visible:bg-cyan-400/80'
                }`}
              />
            </div>

            {/* Center/Right Primary Workspace + Optional Docked Ask AI Side Panel */}
            <div className="flex-1 min-w-0 min-h-0 flex gap-3.5">
              <section
                aria-label={`${activeTab} workspace`}
                className="flex-1 min-w-0 min-h-0"
              >
                {activeTab === 'mindmap' && (
                  <MindmapCanvas
                    nodes={workspace.nodes}
                    videoCategory={workspace.videoCategory}
                    durationLabel={workspace.durationLabel}
                    videoDurationSeconds={workspace.videoDurationSeconds}
                    coverageMode={workspace.coverageMode}
                    isDemo={isDemo}
                    isTranscriptOnly={isTranscriptOnly}
                    selectedNodeId={selectedNode.id}
                    expandedNodeIds={expandedNodeIds}
                    isAnalyzing={isAnalyzing}
                    analysisStep={analysisStep}
                    onSelectNode={handleSelectNode}
                    onToggleExpand={handleToggleExpand}
                    onToggleExpandAll={handleToggleExpandAll}
                    onCollapseAll={handleCollapseAll}
                  />
                )}

                {activeTab === 'cheatsheet' && (
                  <CheatSheetView
                    workspace={workspace}
                    isDemo={isDemo}
                    onJumpToTimestamp={(sec) => jumpVideoTo(sec)}
                    onNotify={showToast}
                    onOpenExport={() => setExportOpen(true)}
                  />
                )}

                {activeTab === 'script' && (
                  <ScriptView
                    sections={workspace.transcript}
                    durationLabel={workspace.durationLabel}
                    videoDurationSeconds={workspace.videoDurationSeconds}
                    coverageMode={workspace.coverageMode}
                    isDemo={isDemo}
                    hasCachedVisualGuide={hasCachedVisualGuide}
                    onJumpToTimestamp={(sec, nodeId) => jumpVideoTo(sec, nodeId)}
                    onNotify={showToast}
                    onOpenVisualPdfStudio={() => void handleOpenVisualPdfStudio(false)}
                  />
                )}
              </section>

              {/* Desktop Docked "Ask This Video" Panel (smoothly adapts workspace width without overlapping nodes) */}
              <VideoChatWidget
                open={chatOpen}
                mode="docked"
                workspace={workspace}
                language={language}
                onClose={() => setChatOpen(false)}
                onJumpToTimestamp={(sec) => jumpVideoTo(sec)}
              />
            </div>
          </main>
        ) : (
          /* ==================== MOBILE WORKSPACE (< lg) ==================== */
          <main className="relative z-10 flex-1 flex flex-col px-3.5 sm:px-5 pt-3 mf-mobile-main-pb gap-3.5 max-w-4xl w-full mx-auto">
            {/* Sticky YouTube Player with Minimize Toggle */}
            <div className="sticky top-[56px] z-20">
              <YouTubePlayerCard
                videoId={workspace.videoId}
                title={workspace.title}
                channel={workspace.channel}
                seekRequest={seekRequest}
                activeTimestampLabel={activeTimestampLabel}
                isDemo={isDemo}
                collapsible
                minimized={mobilePlayerMinimized}
                onToggleMinimize={() => setMobilePlayerMinimized((prev) => !prev)}
              />
            </div>

            {/* Mobile Main Active Tab Content */}
            <div className="flex-1 min-h-0">
              {activeTab === 'mindmap' && (
                <MindmapCanvas
                  nodes={workspace.nodes}
                  videoCategory={workspace.videoCategory}
                  durationLabel={workspace.durationLabel}
                  videoDurationSeconds={workspace.videoDurationSeconds}
                  coverageMode={workspace.coverageMode}
                  isDemo={isDemo}
                  isTranscriptOnly={isTranscriptOnly}
                  selectedNodeId={selectedNode.id}
                  expandedNodeIds={expandedNodeIds}
                  isAnalyzing={isAnalyzing}
                  analysisStep={analysisStep}
                  onSelectNode={handleSelectNode}
                  onToggleExpand={handleToggleExpand}
                  onToggleExpandAll={handleToggleExpandAll}
                  onCollapseAll={handleCollapseAll}
                />
              )}

              {activeTab === 'cheatsheet' && (
                <CheatSheetView
                  workspace={workspace}
                  isDemo={isDemo}
                  onJumpToTimestamp={(sec) => jumpVideoTo(sec)}
                  onNotify={showToast}
                  onOpenExport={() => setExportOpen(true)}
                />
              )}

              {activeTab === 'script' && (
                <ScriptView
                  sections={workspace.transcript}
                  durationLabel={workspace.durationLabel}
                  videoDurationSeconds={workspace.videoDurationSeconds}
                  coverageMode={workspace.coverageMode}
                  isDemo={isDemo}
                  hasCachedVisualGuide={hasCachedVisualGuide}
                  onJumpToTimestamp={(sec, nodeId) => jumpVideoTo(sec, nodeId)}
                  onNotify={showToast}
                  onOpenVisualPdfStudio={() => void handleOpenVisualPdfStudio(false)}
                />
              )}
            </div>
          </main>
        )}

        {/* Mobile Bottom-Sheet Drawer */}
        <MobileNodeDrawer
          open={mobileDrawerOpen}
          node={selectedNode}
          isSimplified={isCurrentNodeSimplified}
          simplifiedText={currentSimplifiedText}
          simplifiedStructured={currentSimplifiedStructured}
          simplifyLoading={simplifyLoading}
          simplifyError={simplifyError}
          groundingInsight={currentGroundingInsight}
          groundingLoading={groundingLoading}
          groundingError={groundingError}
          onClose={() => setMobileDrawerOpen(false)}
          onJumpToTimestamp={(sec) => jumpVideoTo(sec)}
          onToggleSimplify={handleToggleSimplify}
          onFetchWebInsights={handleFetchWebInsights}
        />

        {/* Mobile Safe-Area Bottom Navigation Bar (includes integrated Ask AI) */}
        <MobileBottomNav
          activeTab={activeTab}
          chatOpen={chatOpen}
          onTabChange={(tab) => {
            setChatOpen(false);
            setActiveTab(tab);
          }}
          onToggleChat={() => setChatOpen((prev) => !prev)}
          onOpenExport={() => setExportOpen(true)}
        />

        {/* Mobile "Ask This Video" Responsive Bottom Sheet */}
        {!isDesktop && (
          <VideoChatWidget
            open={chatOpen}
            mode="mobile-sheet"
            workspace={workspace}
            language={language}
            onClose={() => setChatOpen(false)}
            onJumpToTimestamp={(sec) => jumpVideoTo(sec)}
          />
        )}

        {/* Lazy-loaded Modals & Saved Library Drawer */}
        <Suspense fallback={null}>
          {exportOpen && (
            <ExportModal
              open={exportOpen}
              workspace={workspace}
              onClose={() => setExportOpen(false)}
              onNotify={showToast}
              onOpenVisualPdfStudio={() => void handleOpenVisualPdfStudio(false)}
            />
          )}

          {manualTranscriptOpen && (
            <ManualTranscriptModal
              open={manualTranscriptOpen}
              isAnalyzing={isAnalyzing}
              onClose={() => setManualTranscriptOpen(false)}
              onSubmitTranscript={({ transcript, optionalYouTubeUrl }) =>
                runAnalysis({
                  manualTranscript: transcript,
                  optionalYouTubeUrl,
                })
              }
            />
          )}

          {libraryOpen && (
            <LibraryDrawer
              open={libraryOpen}
              items={libraryItems}
              activeVideoId={workspace.videoId}
              storageNotice={libraryStorageNotice}
              onClose={() => setLibraryOpen(false)}
              onSelectEntry={handleSelectLibraryEntry}
              onDeleteEntry={handleDeleteLibraryEntry}
            />
          )}
        </Suspense>

        {/* Toast Notification (truthful severity styling for success / error / info) */}
        {toast && (
          <div
            role={toast.variant === 'error' ? 'alert' : 'status'}
            aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
            data-testid="mindflow-toast"
            data-toast-variant={toast.variant}
            className={`fixed bottom-24 lg:bottom-6 left-1/2 -translate-x-1/2 z-[60] max-w-[92vw] inline-flex items-center gap-2.5 rounded-xl mf-modal-surface backdrop-blur-md px-4 py-2.5 text-[13px] font-medium text-white mf-animate-fade ${
              toast.variant === 'error'
                ? 'border-rose-400/45'
                : toast.variant === 'info'
                  ? 'border-cyan-400/40'
                  : 'border-white/16'
            }`}
          >
            {toast.variant === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" aria-hidden="true" />
            ) : toast.variant === 'info' ? (
              <Info className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
            )}
            <span className="leading-snug">{toast.message}</span>
          </div>
        )}

        <footer className="relative z-10 mt-auto px-4 pb-2 pt-1 text-center text-[11px] font-medium tracking-wide text-slate-500">
          Built by Shrey <span className="mx-1.5 text-slate-700">·</span> MindFlow AI
        </footer>
      </div>

      {/* Print-Isolated Visual PDF Guide Studio Modal (lazy-loaded with jsPDF) */}
      <Suspense fallback={null}>
        {visualStudioOpen && (
          <VisualPdfStudioModal
            open={visualStudioOpen}
            guide={activeVisualGuide}
            language={language}
            isLoading={visualGuideLoading}
            error={visualGuideError}
            onClose={() => setVisualStudioOpen(false)}
            onRetry={(opts) => void handleOpenVisualPdfStudio(true, opts)}
            onGenerateLongGuide={(opts) => void handleOpenVisualPdfStudio(true, opts)}
            onNotify={showToast}
          />
        )}
      </Suspense>
    </>
  );
}
