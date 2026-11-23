import type {
  MindmapNode,
  MindmapSubNode,
  NodeAccent,
  SelectedNodeDetail,
} from '../types/mindflow';

export const ZOOM_MIN = 0.32;
export const ZOOM_MAX = 1.6;
export const ZOOM_STEP = 0.15;

export const ROOT_WIDTH = 256;
export const MAIN_WIDTH = 242;
export const SUB_WIDTH = 210;

export interface Point2D {
  x: number;
  y: number;
}

export interface PositionedMainNode {
  node: MindmapNode;
  x: number;
  y: number;
  side: 'left' | 'right';
}

export interface PositionedSubNode {
  subNode: MindmapSubNode;
  parentId: string;
  x: number;
  y: number;
  side: 'left' | 'right';
}

export interface MindmapEdge {
  id: string;
  sourceId: string;
  targetId: string;
  accent: NodeAccent;
  path: string;
  start: Point2D;
  end: Point2D;
  isSubEdge: boolean;
}

export interface DynamicMindmapLayout {
  width: number;
  height: number;
  root: { node: MindmapNode; x: number; y: number } | null;
  mains: PositionedMainNode[];
  subs: PositionedSubNode[];
  edges: MindmapEdge[];
}

export function clampZoom(zoom: number): number {
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
  return Math.round(clamped * 100) / 100;
}

/**
 * Returns true ONLY when the user performs an intentional zoom gesture
 * (Ctrl + wheel, Cmd + wheel on macOS, or browser trackpad pinch which sets ctrlKey).
 * Ordinary mouse-wheel scrolling returns false so page/container scrolling works normally.
 */
export function shouldZoomOnWheel(event: {
  ctrlKey: boolean;
  metaKey: boolean;
  deltaY: number;
}): boolean {
  return Boolean((event.ctrlKey || event.metaKey) && Number.isFinite(event.deltaY) && event.deltaY !== 0);
}

/**
 * Computes a smooth, bounded zoom delta for Ctrl/Cmd + wheel gestures without sudden jumps.
 * Normalizes line/page wheel modes and caps single-event change to ±0.12.
 */
export function computeWheelZoomDelta(deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 0;
  const normalizedPixels =
    deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 120 : deltaY;
  // Trackpad pinch gestures emit small pixel deltas; mouse wheels emit ~100px ticks
  const raw = -normalizedPixels * 0.0012;
  const bounded = Math.max(-0.12, Math.min(0.12, raw));
  // Guarantee a minimum noticeable step when an intentional Ctrl/Cmd wheel tick occurs
  if (Math.abs(bounded) < 0.02) {
    return deltaY < 0 ? 0.02 : -0.02;
  }
  return Math.round(bounded * 1000) / 1000;
}

/**
 * Generates a smooth horizontal-biased cubic Bezier path between two nodes
 * on the desktop mindmap canvas.
 */
export function computeCurvedConnectorPath(start: Point2D, end: Point2D): string {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const c1x = start.x + dx * 0.52;
  const c1y = start.y + dy * 0.12;
  const c2x = start.x + dx * 0.48;
  const c2y = end.y - dy * 0.08;

  return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
}

/**
 * Generates a vertical trunk-to-branch curved Bezier path for the mobile
 * touch-friendly mindmap tree.
 */
export function computeVerticalConnectorPath(start: Point2D, end: Point2D): string {
  const midY = start.y + (end.y - start.y) * 0.55;
  return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} C ${start.x.toFixed(1)} ${midY.toFixed(1)}, ${end.x.toFixed(1)} ${midY.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
}

/**
 * Finds either a root/main node or any nested sub-node by ID and returns a unified detail view.
 */
export function findAnyNodeById(
  nodes: MindmapNode[],
  id: string
): SelectedNodeDetail | null {
  for (const node of nodes) {
    if (node.id === id) {
      return {
        id: node.id,
        title: node.title,
        shortSubtitle: node.shortSubtitle,
        timestampLabel: node.timestampLabel,
        timestampSeconds: node.timestampSeconds,
        accent: node.accent,
        icon: node.icon,
        keyPoints: node.keyPoints,
        realLifeExample: node.realLifeExample,
        simplifiedAnalogy: node.simplifiedAnalogy,
        isSubNode: false,
      };
    }

    if (node.subNodes) {
      for (const sub of node.subNodes) {
        if (sub.id === id) {
          return {
            id: sub.id,
            title: sub.title,
            shortSubtitle: sub.shortSubtitle,
            timestampLabel: sub.timestampLabel,
            timestampSeconds: sub.timestampSeconds,
            accent: sub.accent,
            icon: sub.icon,
            keyPoints: sub.keyPoints,
            realLifeExample: sub.realLifeExample,
            simplifiedAnalogy: sub.simplifiedAnalogy,
            parentTitle: node.title,
            isSubNode: true,
          };
        }
      }
    }
  }
  return null;
}

export interface ClosestNodeMatch {
  nodeId: string;
  parentIdToExpand: string | null;
  timestampSeconds: number;
  timestampLabel: string;
}

/**
 * Finds the closest mindmap node OR nested sub-node to a target timestamp in seconds.
 * When the closest match is a sub-node, also returns its parentId so the UI expands that branch.
 */
export function findClosestNodeForTimestamp(
  nodes: MindmapNode[],
  targetSeconds: number
): ClosestNodeMatch | null {
  if (!Array.isArray(nodes) || nodes.length === 0) return null;
  const safeTarget = Math.max(0, Math.floor(targetSeconds));

  let best: ClosestNodeMatch = {
    nodeId: nodes[0].id,
    parentIdToExpand: null,
    timestampSeconds: nodes[0].timestampSeconds,
    timestampLabel: nodes[0].timestampLabel,
  };
  let bestDist = Math.abs(nodes[0].timestampSeconds - safeTarget);

  for (const node of nodes) {
    const dist = Math.abs(node.timestampSeconds - safeTarget);
    if (dist < bestDist) {
      bestDist = dist;
      best = {
        nodeId: node.id,
        parentIdToExpand: null,
        timestampSeconds: node.timestampSeconds,
        timestampLabel: node.timestampLabel,
      };
    }

    if (Array.isArray(node.subNodes)) {
      for (const sub of node.subNodes) {
        const subDist = Math.abs(sub.timestampSeconds - safeTarget);
        if (subDist < bestDist) {
          bestDist = subDist;
          best = {
            nodeId: sub.id,
            parentIdToExpand: node.id,
            timestampSeconds: sub.timestampSeconds,
            timestampLabel: sub.timestampLabel,
          };
        }
      }
    }
  }

  return best;
}

/**
 * Dynamically lays out a 3-level mindmap (Root -> up to 10 Main Topic Nodes -> up to 5 Expanded Sub-Nodes each)
 * with guaranteed non-overlapping vertical tracks and graceful cubic Bezier paths.
 */
export function computeDynamicMindmapLayout(
  nodes: MindmapNode[],
  expandedIds: string[]
): DynamicMindmapLayout {
  const rootNode = nodes.find((n) => n.isRoot) ?? nodes[0];
  if (!rootNode) {
    return { width: 920, height: 560, root: null, mains: [], subs: [], edges: [] };
  }

  const expandedSet = new Set(expandedIds);
  const children = nodes.filter((n) => n.id !== rootNode.id);

  // Split main topic nodes cleanly into balanced left and right columns
  const leftNodes: MindmapNode[] = [];
  const rightNodes: MindmapNode[] = [];

  children.forEach((child, idx) => {
    if (idx % 2 === 0) {
      leftNodes.push(child);
    } else {
      rightNodes.push(child);
    }
  });

  const hasLeftExpanded = leftNodes.some(
    (n) => expandedSet.has(n.id) && (n.subNodes?.length ?? 0) > 0
  );
  const hasRightExpanded = rightNodes.some(
    (n) => expandedSet.has(n.id) && (n.subNodes?.length ?? 0) > 0
  );

  const isDenseCourse = children.length >= 7;
  const subRowSpacing = 98;
  const collapsedSlotHeight = isDenseCourse ? 172 : 178;
  const verticalMargin = isDenseCourse ? 82 : 72;

  const computeColumnSlots = (col: MindmapNode[]) => {
    return col.map((node) => {
      const subCount =
        expandedSet.has(node.id) && node.subNodes ? node.subNodes.length : 0;
      const slotHeight =
        subCount > 0
          ? Math.max(collapsedSlotHeight, subCount * subRowSpacing + 44)
          : collapsedSlotHeight;
      return { node, subCount, slotHeight };
    });
  };

  const leftSlots = computeColumnSlots(leftNodes);
  const rightSlots = computeColumnSlots(rightNodes);

  const leftTotalH = leftSlots.reduce((sum, s) => sum + s.slotHeight, 0);
  const rightTotalH = rightSlots.reduce((sum, s) => sum + s.slotHeight, 0);
  const canvasHeight = Math.max(560, Math.max(leftTotalH, rightTotalH) + verticalMargin * 2);

  // Horizontal spacing: widen canvas gracefully for dense courses & expanded sub-nodes
  const leftExtra = hasLeftExpanded ? 286 : 0;
  const rightExtra = hasRightExpanded ? 286 : 0;
  const baseHalfSpan = isDenseCourse ? 328 : 300;
  const sidePadding = 166;

  const rootX = sidePadding + leftExtra + baseHalfSpan;
  const rootY = canvasHeight / 2;
  const canvasWidth = rootX + baseHalfSpan + sidePadding + rightExtra;

  const leftMainX = rootX - baseHalfSpan;
  const rightMainX = rootX + baseHalfSpan;
  const subHorizontalGap = 282;

  const mains: PositionedMainNode[] = [];
  const subs: PositionedSubNode[] = [];
  const edges: MindmapEdge[] = [];

  const placeColumn = (
    slots: ReturnType<typeof computeColumnSlots>,
    side: 'left' | 'right'
  ) => {
    const colTotal = slots.reduce((sum, s) => sum + s.slotHeight, 0);
    let cursorY = (canvasHeight - colTotal) / 2;
    const mainX = side === 'left' ? leftMainX : rightMainX;

    for (const slot of slots) {
      const centerY = cursorY + slot.slotHeight / 2;
      mains.push({ node: slot.node, x: mainX, y: centerY, side });

      // Root -> Main edge
      const start = {
        x: rootX + (side === 'left' ? -ROOT_WIDTH / 2 : ROOT_WIDTH / 2),
        y: rootY,
      };
      const end = {
        x: mainX + (side === 'left' ? MAIN_WIDTH / 2 : -MAIN_WIDTH / 2),
        y: centerY,
      };
      edges.push({
        id: `edge-${rootNode.id}-${slot.node.id}`,
        sourceId: rootNode.id,
        targetId: slot.node.id,
        accent: slot.node.accent,
        path: computeCurvedConnectorPath(start, end),
        start,
        end,
        isSubEdge: false,
      });

      // Expanded Sub-Nodes fanning cleanly outward
      if (slot.subCount > 0 && slot.node.subNodes) {
        const subX =
          side === 'left' ? mainX - subHorizontalGap : mainX + subHorizontalGap;
        const subGroupH = (slot.subCount - 1) * subRowSpacing;
        const firstSubY = centerY - subGroupH / 2;

        slot.node.subNodes.forEach((subNode, sIdx) => {
          const subY = firstSubY + sIdx * subRowSpacing;
          subs.push({
            subNode,
            parentId: slot.node.id,
            x: subX,
            y: subY,
            side,
          });

          const subStart = {
            x: mainX + (side === 'left' ? -MAIN_WIDTH / 2 : MAIN_WIDTH / 2),
            y: centerY,
          };
          const subEnd = {
            x: subX + (side === 'left' ? SUB_WIDTH / 2 : -SUB_WIDTH / 2),
            y: subY,
          };
          edges.push({
            id: `edge-${slot.node.id}-${subNode.id}`,
            sourceId: slot.node.id,
            targetId: subNode.id,
            accent: subNode.accent,
            path: computeCurvedConnectorPath(subStart, subEnd),
            start: subStart,
            end: subEnd,
            isSubEdge: true,
          });
        });
      }

      cursorY += slot.slotHeight;
    }
  };

  placeColumn(leftSlots, 'left');
  placeColumn(rightSlots, 'right');

  return {
    width: canvasWidth,
    height: canvasHeight,
    root: { node: rootNode, x: rootX, y: rootY },
    mains,
    subs,
    edges,
  };
}
