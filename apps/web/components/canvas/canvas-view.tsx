'use client';

/**
 * The canvas surface: a full-height board with no side panel - the board's
 * own floating toolbar and feature palette carry the controls a context
 * panel would otherwise hold.
 *
 * `@xyflow/react` needs a real DOM to measure against, so `CanvasBoard`
 * only mounts once the club's board/nodes/edges have loaded - matching the
 * "wait for mount" rule the calendar already follows for its own
 * hydration-sensitive content.
 */

import type {CSSProperties} from 'react';
import {Layout, LayoutContent} from '@astryxdesign/core/Layout';
import {VStack} from '@astryxdesign/core/Stack';
import {Skeleton} from '@astryxdesign/core/Skeleton';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';

import {useCanvas} from '../../lib/canvas-store';
import {CanvasBoard} from './canvas-board';

const page: CSSProperties = {
  padding: 'var(--spacing-5)',
  minWidth: 0,
};

const boardArea: CSSProperties = {
  height: '100%',
  minWidth: 0,
};

export function CanvasView() {
  const {isLoading, error} = useCanvas();

  if (isLoading) {
    return (
      <VStack gap={4} style={page}>
        <Skeleton width={260} height={32} />
        <Skeleton height={640} />
      </VStack>
    );
  }

  // Shown instead of the board, not above it - a failed load leaves the
  // board empty, and an empty canvas renders as a legitimate blank board
  // rather than a failure.
  if (error) {
    return (
      <VStack gap={4} style={page}>
        <Banner
          status="error"
          title="Could not load this club’s canvas"
          description={error}
          endContent={
            <Button
              label="Retry"
              variant="secondary"
              onClick={() => window.location.reload()}
            />
          }
        />
      </VStack>
    );
  }

  return (
    <Layout
      height="fill"
      content={
        <LayoutContent padding={0}>
          <div style={boardArea}>
            <CanvasBoard />
          </div>
        </LayoutContent>
      }
    />
  );
}
