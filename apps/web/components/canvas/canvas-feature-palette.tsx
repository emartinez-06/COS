'use client';

import {useState, type CSSProperties, type DragEvent} from 'react';
import {Icon} from '@astryxdesign/core/Icon';
import {Text} from '@astryxdesign/core/Text';
import {ChevronDoubleLeftIcon, ChevronDoubleRightIcon} from '@heroicons/react/24/outline';

import {NAV_SECTIONS} from '../../lib/nav-config';
import {ENTITY_EMBED_DND_MIME} from './canvas-node-utils';

const wrapper: CSSProperties = {
  position: 'absolute',
  right: 0,
  top: 0,
  bottom: 0,
  zIndex: 10,
  display: 'flex',
};

const toggle: CSSProperties = {
  position: 'absolute',
  right: 'var(--spacing-2)',
  top: '50%',
  transform: 'translateY(-50%)',
  display: 'flex',
  height: 36,
  width: 36,
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--radius-field)',
  border: 'var(--border-width) solid var(--color-border)',
  backgroundColor: 'var(--color-background-surface)',
  color: 'var(--color-text-secondary)',
  boxShadow: 'var(--shadow-container)',
  cursor: 'pointer',
};

const panel: CSSProperties = {
  display: 'flex',
  height: '100%',
  width: 240,
  flexDirection: 'column',
  borderInlineStart: 'var(--border-width) solid var(--color-border)',
  backgroundColor: 'var(--color-background-surface)',
  boxShadow: 'var(--shadow-container)',
};

const panelHeader: CSSProperties = {
  flexShrink: 0,
  borderBottom: 'var(--border-width) solid var(--color-border)',
  paddingInline: 'var(--spacing-4)',
  paddingBlock: 'var(--spacing-3)',
  paddingInlineEnd: 'var(--spacing-10)',
};

const panelBody: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: 'var(--spacing-2)',
};

const row: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--spacing-2)',
  borderRadius: 'var(--radius-field)',
  paddingInline: 'var(--spacing-2)',
  paddingBlock: 'var(--spacing-1-5)',
  cursor: 'grab',
};

/**
 * The right-side feature palette - drag one of the club's own destinations
 * onto the board to embed a live summary of it.
 *
 * Derived directly from `NAV_SECTIONS` (filtered to items carrying a
 * `canvasEmbedType`) rather than a second, hand-kept list: `nav-config.tsx`
 * already warns that a separate index is a second list of the product's
 * destinations that can silently drift, and the same argument applies here.
 *
 * Collapsed by default - a board with nothing dropped on it yet doesn't
 * need a panel taking up a fifth of the screen.
 */
export function CanvasFeaturePalette() {
  const [revealed, setRevealed] = useState(false);

  const items = NAV_SECTIONS.flatMap((section) =>
    section.items.filter((item) => item.canvasEmbedType),
  );

  return (
    <div style={wrapper}>
      <button
        type="button"
        onClick={() => setRevealed((current) => !current)}
        aria-label={revealed ? 'Collapse feature palette' : 'Expand feature palette'}
        style={toggle}>
        <Icon icon={revealed ? ChevronDoubleRightIcon : ChevronDoubleLeftIcon} size="sm" />
      </button>
      {revealed ? (
        <aside style={panel}>
          <div style={panelHeader}>
            <Text weight="semibold">Features</Text>
            <Text type="supporting" color="secondary" style={{display: 'block'}}>
              Drag one onto the board.
            </Text>
          </div>
          <div style={panelBody}>
            {items.map((item) => (
              <div
                key={item.href}
                draggable
                onDragStart={(event: DragEvent<HTMLDivElement>) => {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData(
                    ENTITY_EMBED_DND_MIME,
                    JSON.stringify({entityType: item.canvasEmbedType}),
                  );
                }}
                style={row}>
                <Icon icon={item.icon} size="sm" color="secondary" />
                <Text style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                  {item.label}
                </Text>
              </div>
            ))}
          </div>
        </aside>
      ) : null}
    </div>
  );
}
