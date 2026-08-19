'use client';

import {useCallback, useRef, useState, type ChangeEvent, type CSSProperties} from 'react';
import {useReactFlow} from '@xyflow/react';
import {MAX_CANVAS_IMAGE_BYTES} from '@cos/core';
import {Button} from '@astryxdesign/core/Button';
import {Icon} from '@astryxdesign/core/Icon';
import {useToast} from '@astryxdesign/core/Toast';
import {
  LinkIcon,
  PencilSquareIcon,
  PhotoIcon,
} from '@heroicons/react/24/outline';

import {useCanvas} from '../../lib/canvas-store';
import {LINK_NODE_DEFAULT_SIZE} from './canvas-link-node';
import {STICKY_NOTE_DEFAULT_SIZE} from './canvas-sticky-note-node';
import {IMAGE_NODE_DEFAULT_SIZE} from './canvas-image-node';
import {toFlowNode} from './canvas-node-utils';

const wrapper: CSSProperties = {
  position: 'absolute',
  right: 'var(--spacing-4)',
  top: 'var(--spacing-4)',
  zIndex: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--spacing-2)',
  borderRadius: 'var(--radius-container)',
  border: 'var(--border-width) solid var(--color-border)',
  backgroundColor: 'var(--color-background-surface)',
  padding: 'var(--spacing-2)',
  boxShadow: 'var(--shadow-container)',
};

const hiddenFileInput: CSSProperties = {display: 'none'};

/**
 * Floating add-node toolbar. Drops a new node centred on whatever's
 * currently visible on screen - converted from screen space to flow space
 * via `screenToFlowPosition`, the conversion React Flow's own docs use for
 * external drop targets.
 */
export function CanvasAddNodeToolbar() {
  const {screenToFlowPosition, setNodes} = useReactFlow();
  const {createNode} = useCanvas();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const centeredPosition = useCallback(
    (size: {width: number; height: number}) => {
      const flowCenter = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      return {
        positionX: Math.round(flowCenter.x - size.width / 2),
        positionY: Math.round(flowCenter.y - size.height / 2),
      };
    },
    [screenToFlowPosition],
  );

  const handleAddStickyNote = useCallback(() => {
    const {positionX, positionY} = centeredPosition(STICKY_NOTE_DEFAULT_SIZE);
    void createNode({
      nodeType: 'sticky_note',
      positionX,
      positionY,
      ...STICKY_NOTE_DEFAULT_SIZE,
      text: '',
      color: 'yellow',
    })
      .then((created) => {
        setNodes((nodes) => [...nodes, toFlowNode(created)]);
      })
      .catch(() => {
        toast({body: "Couldn't add a sticky note.", type: 'error'});
      });
  }, [centeredPosition, createNode, setNodes, toast]);

  const handleAddLink = useCallback(() => {
    const {positionX, positionY} = centeredPosition(LINK_NODE_DEFAULT_SIZE);
    void createNode({
      nodeType: 'link',
      positionX,
      positionY,
      ...LINK_NODE_DEFAULT_SIZE,
      url: 'https://example.com',
      title: 'New link',
    })
      .then((created) => {
        setNodes((nodes) => [...nodes, toFlowNode(created)]);
      })
      .catch(() => {
        toast({body: "Couldn't add a link.", type: 'error'});
      });
  }, [centeredPosition, createNode, setNodes, toast]);

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;

      if (!file.type.startsWith('image/')) {
        toast({body: 'Only image files can be added this way.', type: 'error'});
        return;
      }
      if (file.size > MAX_CANVAS_IMAGE_BYTES) {
        toast({
          body: `That image is larger than the ${Math.floor(MAX_CANVAS_IMAGE_BYTES / (1024 * 1024))} MB limit.`,
          type: 'error',
        });
        return;
      }

      const {positionX, positionY} = centeredPosition(IMAGE_NODE_DEFAULT_SIZE);

      setUploading(true);
      void createNode(
        {nodeType: 'image', positionX, positionY, ...IMAGE_NODE_DEFAULT_SIZE},
        file,
      )
        .then((created) => {
          setNodes((nodes) => [...nodes, toFlowNode(created)]);
        })
        .catch(() => {
          toast({body: "Couldn't upload that image.", type: 'error'});
        })
        .finally(() => {
          setUploading(false);
        });
    },
    [centeredPosition, createNode, setNodes, toast],
  );

  return (
    <div style={wrapper}>
      <Button
        type="button"
        label="Sticky note"
        variant="secondary"
        size="sm"
        icon={<Icon icon={PencilSquareIcon} size="sm" />}
        onClick={handleAddStickyNote}
      />
      <Button
        type="button"
        label="Link"
        variant="secondary"
        size="sm"
        icon={<Icon icon={LinkIcon} size="sm" />}
        onClick={handleAddLink}
      />
      <Button
        type="button"
        label="Image"
        variant="secondary"
        size="sm"
        icon={<Icon icon={PhotoIcon} size="sm" />}
        isLoading={uploading}
        onClick={() => fileInputRef.current?.click()}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={hiddenFileInput}
        onChange={handleFileChange}
      />
    </div>
  );
}
