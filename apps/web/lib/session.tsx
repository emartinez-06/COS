'use client';

/**
 * The current viewer: who they are and what role they hold in the club they
 * are looking at.
 *
 * This used to be a hardcoded role with a switcher in the top nav. It is now
 * backed by a real session: better-auth resolves identity, and `/api/session`
 * returns the clubs the person belongs to with their role in each.
 *
 * The shape components see is unchanged - they still ask `useCan('event:create')`
 * and never `role === 'admin'` - which is the whole reason the swap touched no
 * calendar code.
 *
 * The client-side check decides whether to *render* a control. It is not a
 * security boundary; the API enforces the same capability with
 * `requireCapability()` before anything happens.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type {Capability, Position, Role} from '@cos/core';
import {can, memberTitle} from '@cos/core';

import {API_URL, apiFetch, authClient} from './auth-client';

export interface ClubMembership {
  clubId: string;
  name: string;
  slug: string;
  role: Role;
  /** The officer's job title, or null. Display only - `role` decides access. */
  position: Position | null;
  capabilities: Capability[];
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

type SessionStatus = 'loading' | 'authenticated' | 'anonymous' | 'error';

interface Session {
  status: SessionStatus;
  user: SessionUser | null;
  /** Every club the viewer belongs to, not just an "active" one. */
  memberships: ClubMembership[];
  /** The club currently being viewed, or null when they belong to none. */
  activeClub: ClubMembership | null;
  /** The viewer's role in the active club. This is what gates anything. */
  role: Role | null;
  /** The viewer's job title in the active club, or null. Never gates anything. */
  position: Position | null;
  /**
   * What to call the viewer on screen: their position if they have one, their
   * role otherwise. "Treasurer" rather than "Officer".
   */
  title: string | null;
  /** Set when the session could not be loaded at all (API down, usually). */
  error: string | null;
  selectClub: (clubId: string) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

interface SessionResponse {
  user: SessionUser;
  memberships: ClubMembership[];
}

export function SessionProvider({children}: {children: React.ReactNode}) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [memberships, setMemberships] = useState<ClubMembership[]>([]);
  const [selectedClubId, setSelectedClubId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await apiFetch('/api/session');

      if (response.status === 401) {
        setStatus('anonymous');
        setUser(null);
        setMemberships([]);
        setError(null);
        return;
      }

      if (!response.ok) {
        throw new Error(`Session request failed (${response.status})`);
      }

      const data = (await response.json()) as SessionResponse;
      setUser(data.user);
      setMemberships(data.memberships);
      setStatus('authenticated');
      setError(null);
    } catch (cause) {
      // Distinguished from `anonymous` on purpose: "you are signed out" and
      // "we cannot reach the API" need different words on screen.
      setStatus('error');
      setError(
        cause instanceof Error && cause.message.includes('fetch')
          ? `Could not reach the API at ${API_URL}. Is it running?`
          : String(cause),
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSignOut = useCallback(async () => {
    await authClient.signOut();
    setStatus('anonymous');
    setUser(null);
    setMemberships([]);
    setSelectedClubId(null);
  }, []);

  const activeClub = useMemo(() => {
    if (memberships.length === 0) {
      return null;
    }
    return (
      memberships.find((club) => club.clubId === selectedClubId) ??
      memberships[0] ??
      null
    );
  }, [memberships, selectedClubId]);

  const value = useMemo<Session>(
    () => ({
      status,
      user,
      memberships,
      activeClub,
      role: activeClub?.role ?? null,
      position: activeClub?.position ?? null,
      title: activeClub
        ? memberTitle(activeClub.role, activeClub.position)
        : null,
      error,
      selectClub: setSelectedClubId,
      refresh,
      signOut: handleSignOut,
    }),
    [status, user, memberships, activeClub, error, refresh, handleSignOut],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return session;
}

/**
 * True when the current viewer may perform `capability` in the active club.
 *
 * Denies while the session is still loading and when the viewer belongs to no
 * club, so a control never flashes into view before we know the answer.
 */
export function useCan(capability: Capability): boolean {
  const {role} = useSession();
  return role === null ? false : can(role, capability);
}
