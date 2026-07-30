'use client';

/**
 * The current viewer: who they are and what role they hold in this club.
 *
 * Phase 1 has no auth (the mechanism is still an open question - it must work
 * self-hosted and eventually speak university SSO). So the role is switchable
 * from the UI, and this module is the single place that assumption lives.
 *
 * The important part is the *shape*: components ask `useCan('event:create')`,
 * never `role === 'admin'`. When real auth arrives it replaces the provider's
 * internals and every consumer keeps working.
 */

import {createContext, useContext, useMemo, useState} from 'react';
import type {Capability, Role} from '@cos/core';
import {can} from '@cos/core';

interface Session {
  /** Display name of the viewer. */
  name: string;
  role: Role;
  /** Phase-1 only: lets one browser act as both officer and member. */
  setRole: (role: Role) => void;
}

const SessionContext = createContext<Session | null>(null);

interface SessionProviderProps {
  children: React.ReactNode;
  initialRole?: Role;
  name?: string;
}

export function SessionProvider({
  children,
  initialRole = 'admin',
  name = 'Erick Martinez',
}: SessionProviderProps) {
  const [role, setRole] = useState<Role>(initialRole);

  const value = useMemo<Session>(
    () => ({name, role, setRole}),
    [name, role],
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

/** True when the current viewer may perform `capability`. */
export function useCan(capability: Capability): boolean {
  const {role} = useSession();
  return can(role, capability);
}
