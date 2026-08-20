/**
 * Wire framing for live collaborative document editing.
 *
 * Unlike `canvas-presence.ts`/`canvas-sync.ts`, the payloads here are already
 * binary: a Yjs document update and a `y-protocols/awareness` update are both
 * `Uint8Array`s. Wrapping either in JSON would mean base64, which is roughly
 * a third larger for no benefit on a channel that carries every keystroke -
 * so this module defines a one-byte type prefix instead of a JSON envelope.
 * `services/api/src/documents/document-collab.ts` and `apps/web/lib/
 * document-collab-store.tsx` are the two ends of this frame; neither
 * interprets the payload itself, which is left entirely to Yjs and
 * `y-protocols/awareness` on both sides.
 *
 * There is deliberately no Zod schema here - a length-prefix-free byte and a
 * slice is not something a validator adds safety to, and the payload itself
 * is validated by `Y.applyUpdate` throwing on garbage, not by this module.
 */

/**
 * The name of the Yjs `XmlFragment` the collaborative rich-text tree lives
 * under, inside the shared `Y.Doc`.
 *
 * Set explicitly on both ends (`apps/web`'s `Collaboration.configure({field})`
 * and `services/api`'s server-side seeding/compaction) rather than left to
 * Tiptap's own default (`'default'`, which this equals today) - a future
 * Tiptap upgrade changing that default would otherwise silently desync the
 * two sides, each still agreeing with itself but not with the other.
 */
export const DOCUMENT_COLLAB_XML_FRAGMENT_FIELD = 'default';

/** The two kinds of frame this channel carries. */
export const DOCUMENT_COLLAB_FRAME_TYPE = {
  /** A Yjs document update - persisted and broadcast to every other connection. */
  sync: 0,
  /** A `y-protocols/awareness` update - broadcast only, never persisted. */
  awareness: 1,
} as const;

export type DocumentCollabFrameType =
  (typeof DOCUMENT_COLLAB_FRAME_TYPE)[keyof typeof DOCUMENT_COLLAB_FRAME_TYPE];

/**
 * Prefixes `payload` with a one-byte frame type.
 *
 * Return type is pinned to `Uint8Array<ArrayBuffer>` rather than the bare
 * `Uint8Array` (which TypeScript's typed-array generics default to
 * `Uint8Array<ArrayBufferLike>`, a supertype that also admits
 * `SharedArrayBuffer`) because `new Uint8Array(n)` with a plain length
 * always allocates a real `ArrayBuffer` - and a real `ArrayBuffer` is
 * exactly what `WSContext.send` on both ends of this channel requires.
 */
export function encodeCollabFrame(
  type: DocumentCollabFrameType,
  payload: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const frame = new Uint8Array(payload.byteLength + 1);
  frame[0] = type;
  frame.set(payload, 1);
  return frame;
}

/**
 * Splits a frame back into its type and payload.
 *
 * Throws on an empty frame rather than returning a sentinel - an empty
 * message is not a valid frame of either kind, and a caller silently
 * skipping it would rather do so having been told why.
 */
export function decodeCollabFrame(frame: Uint8Array): {
  type: number;
  payload: Uint8Array;
} {
  if (frame.byteLength < 1) {
    throw new Error('Empty collaboration frame');
  }
  return {type: frame[0]!, payload: frame.subarray(1)};
}
