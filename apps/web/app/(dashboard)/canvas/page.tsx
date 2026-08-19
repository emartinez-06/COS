'use client';

/**
 * The canvas surface. Officers only, including read - see `packages/core/src/role.ts`.
 *
 * The guard is here rather than inside CanvasView, matching the treasury:
 * the rule is visible at the route, and a new officer-only surface joining
 * this group copies one wrapper.
 */

import {CapabilityGuard} from '../../../components/shell/capability-guard';
import {CanvasView} from '../../../components/canvas/canvas-view';

export default function CanvasPage() {
  return (
    <CapabilityGuard capability="canvas:view">
      <CanvasView />
    </CapabilityGuard>
  );
}
