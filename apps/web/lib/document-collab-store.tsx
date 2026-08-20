'use client';

/**
 * A live collaborative session for one text document: a `Y.Doc`, a Yjs
 * `Awareness` instance for cursors, and the WebSocket that keeps both in
 * sync with everyone else editing the same document.
 *
 * Same reconnect-with-backoff shape as `canvas-presence-store.tsx`, adapted
 * for a per-document rather than per-club connection, and for binary frames
 * (`@cos/core`'s `document-collab.ts` framing) instead of JSON. Deliberately
 * a plain hook rather than a context provider: canvas presence is club-wide
 * and mounted once for the whole board; a document's live session belongs to
 * whichever page has that one document open, and is torn down - `Y.Doc`,
 * `Awareness`, socket, all of it - the moment that page unmounts.
 *
 * ## Why the client resends its full state on every connect, not a diff
 *
 * Yjs updates are idempotent and mergeable regardless of what the receiver
 * already has, so re-sending `Y.encodeStateAsUpdate(ydoc)` in full on every
 * `open` - rather than negotiating a state-vector diff first - is simpler and
 * still correct: the server (and every other connection) just re-applies
 * already-known operations as no-ops for the overlap and accepts whatever is
 * new. This is also what makes offline edits merge on reconnect with no
 * special-case path, which `docs/COLLABORATIVE-EDITING.md` names as one of
 * the reasons a CRDT was chosen over OT in the first place - a club member
 * who edited on and off campus wifi simply reconnects and their Y.Doc already
 * holds everything they typed.
 */

import {useEffect, useMemo, useRef, useState} from 'react';
import {
  DEFAULT_PRESENCE_COLOR,
  DOCUMENT_COLLAB_FRAME_TYPE,
  POSITION_COLORS,
  decodeCollabFrame,
  encodeCollabFrame,
} from '@cos/core';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import * as Y from 'yjs';

import {
  documentCollabSocketUrl,
  mintDocumentCollabTicket,
} from './document-collab-client';
import {useSession} from './session';

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15_000;

/** Marks an update as having come from the network, not from this client's own edits - see `onDocUpdate` below. */
const REMOTE_ORIGIN = 'document-collab-remote';

export interface DocumentCollabConnection {
  ydoc: Y.Doc;
  awareness: Awareness;
  isConnected: boolean;
}

/**
 * Opens (and keeps open) a live collaborative session for one text document.
 *
 * `canEdit` gates whether local edits are ever sent - the Tiptap editor
 * mounts non-editable for a viewer, so in practice `ydoc` never produces a
 * local update for one, but the guard here is a second, independent
 * backstop, matching the server's own defense-in-depth for the same frame.
 */
export function useDocumentCollab(
  clubId: string,
  documentId: string,
  canEdit: boolean,
): DocumentCollabConnection {
  const {user, activeClub} = useSession();
  const [isConnected, setIsConnected] = useState(false);

  const ydoc = useMemo(() => new Y.Doc(), [documentId]);
  const awareness = useMemo(() => new Awareness(ydoc), [ydoc]);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }

    const color = activeClub?.position
      ? POSITION_COLORS[activeClub.position]
      : DEFAULT_PRESENCE_COLOR;
    awareness.setLocalState({user: {name: user.name, color}});

    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    function sendUpdate(update: Uint8Array) {
      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(encodeCollabFrame(DOCUMENT_COLLAB_FRAME_TYPE.sync, update));
      }
    }

    function sendAwareness(update: Uint8Array) {
      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(
          encodeCollabFrame(DOCUMENT_COLLAB_FRAME_TYPE.awareness, update),
        );
      }
    }

    function onDocUpdate(update: Uint8Array, origin: unknown) {
      if (origin === REMOTE_ORIGIN || !canEdit) {
        return;
      }
      sendUpdate(update);
    }
    ydoc.on('update', onDocUpdate);

    function onAwarenessUpdate(changes: {
      added: number[];
      updated: number[];
      removed: number[];
    }) {
      const changed = changes.added.concat(changes.updated, changes.removed);
      sendAwareness(encodeAwarenessUpdate(awareness, changed));
    }
    awareness.on('update', onAwarenessUpdate);

    function scheduleReconnect() {
      if (cancelled) {
        return;
      }
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
      attempt += 1;
      reconnectTimer = setTimeout(() => void connect(), delay);
    }

    async function connect() {
      const ticket = await mintDocumentCollabTicket(clubId, documentId);
      if (cancelled) {
        return;
      }
      if (!ticket) {
        scheduleReconnect();
        return;
      }

      const socket = new WebSocket(
        documentCollabSocketUrl(clubId, documentId, ticket),
      );
      socket.binaryType = 'arraybuffer';
      socketRef.current = socket;

      socket.addEventListener('open', () => {
        attempt = 0;
        setIsConnected(true);
        sendUpdate(Y.encodeStateAsUpdate(ydoc));
        if (awareness.getLocalState()) {
          sendAwareness(encodeAwarenessUpdate(awareness, [awareness.clientID]));
        }
      });

      socket.addEventListener('message', (event) => {
        if (!(event.data instanceof ArrayBuffer)) {
          return;
        }
        let decoded: {type: number; payload: Uint8Array};
        try {
          decoded = decodeCollabFrame(new Uint8Array(event.data));
        } catch {
          return;
        }
        if (decoded.type === DOCUMENT_COLLAB_FRAME_TYPE.sync) {
          Y.applyUpdate(ydoc, decoded.payload, REMOTE_ORIGIN);
        } else if (decoded.type === DOCUMENT_COLLAB_FRAME_TYPE.awareness) {
          applyAwarenessUpdate(awareness, decoded.payload, REMOTE_ORIGIN);
        }
      });

      socket.addEventListener('close', () => {
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        setIsConnected(false);
        scheduleReconnect();
      });

      // Same reasoning as canvas-presence-store.tsx: a failed handshake
      // fires 'error' then 'close', and 'close' already schedules the
      // reconnect - this exists only to stop an unhandled event logging.
      socket.addEventListener('error', () => {});
    }

    void connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      ydoc.off('update', onDocUpdate);
      awareness.off('update', onAwarenessUpdate);
      removeAwarenessStates(awareness, [awareness.clientID], 'unmount');
      socketRef.current?.close();
      socketRef.current = null;
      // Destroying the doc also destroys its Awareness - the constructor
      // wires `doc.on('destroy', () => awareness.destroy())` internally.
      ydoc.destroy();
      setIsConnected(false);
    };
  }, [clubId, documentId, canEdit, user, activeClub, ydoc, awareness]);

  return useMemo(
    () => ({ydoc, awareness, isConnected}),
    [ydoc, awareness, isConnected],
  );
}
