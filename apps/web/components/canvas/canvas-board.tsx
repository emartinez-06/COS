'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
} from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type {CanvasAccentColor} from '@cos/core';
import {Text} from '@astryxdesign/core/Text';
import {useToast} from '@astryxdesign/core/Toast';

import {useCanvasPresence} from '../../lib/canvas-presence-store';
import {useCanvas} from '../../lib/canvas-store';
import {CanvasAddNodeToolbar} from './canvas-add-node-toolbar';
import {CanvasEntityEmbedNode} from './canvas-entity-embed-node';
import {CanvasFeaturePalette} from './canvas-feature-palette';
import {CanvasImageNode} from './canvas-image-node';
import {CanvasLinkNode} from './canvas-link-node';
import {
  ENTITY_EMBED_DND_MIME,
  applyEdgeAccents,
  entityEmbedSizeFor,
  resolveAccentPropagation,
  toFlowEdge,
  toFlowNode,
} from './canvas-node-utils';
import {withCanvasPresence} from './canvas-node-presence';
import {CanvasStickyNoteNode} from './canvas-sticky-note-node';

/** Shared by the <ReactFlow> props and the over-a-node wheel handler, so the two agree. */
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;

// Wrapped once here, not edited into each of the four node components - see
// canvas-node-presence.tsx for why.
const nodeTypes: NodeTypes = {
  sticky_note: withCanvasPresence(CanvasStickyNoteNode),
  link: withCanvasPresence(CanvasLinkNode),
  image: withCanvasPresence(CanvasImageNode),
  entity_embed: withCanvasPresence(CanvasEntityEmbedNode),
};

const infoChip: CSSProperties = {
  position: 'absolute',
  left: 'var(--spacing-4)',
  top: 'var(--spacing-4)',
  zIndex: 10,
  maxWidth: 280,
  borderRadius: 'var(--radius-container)',
  border: 'var(--border-width) solid var(--color-border)',
  backgroundColor: 'var(--color-background-surface)',
  paddingInline: 'var(--spacing-3)',
  paddingBlock: 'var(--spacing-2)',
  boxShadow: 'var(--shadow-container)',
};

/**
 * The canvas orchestrator - an infinite pan/zoom React Flow board. Node
 * position changes persist via a debounced-by-nature `onNodeDragStop`
 * (fires once per drag gesture, not per frame); the last-known viewport
 * persists via `onMoveEnd` (React Flow only fires this once
 * panning/zooming settles, so no extra debounce is needed on top of it).
 *
 * `board`/`nodes`/`edges` are read from `useCanvas()` once, to seed React
 * Flow's own state - not consumed reactively after that. Every mutation
 * below applies directly to React Flow's local state at the call site
 * (`setNodes`/`setEdges`), the same as the store's own re-read after a
 * write: this component's rendering never depends on that re-read landing,
 * only the next full page load does.
 */
export function CanvasBoard() {
  const {board, nodes: initialNodes, edges: initialEdges} = useCanvas();

  const initial = useMemo(
    () => initialNodes.map((row) => toFlowNode(row)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [nodes, , onNodesChange] = useNodesState(initial);

  const initialFlowEdges = useMemo(
    () => initialEdges.map(toFlowEdge),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [edges, setEdges, onEdgesChangeRaw] = useEdgesState(initialFlowEdges);
  const toast = useToast();
  const {createEdge, deleteEdge, updateNodeGeometry, updateViewport} = useCanvas();

  // Edge colour is derived from the live node list, never stored on the
  // edge - so recolouring a node repaints its outgoing connections on the
  // next render with no write per edge and no chance of an edge keeping a
  // colour its source node no longer has.
  const accentBySourceId = useMemo(
    () =>
      new Map(
        nodes.map((node) => [
          node.id,
          ((node.data as {accentColor?: string | null} | undefined)?.accentColor ?? null),
        ]),
      ),
    [nodes],
  );
  const accentedEdges = useMemo(
    () => applyEdgeAccents(edges, accentBySourceId),
    [edges, accentBySourceId],
  );

  /**
   * Selecting an edge and pressing Backspace/Delete fires a 'remove' change
   * here. Applied optimistically, then rolled back on a failed delete
   * rather than left silently desynced from the server.
   */
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removed = changes.filter((change) => change.type === 'remove');
      onEdgesChangeRaw(changes);
      for (const change of removed) {
        const removedEdge = edges.find((edge) => edge.id === change.id);
        void deleteEdge(change.id).catch(() => {
          toast({body: "Couldn't delete the connection.", type: 'error'});
          if (removedEdge) {
            setEdges((eds) =>
              eds.some((edge) => edge.id === removedEdge.id) ? eds : [...eds, removedEdge],
            );
          }
        });
      }
    },
    [edges, onEdgesChangeRaw, setEdges, deleteEdge, toast],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target) {
        return;
      }
      void createEdge({sourceNodeId: connection.source, targetNodeId: connection.target})
        .then((created) => {
          setEdges((eds) => [
            ...eds,
            {
              ...connection,
              id: created.id,
              source: connection.source!,
              target: connection.target!,
            },
          ]);
        })
        .catch(() => {
          toast({body: "Couldn't create the connection.", type: 'error'});
        });
    },
    [createEdge, setEdges, toast],
  );

  const handleNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      void updateNodeGeometry(node.id, {
        positionX: Math.round(node.position.x),
        positionY: Math.round(node.position.y),
      }).catch(() => {
        toast({body: "Couldn't save the new position.", type: 'error'});
      });
    },
    [updateNodeGeometry, toast],
  );

  /**
   * Debounced: React Flow can call this more than once in quick succession
   * for a single logical "settle", and these are fire-and-forget writes
   * with no server-side ordering guarantee, so two near-simultaneous calls
   * can land out of order. Debouncing collapses any such burst down to one
   * write carrying only the last viewport.
   */
  const viewportPatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleMoveEnd = useCallback(
    (_event: unknown, viewport: {x: number; y: number; zoom: number}) => {
      if (!board) return;
      if (viewportPatchTimerRef.current) clearTimeout(viewportPatchTimerRef.current);
      viewportPatchTimerRef.current = setTimeout(() => {
        void updateViewport({
          viewportX: Math.round(viewport.x),
          viewportY: Math.round(viewport.y),
          viewportZoom: Math.round(viewport.zoom * 100),
        });
      }, 400);
    },
    [board, updateViewport],
  );

  // A board that has never been panned/zoomed still carries the raw
  // defaults (0, 0, 100) - treat that as "no real viewport yet" and frame
  // all nodes instead of dropping the officer at an arbitrary 100% zoom on
  // (0,0). Any real pan/zoom moves the stored viewport off that exact
  // triple, so this only ever fires once per board.
  const hasNoRealViewport =
    !board || (board.viewportX === 0 && board.viewportY === 0 && board.viewportZoom === 100);

  return (
    <ReactFlowProvider>
      <CanvasSurface
        nodes={nodes}
        onNodesChange={onNodesChange}
        onNodeDragStop={handleNodeDragStop}
        onMoveEnd={handleMoveEnd}
        board={board}
        hasNoRealViewport={hasNoRealViewport}
        edges={accentedEdges}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
      />
    </ReactFlowProvider>
  );
}

interface CanvasSurfaceProps {
  nodes: Node[];
  onNodesChange: ReturnType<typeof useNodesState>[2];
  onNodeDragStop: (event: unknown, node: Node) => void;
  onMoveEnd: (event: unknown, viewport: {x: number; y: number; zoom: number}) => void;
  board: {viewportX: number; viewportY: number; viewportZoom: number} | null;
  hasNoRealViewport: boolean;
  edges: Edge[];
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
}

/** Rendered as a child of `<ReactFlowProvider>` purely so `useReactFlow()` has a provider to resolve against. */
function CanvasSurface({
  nodes,
  onNodesChange,
  onNodeDragStop,
  onMoveEnd,
  board,
  hasNoRealViewport,
  edges,
  onEdgesChange,
  onConnect,
}: CanvasSurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const {fitView, getViewport, setViewport, screenToFlowPosition, setNodes, setEdges, getNode} =
    useReactFlow();
  const toast = useToast();
  const {createNode, deleteEdge, updateNodeGeometry} = useCanvas();
  const {select: reportSelection} = useCanvasPresence();

  /**
   * Reports the officer's active node to everyone else on the board.
   * `selected` node state, not hover - a click, a drag, or opening a node to
   * edit its content all select it first, so this one signal covers all
   * three without a separate drag-start/edit-start hook. Ambiguous when more
   * than one node is selected (a drag-select box) - report nothing rather
   * than guess which one to attribute.
   */
  const handleSelectionChange = useCallback(
    ({nodes: selectedNodes}: {nodes: Node[]}) => {
      reportSelection(selectedNodes.length === 1 ? selectedNodes[0]!.id : null);
    },
    [reportSelection],
  );

  /**
   * Connecting FROM a coloured node paints what it connects TO - so
   * building a hub is "colour the centre once, then drag out" instead of
   * recolouring every node by hand. Works in both directions: the colour
   * flows to whichever end lacks one.
   */
  const propagateAccent = useCallback(
    (connection: Connection) => {
      const {source, target} = connection;
      if (!source || !target) return;
      const accentOf = (id: string): string | null =>
        (getNode(id)?.data as {accentColor?: string | null} | undefined)?.accentColor ?? null;

      const decision = resolveAccentPropagation(accentOf(source), accentOf(target));
      if (!decision) return;
      const paintedId = decision.target === 'source' ? source : target;

      setNodes((current) =>
        current.map((node) =>
          node.id === paintedId
            ? {...node, data: {...node.data, accentColor: decision.color}}
            : node,
        ),
      );
      void updateNodeGeometry(paintedId, {
        accentColor: decision.color as CanvasAccentColor,
      }).catch(() => {
        toast({body: "Couldn't colour the connected node.", type: 'error'});
      });
    },
    [getNode, setNodes, updateNodeGeometry, toast],
  );

  /** Double-click an edge to delete it. Optimistic, then rolled back on failure. */
  const handleEdgeDoubleClick = useCallback(
    (event: MouseEvent, edge: Edge) => {
      event.stopPropagation();
      const removed = edge;
      setEdges((eds) => eds.filter((e) => e.id !== edge.id));
      void deleteEdge(edge.id).catch(() => {
        setEdges((eds) => (eds.some((e) => e.id === removed.id) ? eds : [...eds, removed]));
        toast({body: "Couldn't remove that connection.", type: 'error'});
      });
    },
    [setEdges, deleteEdge, toast],
  );

  const handleConnectAndPaint = useCallback(
    (connection: Connection) => {
      onConnect(connection);
      propagateAccent(connection);
    },
    [onConnect, propagateAccent],
  );

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData(ENTITY_EMBED_DND_MIME);
      if (!raw) return;
      let entityType: string;
      try {
        entityType = (JSON.parse(raw) as {entityType: string}).entityType;
      } catch {
        return;
      }

      const size = entityEmbedSizeFor(entityType);
      const center = screenToFlowPosition({x: event.clientX, y: event.clientY});
      const positionX = Math.round(center.x - size.width / 2);
      const positionY = Math.round(center.y - size.height / 2);

      void createNode({
        nodeType: 'entity_embed',
        positionX,
        positionY,
        ...size,
        entityType: entityType as 'calendar' | 'documents' | 'expenses',
      })
        .then((created) => {
          setNodes((prev) => [...prev, toFlowNode(created)]);
        })
        .catch(() => {
          toast({body: "Couldn't add that to the canvas.", type: 'error'});
        });
    },
    [screenToFlowPosition, createNode, setNodes, toast],
  );

  /**
   * Zoom while the pointer is over a node. Every node body carries
   * `nowheel`, which makes React Flow ignore wheel events there so an
   * embedded list can scroll normally - without this, zooming only worked
   * over the empty dotted background.
   *
   * ctrl/meta + wheel is always a zoom (a trackpad pinch arrives as this).
   * A plain wheel over content that can still scroll in that direction
   * scrolls it; a plain wheel over a node with nothing left to scroll
   * zooms, so a node that cannot scroll behaves like the background does.
   */
  const zoomAtPointer = useCallback(
    (event: globalThis.WheelEvent) => {
      const container = surfaceRef.current;
      if (!container) return;
      const bounds = container.getBoundingClientRect();
      const viewport = getViewport();

      const nextZoom = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, viewport.zoom * Math.exp(-event.deltaY * 0.002)),
      );
      if (nextZoom === viewport.zoom) return;

      const pointerX = event.clientX - bounds.left;
      const pointerY = event.clientY - bounds.top;
      const flowX = (pointerX - viewport.x) / viewport.zoom;
      const flowY = (pointerY - viewport.y) / viewport.zoom;

      const next = {
        x: pointerX - flowX * nextZoom,
        y: pointerY - flowY * nextZoom,
        zoom: nextZoom,
      };
      void setViewport(next);
      onMoveEnd(undefined, next);
    },
    [getViewport, setViewport, onMoveEnd],
  );

  const zoomAtPointerRef = useRef(zoomAtPointer);
  zoomAtPointerRef.current = zoomAtPointer;

  /**
   * Bound as a native listener with `{passive: false}`, not via React's
   * `onWheelCapture` - React attaches wheel listeners at the root as
   * passive, so `preventDefault()` inside one is ignored, and an
   * unprevented ctrl+wheel also triggers the browser's own page zoom.
   */
  useEffect(() => {
    const container = surfaceRef.current;
    if (!container) return;

    function onWheel(event: globalThis.WheelEvent) {
      const target = event.target as HTMLElement | null;
      const blocked = target?.closest('.nowheel');
      if (!blocked) return;

      if (!(event.ctrlKey || event.metaKey)) {
        let node: HTMLElement | null = target;
        while (node && node !== blocked.parentElement) {
          const canScroll =
            node.scrollHeight > node.clientHeight &&
            (event.deltaY < 0
              ? node.scrollTop > 0
              : node.scrollTop + node.clientHeight < node.scrollHeight - 1);
          if (canScroll) return;
          node = node.parentElement;
        }
      }

      event.preventDefault();
      event.stopPropagation();
      zoomAtPointerRef.current(event);
    }

    container.addEventListener('wheel', onWheel, {passive: false, capture: true});
    return () => container.removeEventListener('wheel', onWheel, {capture: true});
  }, []);

  /** Double-click on the empty canvas frames every node into view. */
  const handleDoubleClick = useCallback(
    (event: MouseEvent) => {
      if ((event.target as HTMLElement).closest('.react-flow__node')) return;
      void fitView({padding: 0.3, duration: 300}).then(() => {
        onMoveEnd(undefined, getViewport());
      });
    },
    [fitView, getViewport, onMoveEnd],
  );

  return (
    <div
      ref={surfaceRef}
      style={{position: 'relative', height: '100%', width: '100%', overflow: 'hidden'}}
      onDoubleClick={handleDoubleClick}
      onDragOver={handleDragOver}
      onDrop={handleDrop}>
      <div style={infoChip}>
        <Text weight="semibold">Canvas</Text>
        <Text type="supporting" color="secondary" style={{display: 'block'}}>
          Sticky notes, links, images, and live views of the calendar, documents, and treasury.
        </Text>
      </div>
      <ReactFlow
        nodes={nodes}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onMoveEnd={onMoveEnd}
        edges={edges}
        onEdgesChange={onEdgesChange}
        onEdgeDoubleClick={handleEdgeDoubleClick}
        onConnect={handleConnectAndPaint}
        onSelectionChange={handleSelectionChange}
        // "loose": every CanvasNodeHandles dot is type="source" - loose mode
        // lets any handle both start and receive a connection, which is
        // what a plain, directionless "connect A to B" needs.
        connectionMode={ConnectionMode.Loose}
        defaultViewport={
          board
            ? {x: board.viewportX, y: board.viewportY, zoom: board.viewportZoom / 100}
            : {x: 0, y: 0, zoom: 1}
        }
        fitView={hasNoRealViewport}
        fitViewOptions={{padding: 0.3}}
        zoomOnDoubleClick={false}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        onlyRenderVisibleElements>
        <Background variant={BackgroundVariant.Dots} color="var(--color-border)" gap={24} />
      </ReactFlow>
      <CanvasAddNodeToolbar />
      <CanvasFeaturePalette />
    </div>
  );
}
