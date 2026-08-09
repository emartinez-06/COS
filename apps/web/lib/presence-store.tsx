'use client';

/**
 * Keeps the browser's presence reported, and the club's roster fresh.
 *
 * Two timers with different jobs and deliberately different periods:
 *
 * - The **heartbeat** says "this tab is open". It runs on
 *   `PRESENCE_HEARTBEAT_SECONDS`, which core also uses to size the window
 *   before someone counts as idle - so the two cannot drift into a state where
 *   a perfectly healthy tab is reported idle between beats.
 * - The **roster poll** asks who else is around. It is slower, because
 *   somebody else's dot going grey is not urgent and every member polling
 *   fast multiplies straight into database load.
 *
 * Both stop while the tab is hidden, and that is the feature rather than an
 * optimisation: a backgrounded tab that keeps beating reports someone as
 * active while they are in a lecture, which is precisely the lie a presence
 * indicator must not tell. Coming back to the tab beats immediately rather
 * than waiting out the interval, so returning does not leave you grey to
 * everyone else for half a minute.
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
import {
  PRESENCE_HEARTBEAT_SECONDS,
  type ManualPresenceStatus,
  type MemberPresence,
  type PresenceStatus,
} from '@cos/core';

import {listClubPresence, sendHeartbeat} from './presence-client';
import {useSession} from './session';

/** Slower than the heartbeat: someone else's dot is not urgent. */
const ROSTER_POLL_SECONDS = 60;

interface PresenceStore {
  /** Everyone in the club, including people who have never been seen. */
  members: MemberPresence[];
  /** The signed-in person's own resolved status. */
  ownStatus: PresenceStatus;
  /** What they chose, or null if they are letting the heartbeat decide. */
  manualStatus: ManualPresenceStatus | null;
  setManualStatus: (status: ManualPresenceStatus | null) => Promise<void>;
}

const PresenceContext = createContext<PresenceStore | null>(null);

export function PresenceProvider({children}: {children: React.ReactNode}) {
  const {activeClub, user} = useSession();
  const clubId = activeClub?.clubId ?? null;
  const userId = user?.id ?? null;

  const [members, setMembers] = useState<MemberPresence[]>([]);
  const [ownStatus, setOwnStatus] = useState<PresenceStatus>('active');
  const [manualStatus, setManual] = useState<ManualPresenceStatus | null>(null);

  /**
   * Held in a ref as well as state so the heartbeat can read the current
   * choice without the timer being torn down and rebuilt every time it
   * changes - which would restart the interval and skew the beat.
   */
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const beat = useCallback(async () => {
    if (!userId) {
      return;
    }
    const own = await sendHeartbeat();
    if (own && isMounted.current) {
      setOwnStatus(own.status);
      setManual(own.manualStatus);
    }
  }, [userId]);

  const refreshRoster = useCallback(async () => {
    if (!clubId) {
      return;
    }
    const roster = await listClubPresence(clubId);
    if (isMounted.current) {
      setMembers(roster);
    }
  }, [clubId]);

  // The heartbeat. Paused with the tab, and fired once on return so coming
  // back does not leave you grey for up to a full interval.
  useEffect(() => {
    if (!userId) {
      return;
    }

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer !== null) {
        return;
      }
      void beat();
      timer = setInterval(() => void beat(), PRESENCE_HEARTBEAT_SECONDS * 1000);
    };

    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') {
      start();
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [userId, beat]);

  // The roster poll, on the same visibility rule and a slower period.
  useEffect(() => {
    if (!clubId) {
      return;
    }

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer !== null) {
        return;
      }
      void refreshRoster();
      timer = setInterval(
        () => void refreshRoster(),
        ROSTER_POLL_SECONDS * 1000,
      );
    };

    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') {
      start();
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [clubId, refreshRoster]);

  const setManualStatus = useCallback(
    async (status: ManualPresenceStatus | null) => {
      // Applied locally first. The control is a direct statement about
      // yourself, and a dot that waits for a round trip before moving reads as
      // a broken toggle.
      setManual(status);

      const own = await sendHeartbeat(status);
      if (own && isMounted.current) {
        setOwnStatus(own.status);
        setManual(own.manualStatus);
      }

      // The roster carries your own row too, so it has to catch up or your
      // avatar in a member list disagrees with the one in the sidebar.
      void refreshRoster();
    },
    [refreshRoster],
  );

  const value = useMemo<PresenceStore>(
    () => ({members, ownStatus, manualStatus, setManualStatus}),
    [members, ownStatus, manualStatus, setManualStatus],
  );

  return (
    <PresenceContext.Provider value={value}>
      {children}
    </PresenceContext.Provider>
  );
}

/**
 * Returns null outside a provider rather than throwing, unlike the event and
 * document stores.
 *
 * Those are mounted by the one route that needs them and a missing provider is
 * a wiring bug worth failing loudly on. Presence is decoration on chrome that
 * renders on every surface, including ones outside the dashboard shell, and a
 * missing dot is not worth replacing a working page with an error.
 */
export function usePresence(): PresenceStore | null {
  return useContext(PresenceContext);
}
