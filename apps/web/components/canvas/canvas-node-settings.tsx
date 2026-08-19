'use client';

import {useEffect, useState, type CSSProperties} from 'react';
import {
  ALL_CANVAS_ACCENT_COLORS,
  CANVAS_ACCENT_COLOR_HEX,
  CANVAS_ACCENT_COLOR_LABELS,
  type CanvasAccentColor,
} from '@cos/core';
import {Button} from '@astryxdesign/core/Button';
import {Icon} from '@astryxdesign/core/Icon';
import {Text} from '@astryxdesign/core/Text';
import {CheckIcon, TrashIcon, XMarkIcon} from '@heroicons/react/24/outline';

/** Nothing useful renders below this, and it stops a fat-fingered 20px node. */
const MIN_DIMENSION = 200;
/** A node larger than the flow area it lives in is unreachable without zooming out. */
const MAX_DIMENSION = 2400;

const panel: CSSProperties = {
  position: 'absolute',
  right: 0,
  top: '100%',
  zIndex: 50,
  marginTop: 'var(--spacing-1)',
  width: 240,
  borderRadius: 'var(--radius-container)',
  border: 'var(--border-width) solid var(--color-border)',
  backgroundColor: 'var(--color-background-surface)',
  padding: 'var(--spacing-3)',
  boxShadow: 'var(--shadow-container)',
};

const swatchBase: CSSProperties = {
  display: 'flex',
  height: 24,
  width: 24,
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--radius-full)',
  border: 'var(--border-width) solid var(--color-border)',
  cursor: 'pointer',
};

const visuallyHidden: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

const sizeInput: CSSProperties = {
  height: 28,
  width: '100%',
  borderRadius: 'var(--radius-field)',
  border: 'var(--border-width) solid var(--color-border)',
  backgroundColor: 'var(--color-background-surface)',
  paddingInline: 'var(--spacing-2)',
  fontSize: 'var(--font-size-xs)',
  color: 'var(--color-text-primary)',
};

export interface CanvasNodeSettingsProps {
  title: string;
  width: number;
  height: number;
  accentColor: CanvasAccentColor | null;
  /** Floor from the embed's own `CanvasEmbedShell` minWidth/minHeight, when it declares one. */
  minWidth?: number;
  minHeight?: number;
  onApplySize: (size: {width: number; height: number}) => void;
  onAccentChange: (color: CanvasAccentColor | null) => void;
  /**
   * Set once the node has any connection. A colour then belongs to the
   * whole cluster rather than the node, so changing it here would silently
   * disagree with the group it is wired into - disconnect first if the
   * cluster really needs recolouring.
   */
  accentLocked?: boolean;
  /** Remove the node from the board. */
  onRemove?: () => void;
  /** What removing does, shown under the remove button. */
  removeCaption?: string;
  onClose: () => void;
}

/**
 * Per-node settings, opened by double-clicking a node's header.
 *
 * The header, not the body: the body belongs to the embedded content, which
 * has its own double-click meanings in places (text selection in a sticky
 * note). Binding this to the whole node would shadow that.
 *
 * Size is applied on an explicit Apply rather than per-keystroke: a
 * partially-typed "6" in a width field would otherwise resize the node to
 * 6px wide and lose it off-screen before the rest of the number arrives.
 */
export function CanvasNodeSettings({
  title,
  width,
  height,
  accentColor,
  minWidth,
  minHeight,
  onApplySize,
  onAccentChange,
  onRemove,
  removeCaption = 'Removes it from the board. This can’t be undone.',
  onClose,
  accentLocked = false,
}: CanvasNodeSettingsProps) {
  const [draftWidth, setDraftWidth] = useState(String(Math.round(width)));
  const [draftHeight, setDraftHeight] = useState(String(Math.round(height)));
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const floorWidth = Math.max(MIN_DIMENSION, minWidth ?? 0);
  const floorHeight = Math.max(MIN_DIMENSION, minHeight ?? 0);

  // Escape closes, matching every other dismissible surface in the app.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function clamp(raw: string, floor: number): number {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return floor;
    return Math.min(MAX_DIMENSION, Math.max(floor, parsed));
  }

  function applySize() {
    const next = {
      width: clamp(draftWidth, floorWidth),
      height: clamp(draftHeight, floorHeight),
    };
    // Reflect any clamping back into the inputs, so a rejected value doesn't
    // sit there looking applied.
    setDraftWidth(String(next.width));
    setDraftHeight(String(next.height));
    onApplySize(next);
  }

  return (
    <div
      // `nodrag nowheel nopan`: without these, dragging to select text in a
      // number input pans the board and scrolling over the panel zooms it.
      className="nodrag nowheel nopan"
      style={panel}
      role="dialog"
      aria-label={`${title} settings`}>
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
        <Text type="supporting" weight="semibold" color="secondary">
          Settings
        </Text>
        <button
          type="button"
          aria-label="Close settings"
          onClick={onClose}
          style={{
            display: 'flex',
            padding: 2,
            borderRadius: 'var(--radius-field)',
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
          }}>
          <Icon icon={XMarkIcon} size="sm" />
        </button>
      </div>

      <Text type="supporting" color="secondary" style={{marginTop: 'var(--spacing-2)'}}>
        Accent
      </Text>
      <div
        style={{
          marginTop: 'var(--spacing-1)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 'var(--spacing-1-5)',
        }}>
        <button
          type="button"
          aria-label="No accent colour"
          aria-pressed={accentColor === null}
          disabled={accentLocked}
          onClick={() => onAccentChange(null)}
          style={{
            ...swatchBase,
            backgroundColor: 'var(--color-background-muted)',
            color: 'var(--color-text-secondary)',
            opacity: accentLocked ? 0.4 : 1,
            cursor: accentLocked ? 'not-allowed' : 'pointer',
            boxShadow:
              accentColor === null ? '0 0 0 2px var(--color-accent)' : undefined,
          }}>
          <Icon icon={XMarkIcon} size="sm" />
        </button>
        {ALL_CANVAS_ACCENT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`Set accent to ${CANVAS_ACCENT_COLOR_LABELS[color]}`}
            aria-pressed={accentColor === color}
            title={
              accentLocked
                ? 'Disconnect this node to change its colour'
                : CANVAS_ACCENT_COLOR_LABELS[color]
            }
            disabled={accentLocked}
            onClick={() => onAccentChange(color)}
            style={{
              ...swatchBase,
              border: 'none',
              backgroundColor: CANVAS_ACCENT_COLOR_HEX[color],
              opacity: accentLocked ? 0.4 : 1,
              cursor: accentLocked ? 'not-allowed' : 'pointer',
              boxShadow:
                accentColor === color ? '0 0 0 2px var(--color-accent)' : undefined,
            }}>
            {accentColor === color ? (
              <Icon icon={CheckIcon} size="sm" style={{color: '#FFFFFF'}} />
            ) : null}
          </button>
        ))}
      </div>
      <Text type="supporting" color="secondary" style={{marginTop: 'var(--spacing-1)', display: 'block'}}>
        {accentLocked
          ? 'Locked while connected - the colour belongs to the cluster.'
          : 'Also colours every connection leaving this node.'}
      </Text>

      <Text
        type="supporting"
        color="secondary"
        style={{marginTop: 'var(--spacing-3)', display: 'block'}}>
        Size
      </Text>
      <div
        style={{
          marginTop: 'var(--spacing-1)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--spacing-1-5)',
        }}>
        <label htmlFor="canvas-node-width" style={visuallyHidden}>
          Width in pixels
        </label>
        <input
          id="canvas-node-width"
          type="number"
          inputMode="numeric"
          value={draftWidth}
          min={floorWidth}
          max={MAX_DIMENSION}
          onChange={(event) => setDraftWidth(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && applySize()}
          style={sizeInput}
        />
        <Text type="supporting" color="secondary">
          x
        </Text>
        <label htmlFor="canvas-node-height" style={visuallyHidden}>
          Height in pixels
        </label>
        <input
          id="canvas-node-height"
          type="number"
          inputMode="numeric"
          value={draftHeight}
          min={floorHeight}
          max={MAX_DIMENSION}
          onChange={(event) => setDraftHeight(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && applySize()}
          style={sizeInput}
        />
        <Button label="Apply" variant="secondary" size="sm" onClick={applySize} />
      </div>

      {onRemove ? (
        <>
          <div
            style={{
              marginBlock: 'var(--spacing-3)',
              borderTop: 'var(--border-width) solid var(--color-border)',
            }}
          />
          {confirmingRemove ? (
            <div style={{display: 'flex', alignItems: 'center', gap: 'var(--spacing-1-5)'}}>
              <Button
                label="Remove"
                variant="destructive"
                size="sm"
                icon={<Icon icon={TrashIcon} size="sm" />}
                onClick={onRemove}
                style={{flex: 1}}
              />
              <Button
                label="Cancel"
                variant="secondary"
                size="sm"
                onClick={() => setConfirmingRemove(false)}
              />
            </div>
          ) : (
            <Button
              label="Remove"
              variant="secondary"
              size="sm"
              icon={<Icon icon={TrashIcon} size="sm" />}
              onClick={() => setConfirmingRemove(true)}
              style={{width: '100%'}}
            />
          )}
          <Text
            type="supporting"
            color="secondary"
            style={{marginTop: 'var(--spacing-1)', display: 'block'}}>
            {removeCaption}
          </Text>
        </>
      ) : null}
    </div>
  );
}
