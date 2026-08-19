/**
 * Tests for the canvas board-sync wire protocol.
 */

import {describe, expect, it} from 'vitest';

import {canvasSyncServerMessageSchema} from './canvas-sync.js';

const node = {
  id: 'canvas_node_1',
  boardId: 'canvas_board_1',
  nodeType: 'sticky_note' as const,
  positionX: 0,
  positionY: 0,
  width: 240,
  height: 200,
  zIndex: 0,
  accentColor: null,
  stickyNoteText: 'Bring cups',
  stickyNoteColor: 'yellow' as const,
  linkUrl: null,
  linkTitle: null,
  imageStorageKey: null,
  embedEntityType: null,
  createdAt: '2026-08-19T00:00:00Z',
  updatedAt: '2026-08-19T00:00:00Z',
};

const edge = {
  id: 'canvas_edge_1',
  boardId: 'canvas_board_1',
  sourceNodeId: 'canvas_node_1',
  targetNodeId: 'canvas_node_2',
  createdAt: '2026-08-19T00:00:00Z',
};

describe('canvasSyncServerMessageSchema', () => {
  it('accepts a node-upserted message', () => {
    expect(
      canvasSyncServerMessageSchema.safeParse({type: 'node-upserted', node})
        .success,
    ).toBe(true);
  });

  it('accepts a node-deleted message', () => {
    expect(
      canvasSyncServerMessageSchema.safeParse({
        type: 'node-deleted',
        nodeId: 'canvas_node_1',
      }).success,
    ).toBe(true);
  });

  it('accepts an edge-upserted message', () => {
    expect(
      canvasSyncServerMessageSchema.safeParse({type: 'edge-upserted', edge})
        .success,
    ).toBe(true);
  });

  it('accepts an edge-deleted message', () => {
    expect(
      canvasSyncServerMessageSchema.safeParse({
        type: 'edge-deleted',
        edgeId: 'canvas_edge_1',
      }).success,
    ).toBe(true);
  });

  it('refuses a node-upserted message with an invalid node', () => {
    expect(
      canvasSyncServerMessageSchema.safeParse({
        type: 'node-upserted',
        node: {...node, nodeType: 'not-a-real-kind'},
      }).success,
    ).toBe(false);
  });

  it('refuses a type this protocol does not define', () => {
    expect(
      canvasSyncServerMessageSchema.safeParse({type: 'board-deleted'}).success,
    ).toBe(false);
  });
});
