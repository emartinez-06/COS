/**
 * Reading and writing the club canvas, and the conversion between database
 * rows and the shapes in @cos/core.
 *
 * A node and an edge carry no `club_id` of their own - they are reached only
 * through their board, which every write here resolves first. That is the
 * single choke point for the cross-club invariant: a caller cannot patch or
 * connect a node that belongs to some other club's board, because every
 * function below looks the node up scoped to `clubId` before touching it.
 */

import {randomUUID} from 'node:crypto';
import type {
  CanvasBoard,
  CanvasEdge,
  CanvasEdgeDraft,
  CanvasNode,
  CanvasNodeContentPatch,
  CanvasNodeDraft,
  CanvasNodeGeometryPatch,
  CanvasViewportPatch,
} from '@cos/core';
import {and, eq, or} from 'drizzle-orm';

import {db} from '../db/client.js';
import {canvasBoards} from '../db/schema/canvas-boards.js';
import {canvasEdges} from '../db/schema/canvas-edges.js';
import {canvasNodes} from '../db/schema/canvas-nodes.js';
import {
  canvasImageStorageKey,
  deleteObject,
  getObject,
  putObject,
} from '../storage/object-store.js';

type BoardRow = typeof canvasBoards.$inferSelect;
type NodeRow = typeof canvasNodes.$inferSelect;
type EdgeRow = typeof canvasEdges.$inferSelect;

/** The bytes of an upload, already read and already checked. Mirrors `documents/document-store.ts`. */
export interface UploadedImage {
  bytes: Uint8Array;
  contentType: string;
}

function toBoard(row: BoardRow): CanvasBoard {
  return {
    id: row.id,
    clubId: row.clubId,
    viewportX: row.viewportX,
    viewportY: row.viewportY,
    viewportZoom: row.viewportZoom,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toNode(row: NodeRow): CanvasNode {
  return {
    id: row.id,
    boardId: row.boardId,
    nodeType: row.nodeType,
    positionX: row.positionX,
    positionY: row.positionY,
    width: row.width,
    height: row.height,
    zIndex: row.zIndex,
    accentColor: row.accentColor,
    stickyNoteText: row.stickyNoteText,
    stickyNoteColor: row.stickyNoteColor,
    linkUrl: row.linkUrl,
    linkTitle: row.linkTitle,
    imageStorageKey: row.imageStorageKey,
    embedEntityType: row.embedEntityType,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toEdge(row: EdgeRow): CanvasEdge {
  return {
    id: row.id,
    boardId: row.boardId,
    sourceNodeId: row.sourceNodeId,
    targetNodeId: row.targetNodeId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Raised when a write names a board that is not this club's, or not there. */
export class UnknownCanvasBoardError extends Error {
  constructor(readonly boardId: string) {
    super('That board does not exist in this club');
    this.name = 'UnknownCanvasBoardError';
  }
}

/** Raised when a write names a node that is not on this club's board. */
export class UnknownCanvasNodeError extends Error {
  constructor(readonly nodeId: string) {
    super('That node does not exist on this board');
    this.name = 'UnknownCanvasNodeError';
  }
}

/** Raised when a write names a connection that is not on this club's board. */
export class UnknownCanvasEdgeError extends Error {
  constructor(readonly edgeId: string) {
    super('That connection does not exist on this board');
    this.name = 'UnknownCanvasEdgeError';
  }
}

/** Raised when a content patch's `nodeType` does not match the node it targets. */
export class WrongNodeKindError extends Error {
  constructor(
    readonly nodeId: string,
    readonly expected: string,
  ) {
    super(`This node is not a ${expected}`);
    this.name = 'WrongNodeKindError';
  }
}

/** Raised when an `image` draft arrives with no file part. */
export class MissingImageFileError extends Error {
  constructor() {
    super('An image node requires a file');
    this.name = 'MissingImageFileError';
  }
}

/** Raised when a connection is attempted from a node to itself. */
export class SelfConnectionError extends Error {
  constructor() {
    super('A node cannot connect to itself');
    this.name = 'SelfConnectionError';
  }
}

/** Resolves a board inside a club, or throws. The choke point every board-scoped write goes through first. */
async function requireBoardInClub(
  clubId: string,
  boardId: string,
): Promise<BoardRow> {
  const [row] = await db
    .select()
    .from(canvasBoards)
    .where(and(eq(canvasBoards.clubId, clubId), eq(canvasBoards.id, boardId)))
    .limit(1);

  if (!row) {
    throw new UnknownCanvasBoardError(boardId);
  }
  return row;
}

/** Resolves a node inside a club by joining through its board. */
async function requireNodeInClub(
  clubId: string,
  nodeId: string,
): Promise<NodeRow> {
  const [row] = await db
    .select({node: canvasNodes})
    .from(canvasNodes)
    .innerJoin(canvasBoards, eq(canvasNodes.boardId, canvasBoards.id))
    .where(and(eq(canvasBoards.clubId, clubId), eq(canvasNodes.id, nodeId)))
    .limit(1);

  if (!row) {
    throw new UnknownCanvasNodeError(nodeId);
  }
  return row.node;
}

/** Confirms a node is on `boardId`, without fetching it. Used by `createEdge`. */
async function requireNodeOnBoard(
  boardId: string,
  nodeId: string,
): Promise<void> {
  const [row] = await db
    .select({id: canvasNodes.id})
    .from(canvasNodes)
    .where(and(eq(canvasNodes.boardId, boardId), eq(canvasNodes.id, nodeId)))
    .limit(1);

  if (!row) {
    throw new UnknownCanvasNodeError(nodeId);
  }
}

/**
 * Gets the club's one board, creating it on first visit.
 *
 * Two concurrent first visits can both miss the initial read below and both
 * attempt an insert; the unique index on `club_id` makes the loser's insert
 * a no-op rather than a second board, and re-reading resolves to the
 * winner's row instead of surfacing the race as an error.
 */
export async function getOrCreateBoard(clubId: string): Promise<CanvasBoard> {
  const [existing] = await db
    .select()
    .from(canvasBoards)
    .where(eq(canvasBoards.clubId, clubId))
    .limit(1);

  if (existing) {
    return toBoard(existing);
  }

  const [created] = await db
    .insert(canvasBoards)
    .values({id: `canvas_board_${randomUUID()}`, clubId})
    .onConflictDoNothing({target: [canvasBoards.clubId]})
    .returning();

  if (created) {
    return toBoard(created);
  }

  const [row] = await db
    .select()
    .from(canvasBoards)
    .where(eq(canvasBoards.clubId, clubId))
    .limit(1);

  if (!row) {
    throw new Error('Board insert conflicted but no row could be read back');
  }
  return toBoard(row);
}

export async function listNodes(
  clubId: string,
  boardId: string,
): Promise<CanvasNode[]> {
  await requireBoardInClub(clubId, boardId);
  const rows = await db
    .select()
    .from(canvasNodes)
    .where(eq(canvasNodes.boardId, boardId));
  return rows.map(toNode);
}

/**
 * Creates a node. `image` requires `file` and every other kind must omit it -
 * the bytes never travel as JSON, the same rule the document hub follows for
 * uploads.
 *
 * The image's bytes go to object storage **before** the row is inserted, on
 * purpose. The two stores cannot commit together, and an orphaned object
 * costs a few unreferenced bytes a later sweep can find, while a row
 * pointing at bytes that were never written is a node that permanently
 * fails to render.
 */
export async function createNode(
  clubId: string,
  boardId: string,
  draft: CanvasNodeDraft,
  file?: UploadedImage,
): Promise<CanvasNode> {
  await requireBoardInClub(clubId, boardId);

  const id = `canvas_node_${randomUUID()}`;
  const geometry = {
    id,
    boardId,
    positionX: draft.positionX,
    positionY: draft.positionY,
    width: draft.width,
    height: draft.height,
  };

  let values: typeof canvasNodes.$inferInsert;
  switch (draft.nodeType) {
    case 'sticky_note':
      values = {
        ...geometry,
        nodeType: 'sticky_note',
        stickyNoteText: draft.text,
        stickyNoteColor: draft.color,
      };
      break;
    case 'link':
      values = {
        ...geometry,
        nodeType: 'link',
        linkUrl: draft.url,
        linkTitle: draft.title,
      };
      break;
    case 'image': {
      if (!file) {
        throw new MissingImageFileError();
      }
      const storageKey = canvasImageStorageKey(clubId, boardId, id);
      await putObject(storageKey, file.bytes, file.contentType);
      values = {...geometry, nodeType: 'image', imageStorageKey: storageKey};
      break;
    }
    case 'entity_embed':
      values = {
        ...geometry,
        nodeType: 'entity_embed',
        embedEntityType: draft.entityType,
      };
      break;
    default: {
      const exhaustive: never = draft;
      throw new Error(
        `Unhandled node type: ${JSON.stringify(exhaustive)}`,
      );
    }
  }

  const [row] = await db.insert(canvasNodes).values(values).returning();
  if (!row) {
    throw new Error('Insert returned no row');
  }
  return toNode(row);
}

/** Applies a position/size/stacking/accent change. Fired by drag, resize, and recolour. */
export async function updateNodeGeometry(
  clubId: string,
  nodeId: string,
  patch: CanvasNodeGeometryPatch,
): Promise<CanvasNode> {
  const node = await requireNodeInClub(clubId, nodeId);

  const changes: Partial<typeof canvasNodes.$inferInsert> = {};
  if (patch.positionX !== undefined) changes.positionX = patch.positionX;
  if (patch.positionY !== undefined) changes.positionY = patch.positionY;
  if (patch.width !== undefined) changes.width = patch.width;
  if (patch.height !== undefined) changes.height = patch.height;
  if (patch.zIndex !== undefined) changes.zIndex = patch.zIndex;
  if (patch.accentColor !== undefined) changes.accentColor = patch.accentColor;

  if (Object.keys(changes).length === 0) {
    return toNode(node);
  }

  const [row] = await db
    .update(canvasNodes)
    .set(changes)
    .where(eq(canvasNodes.id, nodeId))
    .returning();

  if (!row) {
    throw new UnknownCanvasNodeError(nodeId);
  }
  return toNode(row);
}

/**
 * Applies a content edit. Only `sticky_note` and `link` nodes accept one -
 * `patch.nodeType` must match the node's own kind, or the write is refused
 * rather than silently discarded.
 */
export async function updateNodeContent(
  clubId: string,
  nodeId: string,
  patch: CanvasNodeContentPatch,
): Promise<CanvasNode> {
  const node = await requireNodeInClub(clubId, nodeId);
  if (node.nodeType !== patch.nodeType) {
    throw new WrongNodeKindError(nodeId, patch.nodeType);
  }

  const changes: Partial<typeof canvasNodes.$inferInsert> = {};
  if (patch.nodeType === 'sticky_note') {
    if (patch.text !== undefined) changes.stickyNoteText = patch.text;
    if (patch.color !== undefined) changes.stickyNoteColor = patch.color;
  } else {
    if (patch.url !== undefined) changes.linkUrl = patch.url;
    if (patch.title !== undefined) changes.linkTitle = patch.title;
  }

  if (Object.keys(changes).length === 0) {
    return toNode(node);
  }

  const [row] = await db
    .update(canvasNodes)
    .set(changes)
    .where(eq(canvasNodes.id, nodeId))
    .returning();

  if (!row) {
    throw new UnknownCanvasNodeError(nodeId);
  }
  return toNode(row);
}

/**
 * Removes a node and every edge attached to it (cascades at the database
 * level). Returns the ids of the edges that went with it, read *before* the
 * delete, so a caller broadcasting the change over the presence socket
 * knows exactly which edges to announce as gone - the cascade itself is
 * silent at the database layer.
 */
export async function deleteNode(
  clubId: string,
  nodeId: string,
): Promise<{deletedEdgeIds: string[]}> {
  const node = await requireNodeInClub(clubId, nodeId);

  const attachedEdges = await db
    .select({id: canvasEdges.id})
    .from(canvasEdges)
    .where(
      or(eq(canvasEdges.sourceNodeId, nodeId), eq(canvasEdges.targetNodeId, nodeId)),
    );

  if (node.nodeType === 'image' && node.imageStorageKey) {
    await deleteObject(node.imageStorageKey);
  }
  await db.delete(canvasNodes).where(eq(canvasNodes.id, nodeId));

  return {deletedEdgeIds: attachedEdges.map((edge) => edge.id)};
}

/** The bytes of an `image` node. */
export async function readNodeImage(
  clubId: string,
  nodeId: string,
): Promise<{bytes: Uint8Array; contentType: string} | null> {
  const node = await requireNodeInClub(clubId, nodeId);
  if (node.nodeType !== 'image' || !node.imageStorageKey) {
    throw new WrongNodeKindError(nodeId, 'image');
  }
  return getObject(node.imageStorageKey);
}

export async function listEdges(
  clubId: string,
  boardId: string,
): Promise<CanvasEdge[]> {
  await requireBoardInClub(clubId, boardId);
  const rows = await db
    .select()
    .from(canvasEdges)
    .where(eq(canvasEdges.boardId, boardId));
  return rows.map(toEdge);
}

/**
 * Connects two nodes. Connecting the same pair twice is a no-op, not a
 * duplicate row - the unique index on `(board_id, source, target)` makes the
 * second attempt's insert conflict, and the existing row is re-read and
 * returned rather than surfacing the conflict as an error, since a repeated
 * drag-to-connect gesture is not a mistake.
 */
export async function createEdge(
  clubId: string,
  boardId: string,
  draft: CanvasEdgeDraft,
): Promise<CanvasEdge> {
  await requireBoardInClub(clubId, boardId);

  if (draft.sourceNodeId === draft.targetNodeId) {
    throw new SelfConnectionError();
  }

  await requireNodeOnBoard(boardId, draft.sourceNodeId);
  await requireNodeOnBoard(boardId, draft.targetNodeId);

  const [created] = await db
    .insert(canvasEdges)
    .values({
      id: `canvas_edge_${randomUUID()}`,
      boardId,
      sourceNodeId: draft.sourceNodeId,
      targetNodeId: draft.targetNodeId,
    })
    .onConflictDoNothing({
      target: [
        canvasEdges.boardId,
        canvasEdges.sourceNodeId,
        canvasEdges.targetNodeId,
      ],
    })
    .returning();

  if (created) {
    return toEdge(created);
  }

  const [existing] = await db
    .select()
    .from(canvasEdges)
    .where(
      and(
        eq(canvasEdges.boardId, boardId),
        eq(canvasEdges.sourceNodeId, draft.sourceNodeId),
        eq(canvasEdges.targetNodeId, draft.targetNodeId),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new Error('Edge insert conflicted but no row could be read back');
  }
  return toEdge(existing);
}

export async function deleteEdge(
  clubId: string,
  edgeId: string,
): Promise<void> {
  const [row] = await db
    .select({id: canvasEdges.id})
    .from(canvasEdges)
    .innerJoin(canvasBoards, eq(canvasEdges.boardId, canvasBoards.id))
    .where(and(eq(canvasBoards.clubId, clubId), eq(canvasEdges.id, edgeId)))
    .limit(1);

  if (!row) {
    throw new UnknownCanvasEdgeError(edgeId);
  }

  await db.delete(canvasEdges).where(eq(canvasEdges.id, edgeId));
}

/** Persists the last-known pan position and zoom. */
export async function updateViewport(
  clubId: string,
  boardId: string,
  patch: CanvasViewportPatch,
): Promise<CanvasBoard> {
  await requireBoardInClub(clubId, boardId);

  const [row] = await db
    .update(canvasBoards)
    .set({
      viewportX: patch.viewportX,
      viewportY: patch.viewportY,
      viewportZoom: patch.viewportZoom,
    })
    .where(eq(canvasBoards.id, boardId))
    .returning();

  if (!row) {
    throw new UnknownCanvasBoardError(boardId);
  }
  return toBoard(row);
}
