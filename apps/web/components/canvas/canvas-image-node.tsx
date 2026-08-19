'use client';

import {useEffect, useState, type CSSProperties} from 'react';
import {useReactFlow, type NodeProps} from '@xyflow/react';
import type {CanvasAccentColor} from '@cos/core';
import {useToast} from '@astryxdesign/core/Toast';
import {Icon} from '@astryxdesign/core/Icon';
import {Spinner} from '@astryxdesign/core/Spinner';
import {Text} from '@astryxdesign/core/Text';
import {PhotoIcon, TrashIcon} from '@heroicons/react/24/outline';

import {useCanvas} from '../../lib/canvas-store';
import {CanvasNodeHandles} from './canvas-node-handles';
import {CanvasNodeResizer} from './canvas-node-resizer';
import {accentBorderStyle} from './canvas-node-utils';

export const IMAGE_NODE_DEFAULT_SIZE = {width: 320, height: 260};

interface ImageNodeData {
  accentColor: CanvasAccentColor | null;
}

/**
 * A freeform image node. Fetches its own bytes client-side on mount as a
 * `Blob` (through `useCanvas().repository.downloadImage`, the same
 * repository-exposed-directly pattern the document hub uses for its own
 * downloads) and renders them as an object URL - a plain `<img src>`
 * pointed at the API can't carry the session cookie cross-origin.
 *
 * Deleting the node also deletes the underlying object in storage - handled
 * server-side by `canvas-store.ts`'s `deleteNode`, so there is nothing extra
 * to clean up here, unlike a design where the client owned that step.
 */
export function CanvasImageNode({id, data, selected}: NodeProps) {
  const {setNodes} = useReactFlow();
  const toast = useToast();
  const {repository, clubId, deleteNode} = useCanvas();
  const {accentColor} = data as unknown as ImageNodeData;

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setLoadError(false);

    repository
      .downloadImage(clubId, id)
      .then((bytes) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(bytes as Blob);
        setImageUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [repository, clubId, id]);

  const handleDelete = () => {
    void deleteNode(id)
      .then(() => {
        setNodes((nodes) => nodes.filter((node) => node.id !== id));
      })
      .catch(() => {
        toast({body: "Couldn't delete the image.", type: 'error'});
      });
  };

  const emptyState: CSSProperties = {
    display: 'flex',
    height: '100%',
    width: '100%',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--spacing-1)',
    color: 'var(--color-text-secondary)',
  };

  return (
    <div className="cos-canvas-node" style={{position: 'relative', height: '100%', width: '100%'}}>
      <CanvasNodeResizer nodeId={id} isVisible={selected} minWidth={160} minHeight={120} />
      <CanvasNodeHandles />
      <div
        style={{
          display: 'flex',
          height: '100%',
          width: '100%',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRadius: 'var(--radius-container)',
          backgroundColor: 'var(--color-background-surface)',
          boxShadow: 'var(--shadow-container)',
          ...accentBorderStyle(accentColor),
        }}>
        <div
          style={{
            display: 'flex',
            flexShrink: 0,
            cursor: 'grab',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingInline: 'var(--spacing-2)',
            paddingBlock: 'var(--spacing-1-5)',
          }}>
          <Text type="supporting" weight="semibold" color="secondary">
            Image
          </Text>
          <button
            type="button"
            aria-label="Delete image"
            className="nodrag"
            onClick={handleDelete}
            style={{
              display: 'flex',
              padding: 4,
              borderRadius: 'var(--radius-field)',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
            }}>
            <Icon icon={TrashIcon} size="sm" />
          </button>
        </div>
        <div className="nodrag nowheel nopan" style={{minHeight: 0, flex: 1, overflow: 'hidden'}}>
          {loadError ? (
            <div style={emptyState}>
              <Icon icon={PhotoIcon} />
              <Text type="supporting" color="secondary">
                Couldn’t load this image.
              </Text>
            </div>
          ) : !imageUrl ? (
            <div style={emptyState}>
              <Spinner size="sm" />
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- a blob object URL, not a static asset Next can optimize.
            <img
              src={imageUrl}
              alt=""
              style={{height: '100%', width: '100%', objectFit: 'contain'}}
            />
          )}
        </div>
      </div>
    </div>
  );
}
