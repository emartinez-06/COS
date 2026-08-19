'use client';

import {useCallback} from 'react';
import {NodeResizer, type OnResizeEnd} from '@xyflow/react';
import {useToast} from '@astryxdesign/core/Toast';

import {useCanvas} from '../../lib/canvas-store';

/** Matches the settings panel's own ceiling, so the two ways to resize agree on the limit. */
const MAX_DIMENSION = 2400;

export interface CanvasNodeResizerProps {
  nodeId: string;
  /** Handles are revealed on selection only - four dots on every node would be constant noise. */
  isVisible: boolean;
  minWidth: number;
  minHeight: number;
}

/**
 * Corner/edge drag-to-resize for every canvas node type.
 *
 * Persistence hangs off `onResizeEnd`, not `onResize` - the latter fires on
 * every pointer frame, which would be a PATCH per pixel. Position is
 * written alongside size because dragging a top or left handle moves the
 * node's origin as well as its dimensions; saving only width/height there
 * would snap the node back on reload.
 *
 * React Flow applies the resize to its own store synchronously as you drag,
 * so there is no optimistic local update to make here - only the write.
 */
export function CanvasNodeResizer({
  nodeId,
  isVisible,
  minWidth,
  minHeight,
}: CanvasNodeResizerProps) {
  const {updateNodeGeometry} = useCanvas();
  const toast = useToast();

  const handleResizeEnd = useCallback<OnResizeEnd>(
    (_event, params) => {
      void updateNodeGeometry(nodeId, {
        width: Math.round(params.width),
        height: Math.round(params.height),
        positionX: Math.round(params.x),
        positionY: Math.round(params.y),
      }).catch(() => {
        toast({body: "Couldn't save the new size.", type: 'error'});
      });
    },
    [nodeId, updateNodeGeometry, toast],
  );

  return (
    <NodeResizer
      nodeId={nodeId}
      isVisible={isVisible}
      minWidth={minWidth}
      minHeight={minHeight}
      maxWidth={MAX_DIMENSION}
      maxHeight={MAX_DIMENSION}
      onResizeEnd={handleResizeEnd}
      // `nodrag` on the handles: without it React Flow treats the
      // pointerdown as the start of a node drag and the node moves instead
      // of resizing.
      handleClassName="nodrag"
      handleStyle={{
        height: 8,
        width: 8,
        borderRadius: 2,
        border: 'var(--border-width) solid var(--color-accent)',
        backgroundColor: 'var(--color-background-surface)',
      }}
      lineStyle={{borderColor: 'var(--color-accent)'}}
    />
  );
}
