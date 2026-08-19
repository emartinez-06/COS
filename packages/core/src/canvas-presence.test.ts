/**
 * Tests for the canvas presence wire protocol.
 *
 * The interesting invariant is the discriminated unions actually discriminate
 * - a `select` without a `nodeId`, or a message `type` this protocol does not
 * define, must be refused rather than silently coerced into something else.
 */

import {describe, expect, it} from 'vitest';

import {
  canvasPresenceClientMessageSchema,
  canvasPresenceEntrySchema,
  canvasPresenceServerMessageSchema,
} from './canvas-presence.js';

describe('canvasPresenceClientMessageSchema', () => {
  it('accepts a select carrying a node id', () => {
    const parsed = canvasPresenceClientMessageSchema.parse({
      type: 'select',
      nodeId: 'node_1',
    });
    expect(parsed).toEqual({type: 'select', nodeId: 'node_1'});
  });

  it('accepts a deselect with no node id', () => {
    const parsed = canvasPresenceClientMessageSchema.parse({
      type: 'deselect',
    });
    expect(parsed).toEqual({type: 'deselect'});
  });

  it('refuses a select with no node id', () => {
    expect(
      canvasPresenceClientMessageSchema.safeParse({type: 'select'}).success,
    ).toBe(false);
  });

  it('refuses a select with an empty node id', () => {
    expect(
      canvasPresenceClientMessageSchema.safeParse({
        type: 'select',
        nodeId: '',
      }).success,
    ).toBe(false);
  });

  it('refuses a type this protocol does not define', () => {
    expect(
      canvasPresenceClientMessageSchema.safeParse({type: 'edit'}).success,
    ).toBe(false);
  });
});

describe('canvasPresenceEntrySchema', () => {
  it('accepts a full entry', () => {
    const parsed = canvasPresenceEntrySchema.parse({
      userId: 'user_1',
      name: 'Avery Martinez',
      positionColor: 'blue',
      nodeId: 'node_1',
    });
    expect(parsed.name).toBe('Avery Martinez');
  });

  it('refuses an entry missing a field', () => {
    expect(
      canvasPresenceEntrySchema.safeParse({
        userId: 'user_1',
        name: 'Avery Martinez',
        nodeId: 'node_1',
      }).success,
    ).toBe(false);
  });
});

describe('canvasPresenceServerMessageSchema', () => {
  const entry = {
    userId: 'user_1',
    name: 'Avery Martinez',
    positionColor: 'blue',
    nodeId: 'node_1',
  };

  it('accepts a snapshot, possibly empty', () => {
    expect(
      canvasPresenceServerMessageSchema.safeParse({
        type: 'snapshot',
        entries: [],
      }).success,
    ).toBe(true);
    expect(
      canvasPresenceServerMessageSchema.safeParse({
        type: 'snapshot',
        entries: [entry],
      }).success,
    ).toBe(true);
  });

  it('accepts a presence delta', () => {
    expect(
      canvasPresenceServerMessageSchema.safeParse({
        type: 'presence',
        entry,
      }).success,
    ).toBe(true);
  });

  it('accepts a presence-clear', () => {
    expect(
      canvasPresenceServerMessageSchema.safeParse({
        type: 'presence-clear',
        userId: 'user_1',
        nodeId: 'node_1',
      }).success,
    ).toBe(true);
  });

  it('refuses a presence delta missing its entry', () => {
    expect(
      canvasPresenceServerMessageSchema.safeParse({type: 'presence'}).success,
    ).toBe(false);
  });
});
