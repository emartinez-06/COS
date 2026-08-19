/**
 * In-memory state for live canvas presence: who is connected to a club's
 * board right now, and which node (if any) each connection has selected.
 *
 * Nothing here is persisted, on purpose - see `@cos/core`'s
 * `canvas-presence.ts` module doc. Both Maps below live in this one process
 * and do not survive a restart or scale past one instance - the same
 * accepted limitation already stated once in this codebase for the sign-in
 * rate limiter (`auth.ts`): a single self-hosted API process is the target
 * deployment, not a cluster.
 */

import type {CanvasPresenceEntry, CanvasPresenceServerMessage, Position} from '@cos/core';
import {DEFAULT_PRESENCE_COLOR, POSITION_COLORS} from '@cos/core';
import type {WSContext} from 'hono/ws';

interface Connection {
  ws: WSContext;
  userId: string;
  name: string;
  positionColor: string;
  currentNodeId: string | null;
}

/** clubId -> connectionId -> connection. */
const boards = new Map<string, Map<string, Connection>>();

interface Ticket {
  userId: string;
  clubId: string;
  expiresAt: number;
}

/**
 * Single-use, short-lived tickets that stand in for the session cookie
 * during the WebSocket handshake - see `routes/canvas-presence.ts` for why
 * the cookie itself is not trusted there.
 */
const tickets = new Map<string, Ticket>();

const TICKET_TTL_MS = 30_000;

export function mintTicket(userId: string, clubId: string): string {
  const ticket = crypto.randomUUID();
  tickets.set(ticket, {userId, clubId, expiresAt: Date.now() + TICKET_TTL_MS});
  return ticket;
}

/**
 * Validates and consumes a ticket in one step. Deleting on every read - hit
 * or miss - is what makes "single-use" and "expired-ticket cleanup" the same
 * code path, so there is no separate sweep to schedule or forget.
 */
export function consumeTicket(
  ticket: string,
  clubId: string,
): {userId: string} | null {
  const found = tickets.get(ticket);
  tickets.delete(ticket);
  if (!found || found.clubId !== clubId || found.expiresAt < Date.now()) {
    return null;
  }
  return {userId: found.userId};
}

/** An officer with no position falls back to a colour that matches no named position. */
export function positionColorFor(position: Position | null): string {
  return position ? POSITION_COLORS[position] : DEFAULT_PRESENCE_COLOR;
}

/** Registers a newly-opened connection on a club's board. */
export function join(
  clubId: string,
  connectionId: string,
  connection: Connection,
): void {
  let club = boards.get(clubId);
  if (!club) {
    club = new Map();
    boards.set(clubId, club);
  }
  club.set(connectionId, connection);
}

/**
 * Removes a connection and, if it had a node selected, broadcasts that it no
 * longer does. Called on a clean close, an error, and a failed membership
 * re-check alike - whatever ended the connection, its tag must disappear.
 */
export function leave(clubId: string, connectionId: string): void {
  const club = boards.get(clubId);
  if (!club) {
    return;
  }
  const connection = club.get(connectionId);
  club.delete(connectionId);
  if (club.size === 0) {
    boards.delete(clubId);
  }
  if (connection?.currentNodeId) {
    broadcast(clubId, connectionId, {
      type: 'presence-clear',
      userId: connection.userId,
      nodeId: connection.currentNodeId,
    });
  }
}

/**
 * Records a connection's selected node (or `null` for none) and broadcasts
 * the change to every other connection on the same board. Never broadcasts
 * back to the sender - a person never needs their own tag.
 */
export function setNode(
  clubId: string,
  connectionId: string,
  nodeId: string | null,
): void {
  const club = boards.get(clubId);
  const connection = club?.get(connectionId);
  if (!club || !connection) {
    return;
  }

  const previousNodeId = connection.currentNodeId;
  connection.currentNodeId = nodeId;

  if (previousNodeId && previousNodeId !== nodeId) {
    broadcast(clubId, connectionId, {
      type: 'presence-clear',
      userId: connection.userId,
      nodeId: previousNodeId,
    });
  }
  if (nodeId) {
    broadcast(clubId, connectionId, {
      type: 'presence',
      entry: {
        userId: connection.userId,
        name: connection.name,
        positionColor: connection.positionColor,
        nodeId,
      },
    });
  }
}

/** Every other connection's current selection, for a connection that just joined. */
export function snapshot(
  clubId: string,
  exceptConnectionId: string,
): CanvasPresenceEntry[] {
  const club = boards.get(clubId);
  if (!club) {
    return [];
  }
  const entries: CanvasPresenceEntry[] = [];
  for (const [connectionId, connection] of club) {
    if (connectionId === exceptConnectionId || !connection.currentNodeId) {
      continue;
    }
    entries.push({
      userId: connection.userId,
      name: connection.name,
      positionColor: connection.positionColor,
      nodeId: connection.currentNodeId,
    });
  }
  return entries;
}

function broadcast(
  clubId: string,
  exceptConnectionId: string,
  message: CanvasPresenceServerMessage,
): void {
  const club = boards.get(clubId);
  if (!club) {
    return;
  }
  const payload = JSON.stringify(message);
  for (const [connectionId, connection] of club) {
    if (connectionId === exceptConnectionId) {
      continue;
    }
    connection.ws.send(payload);
  }
}
