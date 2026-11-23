import {
  memo,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Crosshair,
  GitBranch,
  Loader2,
  Maximize2,
  Minimize2,
  Play,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  MindmapNode,
  MindmapSubNode,
  NodeAccent,
  VideoCoverageMode,
} from '../types/mindflow';
import {
  clampZoom,
  computeDynamicMindmapLayout,
  computeWheelZoomDelta,
  MAIN_WIDTH,
  ROOT_WIDTH,
  shouldZoomOnWheel,
  SUB_WIDTH,
  ZOOM_STEP,
} from '../utils/mindmapMath';
import { formatSecondsToTimestamp } from '../utils/youtube';
import { NodeIcon } from './NodeIcon';

interface MindmapCanvasProps {
  nodes: MindmapNode[];
  videoCategory: string;
  durationLabel?: string;
  videoDurationSeconds?: number;
  coverageMode?: VideoCoverageMode;
  isDemo?: boolean;
  isTranscriptOnly?: boolean;
  selectedNodeId: string;
  expandedNodeIds: string[];
  isAnalyzing: boolean;
  analysisStep: string;
  onSelectNode: (
    node: MindmapNode | MindmapSubNode,
    options?: { openMobileDrawer?: boolean }
  ) => void;
  onToggleExpand: (nodeId: string) => void;
  onToggleExpandAll?: () => void;
  onCollapseAll?: () => void;
}

const NODE_THEME: Record<
  NodeAccent,
  {
    idleBorder: string;
    activeBorder: string;
    activeGlow: string;
    iconBox: string;
    timestamp: string;
    pillClass: string;
    gradStart: string;
    gradEnd: string;
  }
> = {
  root: {
    idleBorder: 'border-violet-400/35 hover:border-violet-400/60',
    activeBorder: 'border-cyan-400/85 ring-2 ring-cyan-400/25',
    activeGlow: 'shadow-[0_0_26px_rgba(124,58,237,0.3)]',
    iconBox: 'bg-gradient-to-br from-violet-500 to-cyan-400 text-white',
    timestamp: 'text-cyan-300',
    pillClass: 'bg-violet-500/15 text-violet-200 border-violet-400/30',
    gradStart: '#a78bfa',
    gradEnd: '#22d3ee',
  },
  violet: {
    idleBorder: 'border-white/[0.1] hover:border-violet-400/50',
    activeBorder: 'border-violet-400/85 ring-2 ring-violet-400/25',
    activeGlow: 'shadow-[0_0_22px_rgba(139,92,246,0.28)]',
    iconBox: 'bg-violet-500/16 text-violet-300 border border-violet-400/25',
    timestamp: 'text-violet-300',
    pillClass: 'bg-violet-500/14 hover:bg-violet-500/24 text-violet-200 border-violet-400/28',
    gradStart: '#8b5cf6',
    gradEnd: '#c084fc',
  },
  cyan: {
    idleBorder: 'border-white/[0.1] hover:border-cyan-400/50',
    activeBorder: 'border-cyan-400/85 ring-2 ring-cyan-400/25',
    activeGlow: 'shadow-[0_0_22px_rgba(34,211,238,0.24)]',
    iconBox: 'bg-cyan-500/16 text-cyan-300 border border-cyan-400/25',
    timestamp: 'text-cyan-300',
    pillClass: 'bg-cyan-500/14 hover:bg-cyan-500/24 text-cyan-200 border-cyan-400/28',
    gradStart: '#818cf8',
    gradEnd: '#22d3ee',
  },
  emerald: {
    idleBorder: 'border-white/[0.1] hover:border-emerald-400/50',
    activeBorder: 'border-emerald-400/85 ring-2 ring-emerald-400/25',
    activeGlow: 'shadow-[0_0_22px_rgba(16,185,129,0.24)]',
    iconBox: 'bg-emerald-500/16 text-emerald-300 border border-emerald-400/25',
    timestamp: 'text-emerald-300',
    pillClass: 'bg-emerald-500/14 hover:bg-emerald-500/24 text-emerald-200 border-emerald-400/28',
    gradStart: '#6366f1',
    gradEnd: '#34d399',
  },
  indigo: {
    idleBorder: 'border-white/[0.1] hover:border-indigo-400/50',
    activeBorder: 'border-indigo-400/85 ring-2 ring-indigo-400/25',
    activeGlow: 'shadow-[0_0_22px_rgba(99,102,241,0.26)]',
    iconBox: 'bg-indigo-500/16 text-indigo-300 border border-indigo-400/25',
    timestamp: 'text-indigo-300',
    pillClass: 'bg-indigo-500/14 hover:bg-indigo-500/24 text-indigo-200 border-indigo-400/28',
    gradStart: '#a855f7',
    gradEnd: '#60a5fa',
  },
};

const COVERAGE_BADGE_LABELS: Record<VideoCoverageMode, string> = {
  'full-transcript': 'Full Transcript',
  'timeline-sampled': '0%–100% Sampled',
  'chapters-metadata': 'Chapters + Metadata',
};

export const MindmapCanvas = memo(function MindmapCanvas({
  nodes,
  videoCategory,
  durationLabel,
  videoDurationSeconds,
  coverageMode,
  isDemo = false,
  isTranscriptOnly = false,
  selectedNodeId,
  expandedNodeIds,
  isAnalyzing,
  analysisStep,
  onSelectNode,
  onToggleExpand,
  onToggleExpandAll,
  onCollapseAll,
}: MindmapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const mobileTopRef = useRef<HTMLDivElement | null>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 920, height: 620 });

  const dragOriginRef = useRef<{
    pointerX: number;
    pointerY: number;
    panX: number;
    panY: number;
    moved: boolean;
  } | null>(null);

  const layout = useMemo(
    () => computeDynamicMindmapLayout(nodes, expandedNodeIds),
    [nodes, expandedNodeIds]
  );

  // Measure actual stage dimensions so auto-fit centers any 2- or 3-level tree cleanly
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const updateSize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) {
        setStageSize((prev) =>
          prev.width === w && prev.height === h ? prev : { width: w, height: h }
        );
      }
    };

    updateSize();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateSize);
      observer.observe(el);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Dynamically auto-fit zoom to actual stage width/height so 3-level trees never clip edges
  useEffect(() => {
    const fitW = (stageSize.width - 48) / layout.width;
    const fitH = (stageSize.height - 108) / layout.height;
    const maxScale = expandedNodeIds.length > 0 ? 0.94 : 1;
    setZoom(clampZoom(Math.min(maxScale, fitW, fitH)));
    setPan({ x: 0, y: 0 });
  }, [expandedNodeIds.length, layout.width, layout.height, stageSize.width, stageSize.height]);

  const rootNode = useMemo(
    () => nodes.find((n) => n.isRoot) ?? nodes[0],
    [nodes]
  );
  const childNodes = useMemo(
    () => nodes.filter((n) => n.id !== rootNode?.id),
    [nodes, rootNode?.id]
  );
  const totalSubtopics = useMemo(
    () => childNodes.reduce((sum, n) => sum + (n.subNodes?.length ?? 0), 0),
    [childNodes]
  );
  const timelineEndLabel = useMemo(() => {
    if (videoDurationSeconds && videoDurationSeconds > 0) {
      return formatSecondsToTimestamp(videoDurationSeconds);
    }
    if (durationLabel && /^\d{1,2}:\d{2}(?::\d{2})?$/.test(durationLabel.trim())) {
      return durationLabel.trim();
    }
    const maxSec = Math.max(
      0,
      ...nodes.map((n) => n.timestampSeconds),
      ...nodes.flatMap((n) => (n.subNodes ?? []).map((s) => s.timestampSeconds))
    );
    return maxSec > 0 ? formatSecondsToTimestamp(maxSec) : durationLabel || '00:00';
  }, [videoDurationSeconds, durationLabel, nodes]);

  const handleZoomIn = useCallback(() => {
    setZoom((prev) => clampZoom(prev + ZOOM_STEP));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => clampZoom(prev - ZOOM_STEP));
  }, []);

  const handleFitToScreen = useCallback(() => {
    const fitW = (stageSize.width - 48) / layout.width;
    const fitH = (stageSize.height - 108) / layout.height;
    setZoom(clampZoom(Math.min(1, fitW, fitH)));
    setPan({ x: 0, y: 0 });
  }, [layout.width, layout.height, stageSize.width, stageSize.height]);

  const handleResetZoom100 = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleToggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;

    try {
      if (!document.fullscreenElement && !isFullscreen) {
        if (el.requestFullscreen) {
          await el.requestFullscreen();
        }
        setIsFullscreen(true);
      } else {
        if (document.fullscreenElement && document.exitFullscreen) {
          await document.exitFullscreen();
        }
        setIsFullscreen(false);
      }
    } catch {
      setIsFullscreen((prev) => !prev);
    }
  }, [isFullscreen]);

  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isFullscreen]);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragOriginRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      panX: pan.x,
      panY: pan.y,
      moved: false,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const origin = dragOriginRef.current;
    if (!origin) return;
    const dx = e.clientX - origin.pointerX;
    const dy = e.clientY - origin.pointerY;
    if (Math.hypot(dx, dy) > 5) {
      origin.moved = true;
    }
    setPan({ x: origin.panX + dx, y: origin.panY + dy });
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragOriginRef.current) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore if not captured
      }
    }
    dragOriginRef.current = null;
    setIsDragging(false);
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onNativeWheel = (e: WheelEvent) => {
      if (!shouldZoomOnWheel(e)) {
        return;
      }
      e.preventDefault();
      const delta = computeWheelZoomDelta(e.deltaY, e.deltaMode);
      if (delta !== 0) {
        setZoom((prev) => clampZoom(prev + delta));
      }
    };

    el.addEventListener('wheel', onNativeWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onNativeWheel);
    };
  }, []);

  const handleCanvasKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== containerRef.current) return;
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      handleZoomIn();
    } else if (e.key === '-') {
      e.preventDefault();
      handleZoomOut();
    } else if (e.key === '0') {
      e.preventDefault();
      handleFitToScreen();
    } else if (e.key === '1') {
      e.preventDefault();
      handleResetZoom100();
    }
  };

  const handleMobileRecenter = () => {
    if (rootNode) {
      onSelectNode(rootNode, { openMobileDrawer: false });
    }
    mobileTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const expandedSet = useMemo(() => new Set(expandedNodeIds), [expandedNodeIds]);
  const expandableIds = useMemo(
    () => childNodes.filter((n) => (n.subNodes?.length ?? 0) > 0).map((n) => n.id),
    [childNodes]
  );
  const allBranchesExpanded =
    expandableIds.length > 0 && expandableIds.every((id) => expandedSet.has(id));
  const anyBranchesExpanded = expandedNodeIds.length > 0;

  // Identify the expandable branch owning the currently selected node (if any)
  const selectedExpandableBranch = useMemo(() => {
    const direct = childNodes.find(
      (n) => n.id === selectedNodeId && (n.subNodes?.length ?? 0) > 0
    );
    if (direct) return direct;
    return childNodes.find((n) =>
      (n.subNodes ?? []).some((s) => s.id === selectedNodeId)
    );
  }, [childNodes, selectedNodeId]);

  const selectedBranchExpanded = selectedExpandableBranch
    ? expandedSet.has(selectedExpandableBranch.id)
    : false;

  return (
    <>
      {/* ==================== DESKTOP INTERACTIVE 3-LEVEL CANVAS ==================== */}
      <div
        ref={containerRef}
        tabIndex={0}
        role="region"
        aria-label="Interactive mindmap canvas (hold Ctrl or Cmd while scrolling to zoom, or press +, -, 0 to fit, 1 for 100%)"
        data-testid="desktop-mindmap-canvas"
        onKeyDown={handleCanvasKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`hidden lg:flex relative flex-col w-full h-full min-h-[560px] rounded-2xl mindmap-dot-grid bg-[#070b17]/92 border border-white/[0.09] overflow-hidden select-none ${
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        } ${isFullscreen ? 'fixed inset-4 z-50 h-auto rounded-3xl shadow-2xl' : ''}`}
      >
        {/* Multi-Step Analysis Loading Overlay */}
        {isAnalyzing && (
          <div
            data-testid="analysis-loading-overlay"
            className="absolute inset-0 z-30 flex items-center justify-center bg-[#060914]/84 backdrop-blur-sm mf-animate-fade"
          >
            <div className="rounded-2xl mf-modal-surface px-7 py-6 text-center max-w-sm space-y-3">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-cyan-400">
                <Loader2 className="w-6 h-6 text-white animate-spin" aria-hidden="true" />
              </div>
              <p className="font-display text-[15px] font-semibold text-white">
                {analysisStep || 'Analyzing video concepts...'}
              </p>
              <p className="text-sm text-slate-400 leading-relaxed">
                Building 3-level mindmap, executive summary, cheat sheet &amp; timestamps
              </p>
            </div>
          </div>
        )}

        {/* Top-Right Floating Controls: Selected Branch, Expand/Collapse All, Fit, Zoom Out / 100% / Zoom In, Fullscreen */}
        <div className="absolute top-3.5 right-3.5 z-20 flex flex-wrap items-center justify-end gap-1 rounded-xl bg-[#0a0f1f]/92 backdrop-blur-md border border-white/[0.11] p-1 shadow-lg shadow-black/45 max-w-[calc(100%-2rem)]">
          {selectedExpandableBranch && (
            <>
              <button
                type="button"
                data-testid="mindmap-expand-selected-btn"
                onClick={() => onToggleExpand(selectedExpandableBranch.id)}
                aria-pressed={selectedBranchExpanded}
                title={
                  selectedBranchExpanded
                    ? `Collapse "${selectedExpandableBranch.title}"`
                    : `Expand "${selectedExpandableBranch.title}" branch`
                }
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-cyan-200 hover:text-white hover:bg-cyan-500/15 transition-colors cursor-pointer whitespace-nowrap"
              >
                <GitBranch className="w-3.5 h-3.5 text-cyan-300" aria-hidden="true" />
                <span>{selectedBranchExpanded ? 'Hide Branch' : 'Expand Branch'}</span>
              </button>
              <div className="h-4 w-px bg-white/10" aria-hidden="true" />
            </>
          )}

          {onToggleExpandAll && expandableIds.length > 0 && (
            <>
              <button
                type="button"
                data-testid="mindmap-expand-all-btn"
                onClick={onToggleExpandAll}
                aria-pressed={allBranchesExpanded}
                aria-label={allBranchesExpanded ? 'Collapse all subtopics' : 'Expand all subtopics'}
                title={allBranchesExpanded ? 'Collapse all subtopics' : 'Expand all subtopics'}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-slate-200 hover:text-white hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap"
              >
                {allBranchesExpanded ? (
                  <>
                    <ChevronsDownUp className="w-3.5 h-3.5 text-violet-300" aria-hidden="true" />
                    <span>Collapse All</span>
                  </>
                ) : (
                  <>
                    <ChevronsUpDown className="w-3.5 h-3.5 text-cyan-300" aria-hidden="true" />
                    <span>Expand All</span>
                  </>
                )}
              </button>
              {!allBranchesExpanded && anyBranchesExpanded && onCollapseAll && (
                <button
                  type="button"
                  data-testid="mindmap-collapse-all-btn"
                  onClick={onCollapseAll}
                  aria-label="Collapse expanded branches"
                  title="Collapse all expanded branches"
                  className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <ChevronsDownUp className="w-3.5 h-3.5 text-violet-300" aria-hidden="true" />
                  <span>Collapse</span>
                </button>
              )}
              <div className="h-4 w-px bg-white/10" aria-hidden="true" />
            </>
          )}

          <button
            type="button"
            data-testid="mindmap-fit-btn"
            onClick={handleFitToScreen}
            aria-label="Fit mindmap to screen"
            title="Fit to screen (0)"
            className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <Crosshair className="w-3.5 h-3.5 text-cyan-300" aria-hidden="true" />
            <span className="hidden xl:inline">Fit</span>
          </button>

          <div className="h-4 w-px bg-white/10" aria-hidden="true" />

          <button
            type="button"
            onClick={handleZoomOut}
            aria-label="Zoom out mindmap"
            title="Zoom out (-)"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <ZoomOut className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            data-testid="mindmap-zoom-level"
            onClick={handleResetZoom100}
            aria-label="Reset zoom to 100%"
            title="Reset zoom to 100% (1)"
            className="px-2 h-8 rounded-lg font-mono tabular-nums text-xs font-medium text-slate-200 hover:text-white hover:bg-white/10 min-w-[48px] text-center transition-colors cursor-pointer"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={handleZoomIn}
            aria-label="Zoom in mindmap"
            title="Zoom in (+)"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <ZoomIn className="w-4 h-4" aria-hidden="true" />
          </button>

          <div className="h-4 w-px bg-white/10" aria-hidden="true" />

          <button
            type="button"
            onClick={handleToggleFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen mindmap' : 'Fullscreen mindmap'}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            {isFullscreen ? (
              <Minimize2 className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Maximize2 className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        </div>

        {/* Interactive Pan/Zoom Stage (mathematically centered regardless of expanded width) */}
        <div ref={stageRef} className="relative flex-1 overflow-hidden">
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: layout.width,
              height: layout.height,
              transform: `translate3d(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px), 0) scale(${zoom})`,
              transformOrigin: 'center center',
            }}
            className={
              isDragging ? '' : 'transition-transform duration-200 ease-out'
            }
          >
            {/* Glowing Curved SVG Bezier Connectors (Root->Main AND Main->Sub) */}
            <svg
              width={layout.width}
              height={layout.height}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              className="pointer-events-none absolute inset-0 overflow-visible"
              aria-hidden="true"
            >
              <defs>
                <filter id="mindflow-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="2.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                {layout.edges.map((edge) => {
                  const theme = NODE_THEME[edge.accent];
                  return (
                    <linearGradient
                      key={`grad-${edge.id}`}
                      id={`grad-${edge.id}`}
                      x1="0%"
                      y1="0%"
                      x2="100%"
                      y2="100%"
                    >
                      <stop offset="0%" stopColor={theme.gradStart} />
                      <stop offset="100%" stopColor={theme.gradEnd} />
                    </linearGradient>
                  );
                })}
              </defs>

              {layout.edges.map((edge) => {
                const isActive =
                  selectedNodeId === edge.targetId || selectedNodeId === edge.sourceId;
                const theme = NODE_THEME[edge.accent];
                return (
                  <g key={edge.id}>
                    {isActive && (
                      <path
                        d={edge.path}
                        fill="none"
                        stroke={`url(#grad-${edge.id})`}
                        strokeWidth={edge.isSubEdge ? 3.5 : 4.5}
                        strokeOpacity={0.26}
                        strokeLinecap="round"
                        filter="url(#mindflow-glow)"
                      />
                    )}
                    <path
                      d={edge.path}
                      fill="none"
                      stroke={`url(#grad-${edge.id})`}
                      strokeWidth={edge.isSubEdge ? 1.7 : isActive ? 2.6 : 1.7}
                      strokeOpacity={isActive ? 0.96 : edge.isSubEdge ? 0.56 : 0.48}
                      strokeDasharray={edge.isSubEdge ? '5 3' : undefined}
                      strokeLinecap="round"
                    />
                    <circle
                      cx={edge.start.x}
                      cy={edge.start.y}
                      r={2.5}
                      fill={theme.gradStart}
                      fillOpacity={isActive ? 0.98 : 0.65}
                    />
                    <circle
                      cx={edge.end.x}
                      cy={edge.end.y}
                      r={2.5}
                      fill={theme.gradEnd}
                      fillOpacity={isActive ? 0.98 : 0.65}
                    />
                  </g>
                );
              })}
            </svg>

            {/* Level 1: Central Root Node */}
            {layout.root && (
              <button
                type="button"
                aria-pressed={selectedNodeId === layout.root.node.id}
                aria-label={`${layout.root.node.title} at ${layout.root.node.timestampLabel}`}
                onClick={() => onSelectNode(layout.root!.node)}
                style={{
                  left: layout.root.x,
                  top: layout.root.y,
                  width: ROOT_WIDTH,
                }}
                className={`group absolute -translate-x-1/2 -translate-y-1/2 text-left rounded-2xl border bg-gradient-to-br from-[#171636] via-[#0e142a] to-[#0c1d2e] px-5 py-4 transition-all duration-150 cursor-pointer ${
                  selectedNodeId === layout.root.node.id
                    ? `${NODE_THEME.root.activeBorder} ${NODE_THEME.root.activeGlow} scale-[1.02] z-10`
                    : `${NODE_THEME.root.idleBorder}`
                }`}
              >
                <div className="flex items-start justify-between gap-2.5">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${NODE_THEME.root.iconBox}`}
                  >
                    <NodeIcon name={layout.root.node.icon} className="w-4 h-4" />
                  </span>
                  <span className="inline-flex items-center gap-1 font-mono tabular-nums text-xs font-medium text-cyan-300">
                    <Play className="w-2.5 h-2.5 fill-current" aria-hidden="true" />
                    <span>{layout.root.node.timestampLabel}</span>
                  </span>
                </div>
                <p className="mt-2.5 font-display text-[15px] font-semibold tracking-[0.01em] text-white leading-snug">
                  {layout.root.node.title}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-300/85 line-clamp-2">
                  {layout.root.node.shortSubtitle}
                </p>
              </button>
            )}

            {/* Level 2: Main Topic Nodes (with expandable Sub-Node toggles) */}
            {layout.mains.map(({ node, x, y }) => {
              const isSelected = node.id === selectedNodeId;
              const isExpanded = expandedSet.has(node.id);
              const subCount = node.subNodes?.length ?? 0;
              const theme = NODE_THEME[node.accent];

              return (
                <div
                  key={node.id}
                  style={{ left: x, top: y, width: MAIN_WIDTH }}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-[#0b1122] transition-all duration-150 ${
                    isSelected
                      ? `${theme.activeBorder} ${theme.activeGlow} scale-[1.015] z-10`
                      : `${theme.idleBorder}`
                  }`}
                >
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={`${node.title} at ${node.timestampLabel}`}
                    onClick={() => onSelectNode(node)}
                    className="w-full text-left px-4 pt-3.5 pb-2.5 cursor-pointer rounded-t-2xl"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${theme.iconBox}`}
                      >
                        <NodeIcon name={node.icon} className="w-3.5 h-3.5" />
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 font-mono tabular-nums text-xs font-medium ${theme.timestamp}`}
                      >
                        <Play className="w-2.5 h-2.5 fill-current" aria-hidden="true" />
                        <span>{node.timestampLabel}</span>
                      </span>
                    </div>

                    <p className="mt-2 font-display text-sm font-semibold tracking-[0.01em] text-white leading-snug">
                      {node.title}
                    </p>
                    <p className="mt-1 text-xs leading-snug text-slate-400 line-clamp-2">
                      {node.shortSubtitle}
                    </p>
                  </button>

                  {subCount > 0 && (
                    <div className="px-4 pb-2.5 pt-1.5 flex items-center justify-between border-t border-white/[0.06]">
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${subCount} subtopics for ${node.title}`}
                        onClick={() => {
                          onSelectNode(node);
                          onToggleExpand(node.id);
                        }}
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors cursor-pointer ${theme.pillClass}`}
                      >
                        <span>{isExpanded ? 'Hide types' : `+${subCount} types`}</span>
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Level 3: Expanded Sub-Nodes */}
            {layout.subs.map(({ subNode, x, y }) => {
              const isSelected = subNode.id === selectedNodeId;
              const theme = NODE_THEME[subNode.accent];

              return (
                <button
                  key={subNode.id}
                  type="button"
                  data-testid={`subnode-${subNode.id}`}
                  aria-pressed={isSelected}
                  aria-label={`${subNode.title} subtopic at ${subNode.timestampLabel}`}
                  onClick={() => onSelectNode(subNode)}
                  style={{ left: x, top: y, width: SUB_WIDTH }}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 text-left rounded-xl border bg-[#0c1225] hover:bg-[#111933] px-3.5 py-2.5 transition-all duration-150 cursor-pointer ${
                    isSelected
                      ? `${theme.activeBorder} ${theme.activeGlow} scale-[1.02] z-20`
                      : `${theme.idleBorder}`
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-slate-400">
                      Subtopic
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 font-mono tabular-nums text-xs ${theme.timestamp}`}
                    >
                      <Play className="w-2 h-2 fill-current" aria-hidden="true" />
                      <span>{subNode.timestampLabel}</span>
                    </span>
                  </div>
                  <p className="mt-1 font-display text-[13px] font-semibold tracking-[0.01em] text-white leading-snug truncate">
                    {subNode.title}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400 truncate">
                    {subNode.shortSubtitle}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Bottom-Left Unified Metadata Bar */}
        <div className="pointer-events-none absolute left-4 bottom-3.5 right-4 z-20 flex items-center justify-between gap-3">
          <div
            data-testid="mindmap-coverage-pill"
            className="inline-flex items-center gap-2 rounded-lg bg-[#0a0f1f]/92 backdrop-blur-md border border-white/[0.09] px-3 py-1.5 text-xs text-slate-300 max-w-full overflow-hidden"
          >
            {isDemo && (
              <>
                <span
                  data-testid="demo-badge-canvas"
                  className="rounded bg-amber-400/12 border border-amber-400/25 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-200 shrink-0"
                >
                  DEMO
                </span>
                <span className="text-slate-600" aria-hidden="true">·</span>
              </>
            )}
            {!isDemo && isTranscriptOnly && (
              <>
                <span
                  data-testid="transcript-badge-canvas"
                  className="rounded bg-violet-500/15 border border-violet-400/30 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-violet-200 shrink-0"
                >
                  TRANSCRIPT
                </span>
                <span className="text-slate-600" aria-hidden="true">·</span>
              </>
            )}
            <span className="font-medium text-slate-200 whitespace-nowrap">
              {childNodes.length} {childNodes.length === 1 ? 'Module' : 'Modules'}
              {totalSubtopics > 0 ? ` · ${totalSubtopics} Topics` : ''}
            </span>
            <span className="text-slate-600" aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-cyan-300/90 whitespace-nowrap">
              00:00 → {timelineEndLabel}
            </span>
            <span className="hidden xl:inline text-slate-600" aria-hidden="true">·</span>
            <span className="hidden xl:inline text-slate-400 truncate">
              {videoCategory}
              {coverageMode ? ` · ${COVERAGE_BADGE_LABELS[coverageMode]}` : ''}
            </span>
          </div>

          <span className="hidden 2xl:inline-flex items-center rounded-lg bg-[#0a0f1f]/85 border border-white/[0.08] px-2.5 py-1.5 text-xs text-slate-400 whitespace-nowrap">
            Drag to pan · Ctrl + scroll to zoom
          </span>
        </div>
      </div>

      {/* ==================== MOBILE TOUCH-FRIENDLY 3-LEVEL VERTICAL TREE ==================== */}
      <div
        ref={mobileTopRef}
        data-testid="mobile-mindmap-tree"
        className="flex lg:hidden relative flex-col rounded-2xl mindmap-dot-grid bg-[#070b17]/92 border border-white/[0.09] px-4 pt-4 pb-6 overflow-hidden"
      >
        {isAnalyzing && (
          <div className="mb-4 rounded-2xl bg-[#0b1126]/95 border border-cyan-400/30 p-4 flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-cyan-300 animate-spin shrink-0" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-white">
                {analysisStep || 'Analyzing video concepts...'}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                Building 3-level mindmap &amp; study notes
              </p>
            </div>
          </div>
        )}

        {/* Mobile Tree Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3.5">
          <p className="text-xs font-medium text-slate-400">
            Tap any node to inspect notes
          </p>
          <div className="flex items-center gap-1.5">
            {onToggleExpandAll && expandableIds.length > 0 && (
              <button
                type="button"
                onClick={onToggleExpandAll}
                className="inline-flex items-center gap-1 rounded-full bg-[#0a0f1f]/90 border border-white/12 px-3 py-1.5 min-h-[38px] text-xs font-semibold text-slate-200 hover:text-white cursor-pointer active:scale-95 transition-transform shrink-0"
              >
                {allBranchesExpanded ? (
                  <>
                    <ChevronsDownUp className="w-3.5 h-3.5 text-violet-300" aria-hidden="true" />
                    <span>Collapse</span>
                  </>
                ) : (
                  <>
                    <ChevronsUpDown className="w-3.5 h-3.5 text-cyan-300" aria-hidden="true" />
                    <span>Expand All</span>
                  </>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={handleMobileRecenter}
              aria-label="Recenter mindmap tree"
              className="inline-flex items-center gap-1.5 rounded-full bg-[#0a0f1f]/90 border border-white/12 px-3 py-1.5 min-h-[38px] text-xs font-semibold text-slate-200 hover:text-white cursor-pointer active:scale-95 transition-transform shrink-0"
            >
              <Crosshair className="w-3.5 h-3.5 text-cyan-300" aria-hidden="true" />
              <span>Top</span>
            </button>
          </div>
        </div>

        {/* Central Root Node */}
        {rootNode && (
          <div className="relative z-10">
            <button
              type="button"
              aria-pressed={selectedNodeId === rootNode.id}
              aria-label={`${rootNode.title} at ${rootNode.timestampLabel}`}
              onClick={() => onSelectNode(rootNode, { openMobileDrawer: true })}
              className={`w-full text-left rounded-2xl bg-gradient-to-br from-[#171636] via-[#0e142a] to-[#0c1d2e] border px-4 py-3.5 min-h-[68px] transition-colors duration-150 cursor-pointer active:scale-[0.99] ${
                selectedNodeId === rootNode.id
                  ? 'border-cyan-400/80 ring-2 ring-cyan-400/20 shadow-[0_0_20px_rgba(124,58,237,0.25)]'
                  : 'border-violet-400/35'
              }`}
            >
              <div className="flex items-start justify-between gap-2.5">
                <div className="flex items-start gap-3 min-w-0">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-cyan-400 text-white mt-0.5">
                    <NodeIcon name={rootNode.icon} className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-display text-[15px] font-semibold tracking-[0.01em] text-white leading-snug">
                      {rootNode.title}
                    </p>
                    <p className="text-[13px] text-slate-300/85 line-clamp-2 mt-0.5 leading-snug">
                      {rootNode.shortSubtitle}
                    </p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 font-mono tabular-nums text-xs font-medium text-cyan-300 shrink-0 mt-0.5">
                  <Play className="w-2.5 h-2.5 fill-current" aria-hidden="true" />
                  <span>{rootNode.timestampLabel}</span>
                </span>
              </div>
            </button>
          </div>
        )}

        {/* Vertical Trunk & Expandable Main + Sub Nodes */}
        <div className="relative pl-8 mt-1.5 space-y-3">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-[13px] top-0 bottom-[56px] w-[2px] rounded-full bg-gradient-to-b from-violet-400/70 via-cyan-400/60 to-emerald-400/50"
          />

          {childNodes.map((node) => {
            const isSelected = node.id === selectedNodeId;
            const isExpanded = expandedSet.has(node.id);
            const subCount = node.subNodes?.length ?? 0;
            const theme = NODE_THEME[node.accent];

            return (
              <div key={node.id} className="relative pt-2">
                <svg
                  aria-hidden="true"
                  width="32"
                  height="42"
                  viewBox="0 0 32 42"
                  className="pointer-events-none absolute -left-8 top-1.5 overflow-visible"
                >
                  <path
                    d="M 14.2 0 C 14.2 24, 18 32, 32 32"
                    fill="none"
                    stroke={theme.gradEnd}
                    strokeWidth={isSelected ? '2.6' : '2.1'}
                    strokeOpacity={isSelected ? '0.95' : '0.72'}
                    strokeLinecap="round"
                  />
                  <circle cx="32" cy="32" r="3.2" fill={theme.gradEnd} />
                </svg>

                <div
                  className={`rounded-2xl bg-[#0b1122] border transition-colors duration-150 ${
                    isSelected
                      ? `${theme.activeBorder} ${theme.activeGlow}`
                      : `${theme.idleBorder}`
                  }`}
                >
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={`${node.title} at ${node.timestampLabel}`}
                    onClick={() => onSelectNode(node, { openMobileDrawer: true })}
                    className="w-full min-h-[64px] text-left px-3.5 py-3 cursor-pointer active:scale-[0.99]"
                  >
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg mt-0.5 ${theme.iconBox}`}
                        >
                          <NodeIcon name={node.icon} className="w-4 h-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="font-display text-sm font-semibold tracking-[0.01em] text-white leading-snug">
                            {node.title}
                          </p>
                          <p className="text-[12.5px] text-slate-400 line-clamp-2 mt-0.5 leading-snug">
                            {node.shortSubtitle}
                          </p>
                        </div>
                      </div>

                      <span
                        className={`inline-flex items-center gap-1 font-mono tabular-nums text-xs font-medium shrink-0 mt-0.5 ${theme.timestamp}`}
                      >
                        <Play className="w-2.5 h-2.5 fill-current" aria-hidden="true" />
                        <span>{node.timestampLabel}</span>
                      </span>
                    </div>
                  </button>

                  {subCount > 0 && (
                    <div className="px-3.5 pb-2.5 pt-2 border-t border-white/[0.06] flex items-center justify-between">
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? 'Hide' : 'Expand'} ${subCount} subtopics for ${node.title}`}
                        onClick={() => onToggleExpand(node.id)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 min-h-[36px] text-xs font-semibold cursor-pointer ${theme.pillClass}`}
                      >
                        <span>{isExpanded ? 'Hide subtopics' : `+${subCount} subtopics`}</span>
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  )}
                </div>

                {/* Expanded Mobile Level-3 Sub-Nodes */}
                {isExpanded && node.subNodes && node.subNodes.length > 0 && (
                  <div className="relative pl-5 mt-2.5 space-y-2">
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute left-[7px] top-0 bottom-5 w-[1.5px] bg-white/14"
                    />
                    {node.subNodes.map((sub) => {
                      const subSelected = selectedNodeId === sub.id;
                      const subTheme = NODE_THEME[sub.accent];
                      return (
                        <button
                          key={sub.id}
                          type="button"
                          aria-pressed={subSelected}
                          aria-label={`${sub.title} subtopic at ${sub.timestampLabel}`}
                          onClick={() => onSelectNode(sub, { openMobileDrawer: true })}
                          className={`relative w-full min-h-[56px] text-left rounded-xl bg-[#0c1225] border px-3.5 py-2.5 transition-colors cursor-pointer active:scale-[0.99] ${
                            subSelected
                              ? `${subTheme.activeBorder} ${subTheme.activeGlow}`
                              : `${subTheme.idleBorder}`
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-display text-[13.5px] font-semibold text-white leading-snug">
                              {sub.title}
                            </p>
                            <span
                              className={`inline-flex items-center gap-1 font-mono tabular-nums text-xs shrink-0 mt-0.5 ${subTheme.timestamp}`}
                            >
                              <Play className="w-2.5 h-2.5 fill-current" aria-hidden="true" />
                              <span>{sub.timestampLabel}</span>
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 line-clamp-2 mt-0.5 leading-snug">
                            {sub.shortSubtitle}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Bottom Status Footer inside mobile canvas */}
        <div className="mt-4 pt-3 border-t border-white/[0.07] flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            {isDemo && (
              <span className="rounded bg-amber-400/12 border border-amber-400/25 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-200">
                DEMO
              </span>
            )}
            <span className="text-slate-300 font-medium">
              {childNodes.length} Modules
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-cyan-300/90">
              00:00 → {timelineEndLabel}
            </span>
          </span>
          <span className="font-medium text-slate-400">
            {videoCategory}
            {coverageMode ? ` · ${COVERAGE_BADGE_LABELS[coverageMode]}` : ''}
          </span>
        </div>
      </div>
    </>
  );
});
