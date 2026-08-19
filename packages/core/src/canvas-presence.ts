/**
 * Who is touching what on a shared canvas board, right now.
 *
 * This is a different thing from `presence.ts`. That module answers "is this
 * person around" - a slow, DB-backed observation, resolved from a 30-second
 * heartbeat, worth keeping for a few minutes after the last one arrives. This
 * one answers "which node is officer X looking at, this second" - a fact
 * worth keeping for zero seconds after they look away or close the tab.
 * Nothing here is persisted; it exists only for as long as a WebSocket
 * connection carrying it is open. See `docs/COLLABORATIVE-EDITING.md`'s
 * "awareness data" principle, which this feature is the first real
 * implementation of.
 *
 * The wire protocol is deliberately small: a client reports which node it has
 * selected (or that it has selected none), and the server fans that out to
 * every other connection on the same club's board, plus a full snapshot for
 * anyone who just joined.
 */

import {z} from 'zod';

/** A client reports its own selection. Nothing else travels this direction. */
export const canvasPresenceClientMessageSchema = z.discriminatedUnion('type', [
  z.object({type: z.literal('select'), nodeId: z.string().min(1)}),
  z.object({type: z.literal('deselect')}),
]);

export type CanvasPresenceClientMessage = z.infer<
  typeof canvasPresenceClientMessageSchema
>;

/**
 * One officer's presence on one node. `name` travels whole rather than
 * pre-split - "first name plus last initial" is a display decision, made
 * once, in `apps/web`, not baked into the wire contract.
 */
export const canvasPresenceEntrySchema = z.object({
  userId: z.string().min(1),
  name: z.string().min(1),
  positionColor: z.string().min(1),
  nodeId: z.string().min(1),
});

export type CanvasPresenceEntry = z.infer<typeof canvasPresenceEntrySchema>;

/**
 * What the server sends. `snapshot` arrives once, right after a connection
 * opens, so a newly-joined officer sees everyone already active rather than
 * only future changes. `presence` and `presence-clear` are deltas after that.
 */
export const canvasPresenceServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('snapshot'),
    entries: z.array(canvasPresenceEntrySchema),
  }),
  z.object({type: z.literal('presence'), entry: canvasPresenceEntrySchema}),
  z.object({
    type: z.literal('presence-clear'),
    userId: z.string().min(1),
    nodeId: z.string().min(1),
  }),
]);

export type CanvasPresenceServerMessage = z.infer<
  typeof canvasPresenceServerMessageSchema
>;
