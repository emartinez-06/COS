'use client';

/**
 * The dashboard home.
 *
 * All three stores mount here rather than in the shared layout, which keeps
 * the existing rule intact: a provider lives on the route that needs it, so
 * leaving this page tears down the event store's 15s polling subscription
 * instead of leaving it running behind the calendar or the treasury.
 *
 * `TreasuryProvider` is mounted only for someone who may read the treasury.
 * It loads funds, allocations, and requests on mount, and for a member every
 * one of those is a 403 - so mounting it unconditionally would fire three
 * refused requests on every member's first screen and leave the card in an
 * error state that is not an error. The gate uses the same `expense:view`
 * capability the card itself checks, so the provider and its consumer can
 * never disagree about whether the card is there.
 */

import {DocumentsProvider} from '../../../components/documents/documents-provider';
import {HomeView} from '../../../components/dashboard/home-view';
import {TreasuryProvider} from '../../../components/treasury/treasury-provider';
import {EventStoreProvider} from '../../../lib/event-store';
import {useCan, useSession} from '../../../lib/session';

export default function HomePage() {
  const {activeClub} = useSession();
  const canSeeTreasury = useCan('expense:view');

  // AuthGuard in the layout has already returned early when there is no club.
  if (!activeClub) {
    return null;
  }

  const view = (
    <EventStoreProvider clubId={activeClub.clubId}>
      <DocumentsProvider>
        <HomeView />
      </DocumentsProvider>
    </EventStoreProvider>
  );

  return canSeeTreasury ? <TreasuryProvider>{view}</TreasuryProvider> : view;
}
