/**
 * Names the route, and mounts every store the canvas or its embeds read
 * from. See `CanvasProviders` for why they are hoisted to this level.
 */

import type {Metadata} from 'next';

import {CanvasProviders} from '../../../components/canvas/canvas-providers';

export const metadata: Metadata = {
  title: 'Canvas',
};

export default function CanvasLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <CanvasProviders>{children}</CanvasProviders>;
}
