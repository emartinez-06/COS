'use client';

/**
 * The canvas's one live WebSocket connection, carrying two concerns:
 *
 * - **Presence** - "who's on what node right now" - ephemeral, exposed as
 *   `entriesByNodeId`/`select`.
 * - **Board sync** - "what actually changed" (a move, an edit, a create, a
 *   delete) - exposed as `subscribeSync`, so `canvas-board.tsx` can apply
 *   each change directly to React Flow's own node/edge state.
 *
 * One connection because a club has exactly one board and opening a second
 * socket for the second concern would be pure duplication - see
 * `@cos/core`'s `canvas-sync.ts` module doc for why the two stay separate
 * schemas despite sharing this transport.
 *
 * `subscribeSync` is a plain callback-set, not React state, on purpose:
 * board-sync messages can arrive several in a row (e.g. two node creates in
 * quick succession), and React state updates queued within the same tick
 * can coalesce - a `useEffect` watching "the last message" could miss one.
 * A directly-invoked callback never has that problem.
 *
 * Architecturally separate from `canvas-store.tsx` on purpose - `canvas-store.tsx`
 * still owns the initial REST load (`CanvasRepository` has no `subscribe`);
 * this is what keeps that initial picture live afterward. Nothing here is
 * persisted; a reload always starts from a fresh REST load plus whatever the
 * socket's own presence `snapshot` says, and a dropped connection reconnects
 * with backoff, minting a fresh ticket each time since the old one is
 * single-use regardless of whether it expired.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  CanvasPresenceClientMessage,
  CanvasPresenceEntry,
  CanvasPresenceServerMessage,
  CanvasSyncServerMessage,
} from '@cos/core';
import {
  canvasPresenceServerMessageSchema,
  canvasSyncServerMessageSchema,
} from '@cos/core';

import {canvasPresenceSocketUrl, mintCanvasPresenceTicket} from './canvas-presence-client';
import {useSession} from './session';

/**
 * "Avery Martinez" -> "Avery M." for the presence tag - full name is what
 * travels over the wire (`user.name` is one unstructured string, and
 * splitting it is a presentation decision, not a wire-contract one), so this
 * is the one place that decision gets made. A single-word name has no
 * initial to add and is returned as-is.
 */
function presenceDisplayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) {
    return fullName.trim();
  }
  const first = parts[0];
  const lastInitial = parts[parts.length - 1]!.charAt(0);
  return `${first} ${lastInitial}.`;
}

interface CanvasPresenceStore {
  /** Every other officer's current node selection, keyed by node id. Never includes the viewer's own. */
  entriesByNodeId: Map<string, CanvasPresenceEntry[]>;
  /** Reports this browser's own selection to everyone else. Pass null to clear it. */
  select: (nodeId: string | null) => void;
  /**
   * Registers a callback for every board-sync message as it arrives, in
   * order. Returns an unsubscribe function - call it on unmount, the same
   * as any other event-subscription cleanup.
   */
  subscribeSync: (callback: (message: CanvasSyncServerMessage) => void) => () => void;
}

const CanvasPresenceContext = createContext<CanvasPresenceStore | null>(null);

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15_000;

interface CanvasPresenceProviderProps {
  children: React.ReactNode;
  clubId: string;
}

export function CanvasPresenceProvider({
  children,
  clubId,
}: CanvasPresenceProviderProps) {
  const {user} = useSession();
  const viewerId = user?.id ?? null;

  const [entries, setEntries] = useState<CanvasPresenceEntry[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  /** Survives a reconnect: a selection made just before a brief drop is re-announced once the socket is back. */
  const selectedNodeIdRef = useRef<string | null>(null);
  /** Plain callback set, not React state - see the module doc for why. */
  const syncSubscribersRef = useRef<Set<(message: CanvasSyncServerMessage) => void>>(
    new Set(),
  );

  useEffect(() => {
    if (!viewerId) {
      return;
    }

    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    function applyPresenceMessage(message: CanvasPresenceServerMessage) {
      if (message.type === 'snapshot') {
        setEntries(message.entries);
        return;
      }
      if (message.type === 'presence') {
        setEntries((current) => [
          ...current.filter((entry) => entry.userId !== message.entry.userId),
          message.entry,
        ]);
        return;
      }
      setEntries((current) =>
        current.filter(
          (entry) =>
            !(entry.userId === message.userId && entry.nodeId === message.nodeId),
        ),
      );
    }

    function scheduleReconnect() {
      if (cancelled) {
        return;
      }
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
      attempt += 1;
      reconnectTimer = setTimeout(() => void connect(), delay);
    }

    async function connect() {
      const ticket = await mintCanvasPresenceTicket(clubId);
      if (cancelled) {
        return;
      }
      if (!ticket) {
        scheduleReconnect();
        return;
      }

      const socket = new WebSocket(canvasPresenceSocketUrl(clubId, ticket));
      socketRef.current = socket;

      socket.addEventListener('open', () => {
        attempt = 0;
        if (selectedNodeIdRef.current) {
          sendMessage(socket, {type: 'select', nodeId: selectedNodeIdRef.current});
        }
      });

      socket.addEventListener('message', (event) => {
        if (typeof event.data !== 'string') {
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          return;
        }
        const presenceResult = canvasPresenceServerMessageSchema.safeParse(parsed);
        if (presenceResult.success) {
          applyPresenceMessage(presenceResult.data);
          return;
        }
        const syncResult = canvasSyncServerMessageSchema.safeParse(parsed);
        if (syncResult.success) {
          for (const callback of syncSubscribersRef.current) {
            callback(syncResult.data);
          }
        }
      });

      socket.addEventListener('close', () => {
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        setEntries([]);
        scheduleReconnect();
      });

      // A failed handshake fires 'error' then 'close' - closing explicitly
      // here would be redundant with the 'close' handler above already
      // scheduling a reconnect, so this exists only to stop an unhandled
      // event from logging to the console.
      socket.addEventListener('error', () => {});
    }

    void connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      socketRef.current?.close();
      socketRef.current = null;
      setEntries([]);
    };
  }, [clubId, viewerId]);

  const select = useCallback((nodeId: string | null) => {
    selectedNodeIdRef.current = nodeId;
    const message: CanvasPresenceClientMessage = nodeId
      ? {type: 'select', nodeId}
      : {type: 'deselect'};
    sendMessage(socketRef.current, message);
  }, []);

  const subscribeSync = useCallback(
    (callback: (message: CanvasSyncServerMessage) => void) => {
      syncSubscribersRef.current.add(callback);
      return () => {
        syncSubscribersRef.current.delete(callback);
      };
    },
    [],
  );

  // No filtering by viewerId here: the server never broadcasts a
  // connection's own selection back to itself, so a single tab never sees
  // its own tag by construction. A *second* tab signed in as the same
  // officer is a genuinely different connection and its tag is meant to
  // show - see "two tabs, same person" in the design notes. Deduping it away
  // here would silently undo that.
  const entriesByNodeId = useMemo(() => {
    const map = new Map<string, CanvasPresenceEntry[]>();
    for (const entry of entries) {
      const displayEntry = {...entry, name: presenceDisplayName(entry.name)};
      const list = map.get(entry.nodeId);
      if (list) {
        list.push(displayEntry);
      } else {
        map.set(entry.nodeId, [displayEntry]);
      }
    }
    return map;
  }, [entries]);

  const value = useMemo<CanvasPresenceStore>(
    () => ({entriesByNodeId, select, subscribeSync}),
    [entriesByNodeId, select, subscribeSync],
  );

  return (
    <CanvasPresenceContext.Provider value={value}>
      {children}
    </CanvasPresenceContext.Provider>
  );
}

function sendMessage(
  socket: WebSocket | null,
  message: CanvasPresenceClientMessage,
): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

/** Only ever rendered inside the canvas board tree, where `CanvasPresenceProvider` is guaranteed mounted. */
export function useCanvasPresence(): CanvasPresenceStore {
  const store = useContext(CanvasPresenceContext);
  if (!store) {
    throw new Error(
      'useCanvasPresence must be used within a CanvasPresenceProvider',
    );
  }
  return store;
}
