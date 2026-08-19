'use client';

import {useState, type CSSProperties, type ReactNode} from 'react';
import type {CanvasAccentColor} from '@cos/core';
import {Icon} from '@astryxdesign/core/Icon';
import {Text} from '@astryxdesign/core/Text';
import {Cog6ToothIcon, TrashIcon} from '@heroicons/react/24/outline';

import {CanvasNodeHandles} from './canvas-node-handles';
import {CanvasNodeResizer} from './canvas-node-resizer';
import {CanvasNodeSettings} from './canvas-node-settings';
import {accentBorderStyle} from './canvas-node-utils';

const body: CSSProperties = {
  display: 'flex',
  height: '100%',
  width: '100%',
  flexDirection: 'column',
  overflow: 'hidden',
  borderRadius: 'var(--radius-container)',
  border: 'var(--border-width) solid var(--color-border)',
  backgroundColor: 'var(--color-background-surface)',
  boxShadow: 'var(--shadow-container)',
};

const header: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexShrink: 0,
  cursor: 'grab',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--spacing-2)',
  borderBottom: 'var(--border-width) solid var(--color-border)',
  backgroundColor: 'var(--color-background-muted)',
  paddingInline: 'var(--spacing-3)',
  paddingBlock: 'var(--spacing-2)',
};

const titleRow: CSSProperties = {
  display: 'flex',
  minWidth: 0,
  alignItems: 'center',
  gap: 'var(--spacing-1-5)',
};

const iconButton: CSSProperties = {
  display: 'flex',
  padding: 4,
  borderRadius: 'var(--radius-field)',
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
};

const contentArea: CSSProperties = {
  minHeight: 0,
  flex: 1,
  overflow: 'hidden',
  padding: 'var(--spacing-4)',
};

export interface CanvasEmbedShellProps {
  title: string;
  /** Renders a trash button in the header when given; omit for a node with no delete action. */
  onDelete?: () => void;
  /** Extra header controls (e.g. an "open" link), rendered before the delete button. */
  headerActions?: ReactNode;
  /**
   * Enforced via inline `min-width`/`min-height` (not just the node's own
   * resize handles) - a dense list degrades badly at sticky-note dimensions.
   */
  minWidth?: number;
  minHeight?: number;
  /** Current persisted size, shown in (and edited from) the settings panel. */
  width?: number;
  height?: number;
  /** null = default border. One of `CanvasAccentColor` otherwise. */
  accentColor?: CanvasAccentColor | null;
  onApplySize?: (size: {width: number; height: number}) => void;
  onAccentChange?: (color: CanvasAccentColor | null) => void;
  /** Node id + selection state, for the drag-to-resize handles. */
  nodeId?: string;
  selected?: boolean;
  /** True once the node has any connection - locks the accent swatch. */
  accentLocked?: boolean;
  /**
   * The embedded feature's own content, including its own loading/error
   * chrome. The shell only owns structure (header/body/handles/resize
   * floor) - each feature fetches and derives its own data, so there is no
   * single "loading" concept the shell could own centrally.
   */
  children: ReactNode;
}

/**
 * The reusable embed harness - generalizes the drag-boundary/handles/chrome
 * pattern every future `entity_embed` renderer reuses, so a new embed is a
 * content component rather than a from-scratch node. Only the header is
 * React-Flow-draggable; the body gets `nodrag nowheel nopan` so React
 * Flow's own pointer-based drag/pan/wheel handlers never fire inside it -
 * an embedded feature keeps its own native scrolling working exactly as it
 * does on its real standalone page.
 *
 * Settings open on double-clicking the header, and via the gear button
 * beside the trash for discoverability. Not the body - the body belongs to
 * the embedded feature, which may have its own double-click meanings.
 */
export function CanvasEmbedShell({
  title,
  onDelete,
  headerActions,
  minWidth,
  minHeight,
  width,
  height,
  accentColor = null,
  onApplySize,
  onAccentChange,
  nodeId,
  selected = false,
  accentLocked = false,
  children,
}: CanvasEmbedShellProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const canConfigure = Boolean(onApplySize && onAccentChange);

  return (
    <div className="cos-canvas-node" style={{position: 'relative', height: '100%', width: '100%', minWidth, minHeight}}>
      {nodeId ? (
        <CanvasNodeResizer
          nodeId={nodeId}
          isVisible={selected}
          minWidth={minWidth ?? 200}
          minHeight={minHeight ?? 200}
        />
      ) : null}
      <CanvasNodeHandles />
      <div style={{...body, ...accentBorderStyle(accentColor)}}>
        <div
          style={header}
          onDoubleClick={
            canConfigure
              ? (event) => {
                  // Stop the board's own double-click-to-fit-all from also firing.
                  event.stopPropagation();
                  setSettingsOpen((open) => !open);
                }
              : undefined
          }>
          <span style={titleRow}>
            {accentColor ? (
              <span
                aria-hidden
                style={{
                  height: 8,
                  width: 8,
                  flexShrink: 0,
                  borderRadius: 'var(--radius-full)',
                  backgroundColor: accentColor,
                }}
              />
            ) : null}
            <Text weight="semibold" style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
              {title}
            </Text>
          </span>
          <div style={{display: 'flex', alignItems: 'center', gap: 'var(--spacing-1)'}}>
            {headerActions}
            {canConfigure ? (
              <button
                type="button"
                aria-label={`${title} settings`}
                aria-expanded={settingsOpen}
                className="nodrag"
                onClick={() => setSettingsOpen((open) => !open)}
                style={iconButton}>
                <Icon icon={Cog6ToothIcon} size="sm" />
              </button>
            ) : null}
            {onDelete ? (
              <button
                type="button"
                aria-label={`Delete ${title}`}
                className="nodrag"
                onClick={onDelete}
                style={iconButton}>
                <Icon icon={TrashIcon} size="sm" />
              </button>
            ) : null}
          </div>
          {settingsOpen && onApplySize && onAccentChange ? (
            <CanvasNodeSettings
              title={title}
              width={width ?? minWidth ?? 0}
              height={height ?? minHeight ?? 0}
              accentColor={accentColor}
              minWidth={minWidth}
              minHeight={minHeight}
              onApplySize={(size) => {
                onApplySize(size);
                setSettingsOpen(false);
              }}
              onAccentChange={onAccentChange}
              accentLocked={accentLocked}
              onRemove={onDelete}
              removeCaption="Takes it off the board. Drag it back from the panel any time."
              onClose={() => setSettingsOpen(false)}
            />
          ) : null}
        </div>
        <div className="nodrag nowheel nopan" style={contentArea}>
          {children}
        </div>
      </div>
    </div>
  );
}
