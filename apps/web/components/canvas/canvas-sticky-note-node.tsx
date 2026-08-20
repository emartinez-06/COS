'use client';

import {useCallback, useEffect, useRef, useState, type CSSProperties} from 'react';
import {useReactFlow, type NodeProps} from '@xyflow/react';
import {
  ALL_STICKY_NOTE_COLORS,
  CANVAS_ACCENT_COLOR_HEX,
  STICKY_NOTE_COLOR_HEX,
  STICKY_NOTE_COLOR_LABELS,
  type CanvasAccentColor,
  type StickyNoteColor,
} from '@cos/core';
import {useToast} from '@astryxdesign/core/Toast';
import {Icon} from '@astryxdesign/core/Icon';
import {TrashIcon} from '@heroicons/react/24/outline';

import {useCanvas} from '../../lib/canvas-store';
import {CanvasNodeHandles} from './canvas-node-handles';
import {CanvasNodeResizer} from './canvas-node-resizer';
import {accentBorderStyle, readableTextColor} from './canvas-node-utils';

export const STICKY_NOTE_DEFAULT_SIZE = {width: 240, height: 200};

interface StickyNoteNodeData {
  stickyNoteText: string | null;
  stickyNoteColor: StickyNoteColor | null;
  accentColor: CanvasAccentColor | null;
}

const header: CSSProperties = {
  display: 'flex',
  flexShrink: 0,
  cursor: 'grab',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingInline: 'var(--spacing-2)',
  paddingBlock: 'var(--spacing-1-5)',
};

const textarea: CSSProperties = {
  minHeight: 0,
  flex: 1,
  resize: 'none',
  border: 'none',
  backgroundColor: 'transparent',
  paddingInline: 'var(--spacing-3)',
  paddingBlock: 'var(--spacing-2)',
  fontSize: 'var(--font-size-sm)',
  fontFamily: 'inherit',
};

/**
 * A freeform sticky note. Text/colour edits are debounced (one write per
 * pause in typing, not per keystroke); delete removes the row via
 * `useCanvas().deleteNode`, then drops the node from React Flow's own
 * state - a structural change React Flow needs to know about, unlike a
 * content edit, which this component tracks entirely in local state.
 *
 * Only the header is React-Flow-draggable; the swatches/delete button
 * inside it opt back out via `nodrag`. The textarea gets
 * `nodrag nowheel nopan` so typing/selecting text never pans or zooms the
 * board.
 *
 * **Text live-refreshes from a remote edit**, gated on two things: the
 * textarea must not be focused (never steal keystrokes out from under
 * someone typing), and this tab must not have an edit of its own still in
 * flight (`hasPendingEditRef`) - without that second guard, blurring right
 * after typing would apply the *stale* pre-edit value the instant focus
 * left, since the debounced save has not reached the server yet and the
 * WS echo carrying the real value has not arrived. The guard clears once
 * that save settles, and the echo's own arrival is what re-triggers the
 * sync a moment later.
 */
export function CanvasStickyNoteNode({id, data, selected}: NodeProps) {
  const {setNodes} = useReactFlow();
  const toast = useToast();
  const {updateNodeContent, updateNodeGeometry, deleteNode} = useCanvas();
  const initial = data as unknown as StickyNoteNodeData;
  const {accentColor} = initial;
  const [text, setText] = useState(initial.stickyNoteText ?? '');
  const [color, setColor] = useState<StickyNoteColor>(
    initial.stickyNoteColor ?? 'yellow',
  );
  const [isFocused, setIsFocused] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasPendingEditRef = useRef(false);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (isFocused || hasPendingEditRef.current) return;
    setText(initial.stickyNoteText ?? '');
  }, [initial.stickyNoteText, isFocused]);

  const scheduleSave = useCallback(
    (patch: {text?: string; color?: StickyNoteColor}) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      hasPendingEditRef.current = true;
      saveTimerRef.current = setTimeout(() => {
        void updateNodeContent(id, {nodeType: 'sticky_note', ...patch})
          .catch(() => {
            toast({body: "Couldn't save the sticky note.", type: 'error'});
          })
          .finally(() => {
            hasPendingEditRef.current = false;
          });
      }, 500);
    },
    [id, updateNodeContent, toast],
  );

  /**
   * Picking a fill swatch also clears any inherited accent.
   *
   * Without this the swatch buttons become dead controls the moment a note
   * is connected to a coloured node: the accent overrides the fill, so
   * clicking a colour would save a value that is never shown. Choosing a
   * colour by hand is an explicit act, so it wins over the inherited one.
   */
  const handlePickColor = useCallback(
    (value: StickyNoteColor) => {
      setColor(value);
      scheduleSave({color: value});
      if (!accentColor) return;
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === id ? {...node, data: {...node.data, accentColor: null}} : node,
        ),
      );
      void updateNodeGeometry(id, {accentColor: null}).catch(() => {
        toast({body: "Couldn't clear the inherited colour.", type: 'error'});
      });
    },
    [accentColor, id, scheduleSave, setNodes, updateNodeGeometry, toast],
  );

  const handleDelete = useCallback(() => {
    void deleteNode(id)
      .then(() => {
        setNodes((nodes) => nodes.filter((node) => node.id !== id));
      })
      .catch(() => {
        toast({body: "Couldn't delete the sticky note.", type: 'error'});
      });
  }, [id, deleteNode, setNodes, toast]);

  // An accent, when present, IS the note's colour; its own swatch stays
  // stored underneath, so clearing the accent restores it.
  const fill = accentColor ? CANVAS_ACCENT_COLOR_HEX[accentColor] : STICKY_NOTE_COLOR_HEX[color];
  const foreground = readableTextColor(fill);
  const isLightOnDark = foreground === '#FFFFFF';

  return (
    <div className="cos-canvas-node" style={{position: 'relative', height: '100%', width: '100%'}}>
      <CanvasNodeResizer nodeId={id} isVisible={selected} minWidth={140} minHeight={120} />
      <CanvasNodeHandles />
      <div
        style={{
          display: 'flex',
          height: '100%',
          width: '100%',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRadius: 'var(--radius-container)',
          boxShadow: 'var(--shadow-container)',
          backgroundColor: fill,
          ...accentBorderStyle(accentColor),
        }}>
        <div style={header}>
          <div style={{display: 'flex', gap: 'var(--spacing-1)'}}>
            {ALL_STICKY_NOTE_COLORS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={`Set colour to ${STICKY_NOTE_COLOR_LABELS[swatch]}`}
                aria-pressed={color === swatch}
                className="nodrag"
                onClick={() => handlePickColor(swatch)}
                style={{
                  height: 16,
                  width: 16,
                  flexShrink: 0,
                  borderRadius: 'var(--radius-full)',
                  backgroundColor: STICKY_NOTE_COLOR_HEX[swatch],
                  border:
                    color === swatch
                      ? `2px solid ${isLightOnDark ? '#FFFFFF' : '#111827'}`
                      : `1px solid ${isLightOnDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.2)'}`,
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
          <button
            type="button"
            aria-label="Delete sticky note"
            className="nodrag"
            onClick={handleDelete}
            style={{
              display: 'flex',
              padding: 4,
              borderRadius: 'var(--radius-field)',
              color: isLightOnDark ? 'rgba(255,255,255,0.8)' : 'var(--color-text-secondary)',
              cursor: 'pointer',
            }}>
            <Icon icon={TrashIcon} size="sm" />
          </button>
        </div>
        <textarea
          className="nodrag nowheel nopan"
          style={{...textarea, color: foreground}}
          value={text}
          placeholder="Type a note…"
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onChange={(event) => {
            setText(event.target.value);
            scheduleSave({text: event.target.value});
          }}
        />
      </div>
    </div>
  );
}
