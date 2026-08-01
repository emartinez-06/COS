'use client';

/**
 * Mounts the document store for every route under `/documents`.
 *
 * It sits in the segment's layout rather than on each page, which is the
 * opposite of what the calendar does, and the difference is the point: the
 * event store opens a 15s polling subscription, so leaving the calendar has to
 * tear it down. This store has no subscription at all - the port deliberately
 * has no `subscribe` - so hoisting it costs one listing fetch and saves
 * re-fetching that listing every time someone closes a document and goes back
 * to the hub.
 *
 * A client component because the club comes from the session, and the layout
 * that renders this is a server component that exists to set the page title.
 */

import {DocumentStoreProvider} from '../../lib/document-store';
import {useSession} from '../../lib/session';

export function DocumentsProvider({children}: {children: React.ReactNode}) {
  const {activeClub} = useSession();

  // AuthGuard in the dashboard layout has already returned early when there is
  // no session and no club.
  if (!activeClub) {
    return null;
  }

  return (
    <DocumentStoreProvider clubId={activeClub.clubId}>
      {children}
    </DocumentStoreProvider>
  );
}
