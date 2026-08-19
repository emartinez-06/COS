/**
 * Live board sync: factual mirrors of the canvas's own REST writes, pushed
 * to every officer connected to a club's board.
 *
 * Distinct from `canvas-presence.ts` on purpose - that module is ephemeral
 * awareness ("who's looking at what, right now"), never persisted and
 * meaningless a moment later. This is the opposite: every message here
 * corresponds to a row that was actually written, and a client that missed
 * one (a dropped connection, a page that was closed) catches back up simply
 * by re-fetching, the same way it always could. The two message families
 * ride the same WebSocket connection (`services/api/src/routes/canvas-presence.ts`
 * owns both), because a club has exactly one board and one connection is
 * simpler than two - but they stay separate schemas here since they answer
 * different questions.
 *
 * There is no conflict resolution beyond last-write-wins - the same model
 * every canvas write already had before this existed (no optimistic
 * locking, no version counter, unlike the document hub). Two officers
 * moving the same node within the same instant is rare enough on a small
 * club's board that building real conflict resolution for it would be
 * solving a problem nobody has yet.
 */

import {z} from 'zod';

import {canvasEdgeSchema, canvasNodeSchema} from './canvas.js';

export const canvasSyncServerMessageSchema = z.discriminatedUnion('type', [
  /** Covers both "created" and "updated" - the client applies either as an upsert by id. */
  z.object({type: z.literal('node-upserted'), node: canvasNodeSchema}),
  z.object({type: z.literal('node-deleted'), nodeId: z.string().min(1)}),
  z.object({type: z.literal('edge-upserted'), edge: canvasEdgeSchema}),
  z.object({type: z.literal('edge-deleted'), edgeId: z.string().min(1)}),
]);

export type CanvasSyncServerMessage = z.infer<
  typeof canvasSyncServerMessageSchema
>;
