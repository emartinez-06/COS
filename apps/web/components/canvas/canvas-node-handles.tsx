'use client';

import {Handle, Position} from '@xyflow/react';

import styles from './canvas-node-handles.module.css';

const HANDLE_POSITIONS = [
  {id: 'top', position: Position.Top},
  {id: 'right', position: Position.Right},
  {id: 'bottom', position: Position.Bottom},
  {id: 'left', position: Position.Left},
] as const;

/**
 * The connection points every canvas node type shares, so "connect things
 * together" works the same way regardless of what's being connected. All
 * four are `type="source"` - the board runs React Flow's
 * `connectionMode="loose"` (set once on `<ReactFlow>` in
 * `canvas-board.tsx`), under which any handle can start or receive a
 * connection, so a separate `type="target"` set isn't needed for a plain,
 * directionless "connect A to B".
 *
 * Hidden until the node is hovered - a whiteboard-standard affordance that
 * keeps four dots from cluttering every node when nobody is trying to
 * connect anything. Callers add the plain `cos-canvas-node` class to their
 * node's root element for this to work - see `canvas-node-handles.module.css`.
 *
 * The visible dot stays small while a padded `::before` extends the
 * grabbable box well past it - a 10px dot is not a realistic pointer target
 * once the board is zoomed out, the same fix React Flow's own docs suggest
 * for small handles.
 */
export function CanvasNodeHandles() {
  return (
    <>
      {HANDLE_POSITIONS.map(({id, position}) => (
        <Handle key={id} id={id} type="source" position={position} className={styles.handle} />
      ))}
    </>
  );
}
