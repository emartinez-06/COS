'use client';

/**
 * A top-left name tag showing which officer(s) currently have a node
 * selected, layered onto any node type with no change to the node itself.
 *
 * Only `entity_embed` nodes share a wrapper today (`CanvasEmbedShell`); the
 * other three (`sticky_note`, `link`, `image`) each duplicate a
 * `cos-canvas-node` root inline. `withCanvasPresence` wraps at the
 * `nodeTypes` map level in `canvas-board.tsx` instead of touching any of
 * the five node component files - its own `position: relative` container
 * is what the tag anchors to, independent of whatever root the wrapped
 * component renders inside it.
 */

import type {ComponentType, CSSProperties} from 'react';
import type {NodeProps} from '@xyflow/react';
import {Token} from '@astryxdesign/core/Token';

import {useCanvasPresence} from '../../lib/canvas-presence-store';

const tagStackStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(-1 * (var(--spacing-2) + 20px))',
  left: 0,
  display: 'flex',
  gap: 'var(--spacing-1)',
  zIndex: 20,
  // Purely informational - a tag must never intercept the drag/click that
  // would otherwise reach the node underneath it.
  pointerEvents: 'none',
};

function CanvasPresenceTags({nodeId}: {nodeId: string}) {
  const {entriesByNodeId} = useCanvasPresence();
  const entries = entriesByNodeId.get(nodeId);
  if (!entries || entries.length === 0) {
    return null;
  }

  return (
    <div style={tagStackStyle}>
      {entries.map((entry) => (
        <Token
          key={entry.userId}
          size="sm"
          label={entry.name}
          color={
            entry.positionColor as React.ComponentProps<typeof Token>['color']
          }
        />
      ))}
    </div>
  );
}

export function withCanvasPresence(
  NodeComponent: ComponentType<NodeProps>,
): ComponentType<NodeProps> {
  function WithCanvasPresence(props: NodeProps) {
    return (
      <div style={{position: 'relative', width: '100%', height: '100%'}}>
        <CanvasPresenceTags nodeId={props.id} />
        <NodeComponent {...props} />
      </div>
    );
  }
  WithCanvasPresence.displayName = `withCanvasPresence(${
    NodeComponent.displayName ?? NodeComponent.name ?? 'Node'
  })`;
  return WithCanvasPresence;
}
