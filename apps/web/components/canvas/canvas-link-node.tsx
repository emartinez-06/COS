'use client';

import {useCallback, useEffect, useRef, useState, type CSSProperties} from 'react';
import {useReactFlow, type NodeProps} from '@xyflow/react';
import type {CanvasAccentColor} from '@cos/core';
import {useToast} from '@astryxdesign/core/Toast';
import {Icon} from '@astryxdesign/core/Icon';
import {Text} from '@astryxdesign/core/Text';
import {ArrowTopRightOnSquareIcon, TrashIcon} from '@heroicons/react/24/outline';

import {useCanvas} from '../../lib/canvas-store';
import {getVideoEmbedUrl} from '../../lib/canvas-video-embed';
import {CanvasNodeHandles} from './canvas-node-handles';
import {CanvasNodeResizer} from './canvas-node-resizer';
import {accentBorderStyle} from './canvas-node-utils';

export const LINK_NODE_DEFAULT_SIZE = {width: 280, height: 130};

/** A video needs real room to be watchable - the plain-link default is fully consumed by the header + two inputs. */
const VIDEO_NODE_MIN_SIZE = {width: 320, height: 300};

interface LinkNodeData {
  linkUrl: string | null;
  linkTitle: string | null;
  accentColor: CanvasAccentColor | null;
}

const header: CSSProperties = {
  display: 'flex',
  flexShrink: 0,
  cursor: 'grab',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const input: CSSProperties = {
  height: 28,
  width: '100%',
  borderRadius: 'var(--radius-field)',
  border: 'var(--border-width) solid var(--color-border)',
  backgroundColor: 'var(--color-background-surface)',
  paddingInline: 'var(--spacing-2)',
  fontSize: 'var(--font-size-xs)',
  color: 'var(--color-text-primary)',
};

/**
 * A freeform link card: title + url, editable in place, with an "open"
 * action once the url looks valid enough to try. Same debounced-save-then-
 * local-state pattern as the sticky note.
 *
 * When the url is a recognized YouTube/Vimeo link, the card renders an
 * inline `<iframe>` player below the title/url inputs instead of just a
 * bookmark card - no new node kind, just a richer rendering keyed off the
 * same url the officer already typed. The node auto-grows to
 * `VIDEO_NODE_MIN_SIZE` the first time it renders as a video unless it's
 * already at least that size.
 */
export function CanvasLinkNode({id, data, selected}: NodeProps) {
  const {setNodes, getNode} = useReactFlow();
  const toast = useToast();
  const {updateNodeContent, updateNodeGeometry, deleteNode} = useCanvas();
  const initial = data as unknown as LinkNodeData;
  const {accentColor} = initial;
  const [title, setTitle] = useState(initial.linkTitle ?? '');
  const [url, setUrl] = useState(initial.linkUrl ?? '');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoResizedRef = useRef(false);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );

  const scheduleSave = useCallback(
    (patch: {title?: string; url?: string}) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void updateNodeContent(id, {nodeType: 'link', ...patch}).catch(() => {
          toast({body: "Couldn't save the link - is the URL valid?", type: 'error'});
        });
      }, 500);
    },
    [id, updateNodeContent, toast],
  );

  const handleDelete = useCallback(() => {
    void deleteNode(id)
      .then(() => {
        setNodes((nodes) => nodes.filter((node) => node.id !== id));
      })
      .catch(() => {
        toast({body: "Couldn't delete the link.", type: 'error'});
      });
  }, [id, deleteNode, setNodes, toast]);

  const canOpen = /^https?:\/\//.test(url);
  const videoEmbedUrl = getVideoEmbedUrl(url);

  useEffect(() => {
    if (!videoEmbedUrl || autoResizedRef.current) return;
    autoResizedRef.current = true;

    const node = getNode(id);
    const currentWidth =
      typeof node?.style?.width === 'number' ? node.style.width : LINK_NODE_DEFAULT_SIZE.width;
    const currentHeight =
      typeof node?.style?.height === 'number' ? node.style.height : LINK_NODE_DEFAULT_SIZE.height;
    if (currentWidth >= VIDEO_NODE_MIN_SIZE.width && currentHeight >= VIDEO_NODE_MIN_SIZE.height) {
      return;
    }

    const nextSize = {
      width: Math.max(currentWidth, VIDEO_NODE_MIN_SIZE.width),
      height: Math.max(currentHeight, VIDEO_NODE_MIN_SIZE.height),
    };
    setNodes((nodes) =>
      nodes.map((n) => (n.id === id ? {...n, style: {...n.style, ...nextSize}} : n)),
    );
    void updateNodeGeometry(id, nextSize).catch(() => {
      // Best-effort: the node already visibly grew locally; a failed
      // persist just means the grown size doesn't survive a reload.
    });
  }, [videoEmbedUrl, id, getNode, setNodes, updateNodeGeometry]);

  return (
    <div className="cos-canvas-node" style={{position: 'relative', height: '100%', width: '100%'}}>
      <CanvasNodeResizer nodeId={id} isVisible={selected} minWidth={200} minHeight={100} />
      <CanvasNodeHandles />
      <div
        style={{
          display: 'flex',
          height: '100%',
          width: '100%',
          flexDirection: 'column',
          gap: 'var(--spacing-2)',
          overflow: 'hidden',
          borderRadius: 'var(--radius-container)',
          backgroundColor: 'var(--color-background-surface)',
          padding: 'var(--spacing-3)',
          boxShadow: 'var(--shadow-container)',
          ...accentBorderStyle(accentColor),
        }}>
        <div style={header}>
          <Text type="supporting" weight="semibold" color="secondary">
            {videoEmbedUrl ? 'Video' : 'Link'}
          </Text>
          <div style={{display: 'flex', alignItems: 'center', gap: 'var(--spacing-1)'}}>
            {canOpen ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                aria-label="Open link"
                className="nodrag"
                style={{display: 'flex', padding: 4, borderRadius: 'var(--radius-field)', color: 'var(--color-text-secondary)'}}>
                <Icon icon={ArrowTopRightOnSquareIcon} size="sm" />
              </a>
            ) : null}
            <button
              type="button"
              aria-label="Delete link"
              className="nodrag"
              onClick={handleDelete}
              style={{display: 'flex', padding: 4, borderRadius: 'var(--radius-field)', color: 'var(--color-text-secondary)', cursor: 'pointer'}}>
              <Icon icon={TrashIcon} size="sm" />
            </button>
          </div>
        </div>
        <input
          className="nodrag nowheel nopan"
          style={input}
          value={title}
          placeholder="Title"
          onChange={(event) => {
            setTitle(event.target.value);
            scheduleSave({title: event.target.value});
          }}
        />
        <input
          className="nodrag nowheel nopan"
          style={input}
          value={url}
          placeholder="https://…"
          onChange={(event) => {
            setUrl(event.target.value);
            scheduleSave({url: event.target.value});
          }}
        />
        {videoEmbedUrl ? (
          <iframe
            key={videoEmbedUrl}
            src={videoEmbedUrl}
            title={title || 'Embedded video'}
            className="nodrag nowheel nopan"
            style={{
              minHeight: 0,
              flex: 1,
              borderRadius: 'var(--radius-field)',
              border: 'var(--border-width) solid var(--color-border)',
            }}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : null}
      </div>
    </div>
  );
}
