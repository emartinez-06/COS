'use client';

/**
 * React binding for the CanvasRepository port.
 *
 * Same shape as the treasury store: the port has no `subscribe`, so the
 * board loads on mount and re-reads after this browser's own writes.
 * Nothing polls.
 *
 * **`updateViewport` is the one write that does not re-read.** Panning or
 * zooming fires it on every settle, and re-fetching every node and edge on
 * each one would be both wasteful and would fight the board's own local
 * state while someone is still interacting with it. The updated board (just
 * the pan/zoom fields) is applied locally instead.
 *
 * The repository itself is exposed rather than wrapped in a mutator for
 * every read - `downloadImage` has no place in a store whose state is the
 * node list, and inventing a store method for it would mean caching bytes
 * nobody asked to have cached. Mirrors `document-store.tsx`'s own reasoning
 * for exposing its repository the same way.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type {
  CanvasBoard,
  CanvasEdge,
  CanvasEdgeDraft,
  CanvasNode,
  CanvasNodeContentPatch,
  CanvasNodeDraft,
  CanvasNodeGeometryPatch,
  CanvasRepository,
  CanvasViewportPatch,
  FileBytes,
} from '@cos/core';

import {ApiError} from './api-error';
import {HttpCanvasRepository} from './http-canvas-repository';
import {useSession} from './session';

/**
 * Is this failure just "the row is already gone"?
 *
 * The canvas is a shared board with last-write-wins semantics and no
 * realtime sync, so a node someone else deleted stays on screen for
 * everyone else with the board open. Without this, clicking delete on that
 * stale node 404s, the promise rejects, and the local removal never
 * happens - the node becomes undismissable, since every click re-runs the
 * same failing request. Any other failure still rejects.
 */
function isAlreadyGone(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

interface CanvasStore {
  board: CanvasBoard | null;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  /** True until the first load completes. */
  isLoading: boolean;
  /** Set when the canvas could not be loaded at all. */
  error: string | null;
  clubId: string;
  repository: CanvasRepository;
  refresh: () => Promise<void>;
  createNode: (
    draft: CanvasNodeDraft,
    file?: FileBytes & {name: string},
  ) => Promise<CanvasNode>;
  updateNodeGeometry: (
    nodeId: string,
    patch: CanvasNodeGeometryPatch,
  ) => Promise<CanvasNode>;
  updateNodeContent: (
    nodeId: string,
    patch: CanvasNodeContentPatch,
  ) => Promise<CanvasNode>;
  deleteNode: (nodeId: string) => Promise<void>;
  createEdge: (draft: CanvasEdgeDraft) => Promise<CanvasEdge>;
  deleteEdge: (edgeId: string) => Promise<void>;
  updateViewport: (patch: CanvasViewportPatch) => Promise<CanvasBoard>;
}

const CanvasStoreContext = createContext<CanvasStore | null>(null);

interface CanvasStoreProviderProps {
  children: React.ReactNode;
  clubId: string;
}

export function CanvasStoreProvider({
  children,
  clubId,
}: CanvasStoreProviderProps) {
  const [repository] = useState<CanvasRepository>(
    () => new HttpCanvasRepository(),
  );

  // Keyed on the viewer for the same reason the treasury store is: signing
  // out and back in as someone else does not unmount this provider.
  const {user} = useSession();
  const viewerId = user?.id ?? null;

  const [board, setBoard] = useState<CanvasBoard | null>(null);
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<CanvasEdge[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async () => {
    const nextBoard = await repository.getOrCreateBoard(clubId);
    const [nextNodes, nextEdges] = await Promise.all([
      repository.listNodes(clubId, nextBoard.id),
      repository.listEdges(clubId, nextBoard.id),
    ]);
    setBoard(nextBoard);
    setNodes(nextNodes);
    setEdges(nextEdges);
  }, [repository, clubId]);

  /** Re-reads after a write. Does not raise the loading flag - see the treasury store. */
  const load = useCallback(async () => {
    try {
      await read();
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load this club’s canvas.',
      );
    }
  }, [read]);

  useEffect(() => {
    let isActive = true;

    setIsLoading(true);
    setError(null);
    setBoard(null);
    setNodes([]);
    setEdges([]);

    void read()
      .then(() => {
        if (isActive) {
          setIsLoading(false);
        }
      })
      .catch((cause: unknown) => {
        if (isActive) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not load this club’s canvas.',
          );
          setIsLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [read, viewerId]);

  const requireBoard = useCallback((): CanvasBoard => {
    if (!board) {
      throw new Error('The board has not loaded yet');
    }
    return board;
  }, [board]);

  const createNode = useCallback(
    async (draft: CanvasNodeDraft, file?: FileBytes & {name: string}) => {
      const created = await repository.createNode(
        clubId,
        requireBoard().id,
        draft,
        file,
      );
      await load();
      return created;
    },
    [repository, clubId, requireBoard, load],
  );

  const updateNodeGeometry = useCallback(
    async (nodeId: string, patch: CanvasNodeGeometryPatch) => {
      const updated = await repository.updateNodeGeometry(
        clubId,
        nodeId,
        patch,
      );
      await load();
      return updated;
    },
    [repository, clubId, load],
  );

  const updateNodeContent = useCallback(
    async (nodeId: string, patch: CanvasNodeContentPatch) => {
      const updated = await repository.updateNodeContent(
        clubId,
        nodeId,
        patch,
      );
      await load();
      return updated;
    },
    [repository, clubId, load],
  );

  const deleteNode = useCallback(
    async (nodeId: string) => {
      try {
        await repository.deleteNode(clubId, nodeId);
      } catch (cause) {
        if (!isAlreadyGone(cause)) {
          throw cause;
        }
      }
      await load();
    },
    [repository, clubId, load],
  );

  const createEdge = useCallback(
    async (draft: CanvasEdgeDraft) => {
      const created = await repository.createEdge(
        clubId,
        requireBoard().id,
        draft,
      );
      await load();
      return created;
    },
    [repository, clubId, requireBoard, load],
  );

  const deleteEdge = useCallback(
    async (edgeId: string) => {
      try {
        await repository.deleteEdge(clubId, edgeId);
      } catch (cause) {
        if (!isAlreadyGone(cause)) {
          throw cause;
        }
      }
      await load();
    },
    [repository, clubId, load],
  );

  const updateViewport = useCallback(
    async (patch: CanvasViewportPatch) => {
      const updated = await repository.updateViewport(
        clubId,
        requireBoard().id,
        patch,
      );
      setBoard(updated);
      return updated;
    },
    [repository, clubId, requireBoard],
  );

  const value = useMemo<CanvasStore>(
    () => ({
      board,
      nodes,
      edges,
      isLoading,
      error,
      clubId,
      repository,
      refresh: load,
      createNode,
      updateNodeGeometry,
      updateNodeContent,
      deleteNode,
      createEdge,
      deleteEdge,
      updateViewport,
    }),
    [
      board,
      nodes,
      edges,
      isLoading,
      error,
      clubId,
      repository,
      load,
      createNode,
      updateNodeGeometry,
      updateNodeContent,
      deleteNode,
      createEdge,
      deleteEdge,
      updateViewport,
    ],
  );

  return (
    <CanvasStoreContext.Provider value={value}>
      {children}
    </CanvasStoreContext.Provider>
  );
}

export function useCanvas(): CanvasStore {
  const store = useContext(CanvasStoreContext);
  if (!store) {
    throw new Error('useCanvas must be used within a CanvasStoreProvider');
  }
  return store;
}
