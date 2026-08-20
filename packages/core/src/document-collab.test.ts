/**
 * Tests for the collaborative-editing wire framing.
 */

import {describe, expect, it} from 'vitest';

import {
  DOCUMENT_COLLAB_FRAME_TYPE,
  decodeCollabFrame,
  encodeCollabFrame,
} from './document-collab.js';

describe('encodeCollabFrame / decodeCollabFrame', () => {
  it('round-trips a sync frame', () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const frame = encodeCollabFrame(DOCUMENT_COLLAB_FRAME_TYPE.sync, payload);
    const decoded = decodeCollabFrame(frame);
    expect(decoded.type).toBe(DOCUMENT_COLLAB_FRAME_TYPE.sync);
    expect(Array.from(decoded.payload)).toEqual([1, 2, 3, 4]);
  });

  it('round-trips an awareness frame', () => {
    const payload = new Uint8Array([9, 9]);
    const frame = encodeCollabFrame(
      DOCUMENT_COLLAB_FRAME_TYPE.awareness,
      payload,
    );
    const decoded = decodeCollabFrame(frame);
    expect(decoded.type).toBe(DOCUMENT_COLLAB_FRAME_TYPE.awareness);
    expect(Array.from(decoded.payload)).toEqual([9, 9]);
  });

  it('round-trips an empty payload', () => {
    const frame = encodeCollabFrame(
      DOCUMENT_COLLAB_FRAME_TYPE.sync,
      new Uint8Array(0),
    );
    const decoded = decodeCollabFrame(frame);
    expect(decoded.type).toBe(DOCUMENT_COLLAB_FRAME_TYPE.sync);
    expect(decoded.payload.byteLength).toBe(0);
  });

  it('does not mutate the original payload', () => {
    const payload = new Uint8Array([5, 6]);
    encodeCollabFrame(DOCUMENT_COLLAB_FRAME_TYPE.sync, payload);
    expect(Array.from(payload)).toEqual([5, 6]);
  });

  it('throws decoding an empty frame', () => {
    expect(() => decodeCollabFrame(new Uint8Array(0))).toThrow();
  });
});
