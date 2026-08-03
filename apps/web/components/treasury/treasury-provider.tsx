'use client';

/**
 * Mounts the treasury store for every route under `/expenses`.
 *
 * In the segment's layout rather than on the page, matching the document hub
 * and for the same reason: `TreasuryRepository` has no `subscribe`, so there is
 * no polling subscription that leaving the section must tear down. Hoisting
 * costs one load and saves re-reading three lists on every back-navigation.
 *
 * A client component because the club comes from the session, and the layout
 * that renders this is a server component that exists to set the page title.
 */

import {TreasuryStoreProvider} from '../../lib/treasury-store';
import {useSession} from '../../lib/session';

export function TreasuryProvider({children}: {children: React.ReactNode}) {
  const {activeClub} = useSession();

  // AuthGuard in the dashboard layout has already returned early when there is
  // no session and no club.
  if (!activeClub) {
    return null;
  }

  return (
    <TreasuryStoreProvider clubId={activeClub.clubId}>
      {children}
    </TreasuryStoreProvider>
  );
}
