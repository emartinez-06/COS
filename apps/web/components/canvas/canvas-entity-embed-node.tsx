'use client';

import {useCallback} from 'react';
import {useEdges, useReactFlow, type NodeProps} from '@xyflow/react';
import {
  CANVAS_EMBED_ENTITY_LABELS,
  type CanvasAccentColor,
  type CanvasEmbedEntityType,
} from '@cos/core';
import {useToast} from '@astryxdesign/core/Toast';
import {Icon} from '@astryxdesign/core/Icon';
import {Text} from '@astryxdesign/core/Text';
import {ExclamationTriangleIcon} from '@heroicons/react/24/outline';

import {useCanvas} from '../../lib/canvas-store';
import {CanvasEmbedShell} from './canvas-embed-shell';
import {ENTITY_EMBED_RENDERERS} from './entity-embed-registry';
import {entityEmbedMinSizeFor} from './canvas-node-utils';

interface EntityEmbedNodeData {
  embedEntityType: CanvasEmbedEntityType;
  accentColor: CanvasAccentColor | null;
}

/**
 * The generic `entity_embed` node. Dispatches to the registered renderer
 * for `data.embedEntityType` via `ENTITY_EMBED_RENDERERS`; a type with no
 * registered renderer shows a plain "not available" state rather than
 * crashing - reachable only if the registry and the schema's enum ever
 * drift, which `entity-embed-registry.test.ts`-style coverage guards
 * against.
 *
 * Owns the size/accent writes for the settings panel. Both are optimistic:
 * the node updates locally and the write follows, because waiting on a
 * round trip to redraw a border colour feels broken. A failed write toasts
 * and the change reverts on the next board load.
 */
export function CanvasEntityEmbedNode({id, data, selected}: NodeProps) {
  const {setNodes} = useReactFlow();
  const toast = useToast();
  const {deleteNode, updateNodeGeometry} = useCanvas();
  const {embedEntityType, accentColor} = data as unknown as EntityEmbedNodeData;

  const handleDelete = useCallback(() => {
    void deleteNode(id)
      .then(() => {
        setNodes((nodes) => nodes.filter((node) => node.id !== id));
      })
      .catch(() => {
        toast({body: "Couldn't remove it from the board.", type: 'error'});
      });
  }, [id, deleteNode, setNodes, toast]);

  const handleApplySize = useCallback(
    (size: {width: number; height: number}) => {
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id ? {...node, style: {...node.style, ...size}} : node,
        ),
      );
      void updateNodeGeometry(id, size).catch(() => {
        toast({body: "Couldn't save the new size.", type: 'error'});
      });
    },
    [id, setNodes, updateNodeGeometry, toast],
  );

  const handleAccentChange = useCallback(
    (color: CanvasAccentColor | null) => {
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id ? {...node, data: {...node.data, accentColor: color}} : node,
        ),
      );
      void updateNodeGeometry(id, {accentColor: color}).catch(() => {
        toast({body: "Couldn't save the colour.", type: 'error'});
      });
    },
    [id, setNodes, updateNodeGeometry, toast],
  );

  const Renderer = ENTITY_EMBED_RENDERERS[embedEntityType];
  const min = entityEmbedMinSizeFor(embedEntityType);
  // A connected node's colour belongs to its cluster, so the swatch locks.
  const edges = useEdges();
  const isConnected = edges.some((edge) => edge.source === id || edge.target === id);

  const node = useReactFlow().getNode(id);
  const currentWidth = Number(node?.style?.width ?? node?.measured?.width ?? min.width);
  const currentHeight = Number(node?.style?.height ?? node?.measured?.height ?? min.height);

  return (
    <CanvasEmbedShell
      title={CANVAS_EMBED_ENTITY_LABELS[embedEntityType]}
      onDelete={handleDelete}
      minWidth={min.width}
      minHeight={min.height}
      width={currentWidth}
      height={currentHeight}
      accentColor={accentColor ?? null}
      onApplySize={handleApplySize}
      onAccentChange={handleAccentChange}
      nodeId={id}
      selected={selected}
      accentLocked={isConnected}>
      {Renderer ? (
        <Renderer nodeId={id} />
      ) : (
        <div
          style={{
            display: 'flex',
            height: '100%',
            width: '100%',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--spacing-2)',
            textAlign: 'center',
          }}>
          <Icon icon={ExclamationTriangleIcon} color="secondary" />
          <Text type="supporting" color="secondary">
            This isn’t embeddable yet.
          </Text>
        </div>
      )}
    </CanvasEmbedShell>
  );
}
