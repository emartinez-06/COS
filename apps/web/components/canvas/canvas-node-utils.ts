import {MarkerType, type Edge, type Node} from '@xyflow/react';
import type {CanvasEdge, CanvasEmbedEntityType, CanvasNode} from '@cos/core';

/**
 * Native HTML5 drag-and-drop MIME type carrying `{entityType}` from the
 * sidebar palette (`canvas-feature-palette.tsx`) to the board's own
 * `onDrop` (`canvas-board.tsx`) - the one thing both sides need to agree on
 * for the drag source and drop target to understand each other.
 */
export const ENTITY_EMBED_DND_MIME = 'application/x-cos-canvas-entity-embed';

/** A reasonable starting size for a freshly-dropped embed. Resizable afterward via the node's own resize handles. */
export const ENTITY_EMBED_DEFAULT_SIZE = {width: 420, height: 400};

/** Per-`entityType` starting size, falling back to `ENTITY_EMBED_DEFAULT_SIZE` for any type with no entry. */
export const ENTITY_EMBED_SIZE_BY_TYPE: Record<
  CanvasEmbedEntityType,
  {width: number; height: number}
> = {
  calendar: {width: 420, height: 420},
  documents: {width: 420, height: 420},
  expenses: {width: 420, height: 340},
};

export function entityEmbedSizeFor(entityType: string): {
  width: number;
  height: number;
} {
  return (
    ENTITY_EMBED_SIZE_BY_TYPE[entityType as CanvasEmbedEntityType] ??
    ENTITY_EMBED_DEFAULT_SIZE
  );
}

/** The smallest an embed may be shrunk to. All three COS embeds are flat summaries, so one floor covers them. */
export const ENTITY_EMBED_MIN_SIZE = {width: 280, height: 220};

export function entityEmbedMinSizeFor(_entityType: string): {
  width: number;
  height: number;
} {
  return ENTITY_EMBED_MIN_SIZE;
}

/**
 * Converts a persisted `canvas_nodes` row into a React Flow node. `type`
 * matches `nodeType` directly - `canvas-board.tsx`'s `nodeTypes` map is
 * keyed the same way, so a new node kind never needs a translation step
 * here.
 *
 * The type-specific fields all ride in `data` alongside `accentColor` -
 * `accentColor` is a top-level column on the row, not part of any one
 * node kind's own content, but every node component reads it from `data`
 * the same way React Flow expects.
 */
export function toFlowNode(row: CanvasNode): Node {
  return {
    id: row.id,
    type: row.nodeType,
    position: {x: row.positionX, y: row.positionY},
    style: {width: row.width, height: row.height},
    zIndex: row.zIndex,
    data: {
      accentColor: row.accentColor,
      stickyNoteText: row.stickyNoteText,
      stickyNoteColor: row.stickyNoteColor,
      linkUrl: row.linkUrl,
      linkTitle: row.linkTitle,
      imageStorageKey: row.imageStorageKey,
      embedEntityType: row.embedEntityType,
    },
  };
}

/**
 * Converts a persisted `canvas_edges` row into a React Flow edge. The row
 * doesn't store which of a node's four handles the connection was
 * originally dragged from/to - only that two nodes are connected - so a
 * reload always anchors at a fixed `right` -> `left` pair rather than the
 * original gesture's exact side. The connection itself is what persists;
 * the anchor point is a rendering detail.
 */
export function toFlowEdge(row: CanvasEdge): Edge {
  return {
    id: row.id,
    source: row.sourceNodeId,
    target: row.targetNodeId,
    sourceHandle: 'right',
    targetHandle: 'left',
    markerEnd: {type: MarkerType.ArrowClosed},
  };
}

/**
 * Paints each edge with the accent of the node it LEAVES - colouring one
 * hub node tints every line radiating out of it, which is what makes a
 * cluster read as a single group rather than a tangle.
 *
 * Applied at render time from the live node list rather than stored on the
 * edge row, so recolouring a node can never strand a mis-coloured edge.
 */
export function applyEdgeAccents(
  edges: Edge[],
  accentBySourceId: Map<string, string | null>,
): Edge[] {
  return edges.map((edge) => {
    const accent = accentBySourceId.get(edge.source) ?? null;
    if (!accent) {
      return {...edge, style: undefined, markerEnd: {type: MarkerType.ArrowClosed}};
    }
    return {
      ...edge,
      style: {stroke: accent, strokeWidth: 2},
      markerEnd: {type: MarkerType.ArrowClosed, color: accent},
    };
  });
}

/**
 * Which end of a new connection should be recoloured, and to what.
 *
 * Connecting is how a cluster is built, so the colour flows to whichever
 * end does not have one, in either direction - dragging from a coloured hub
 * onto a plain node paints the node, and the reverse paints the other node
 * too, rather than doing nothing because the gesture happened to start at
 * the "wrong" end.
 *
 * Returns `null` when there is nothing to do: neither end has a colour,
 * both already share one, or both are coloured differently - two
 * established clusters being joined, where picking a winner would silently
 * destroy one of them.
 */
export function resolveAccentPropagation(
  sourceAccent: string | null | undefined,
  targetAccent: string | null | undefined,
): {target: 'source' | 'target'; color: string} | null {
  const from = sourceAccent ?? null;
  const to = targetAccent ?? null;

  if (from && !to) return {target: 'target', color: from};
  if (!from && to) return {target: 'source', color: to};
  return null;
}

/** The inline border style an accent produces on any node type. */
export function accentBorderStyle(accentColor: string | null | undefined): {
  borderColor: string;
  borderWidth?: number;
} {
  return accentColor
    ? {borderColor: accentColor, borderWidth: 2}
    : {borderColor: 'var(--color-border)'};
}

/** Relative luminance of the two foregrounds `readableTextColor` can return. */
const WHITE_LUMINANCE = 1;
const DARK_LUMINANCE = 0.009189;

/**
 * Black or white, whichever has more contrast against `background`.
 *
 * A sticky note's own swatch is pastel and its text is fixed dark, which is
 * fine - but an inherited accent fill is saturated, and dark text on a deep
 * purple or pink is genuinely hard to read. Picked per WCAG relative
 * luminance rather than a hand-maintained per-colour map, so it stays
 * correct if the accent palette ever changes.
 */
export function readableTextColor(background: string): '#111827' | '#FFFFFF' {
  const hex = background.replace('#', '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value) || full.length !== 6) return '#111827';

  const channel = (shift: number): number => {
    const srgb = ((value >> shift) & 0xff) / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);

  const contrastWith = (other: number): number =>
    (Math.max(luminance, other) + 0.05) / (Math.min(luminance, other) + 0.05);
  return contrastWith(WHITE_LUMINANCE) >= contrastWith(DARK_LUMINANCE)
    ? '#FFFFFF'
    : '#111827';
}
