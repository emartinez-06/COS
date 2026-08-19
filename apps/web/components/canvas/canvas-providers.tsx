'use client';

/**
 * Mounts every store a canvas embed can read from, for every route under
 * `/canvas`.
 *
 * In the segment's layout rather than on the page, matching the treasury and
 * document hub: `CanvasRepository` has no `subscribe`, so there is no
 * polling subscription that leaving the canvas must tear down.
 *
 * `EventStoreProvider`, `DocumentStoreProvider`, and `TreasuryStoreProvider`
 * are mounted here too, alongside `CanvasStoreProvider`, so the calendar,
 * documents, and expenses embeds can read from the same stores their own
 * pages use rather than a second, parallel fetch of the same data. The one
 * real cost is the calendar's 15s poll running while the canvas is open -
 * accepted rather than building a second data path for three things this
 * app already fetches correctly. Only officers ever reach this layout
 * (`canvas:view` gates the route), so every one of them already has
 * `expense:view` too.
 *
 * A client component because the club comes from the session, and the
 * layout that renders this is a server component that exists to set the
 * page title.
 */

import {CanvasPresenceProvider} from '../../lib/canvas-presence-store';
import {CanvasStoreProvider} from '../../lib/canvas-store';
import {DocumentStoreProvider} from '../../lib/document-store';
import {EventStoreProvider} from '../../lib/event-store';
import {useSession} from '../../lib/session';
import {TreasuryStoreProvider} from '../../lib/treasury-store';

export function CanvasProviders({children}: {children: React.ReactNode}) {
  const {activeClub} = useSession();

  // AuthGuard in the dashboard layout has already returned early when there
  // is no session and no club.
  if (!activeClub) {
    return null;
  }

  return (
    <CanvasStoreProvider clubId={activeClub.clubId}>
      {/* Club-scoped, not board-scoped - a club has exactly one board, so
          there is nothing this needs from CanvasStoreProvider itself. */}
      <CanvasPresenceProvider clubId={activeClub.clubId}>
        <EventStoreProvider clubId={activeClub.clubId}>
          <DocumentStoreProvider clubId={activeClub.clubId}>
            <TreasuryStoreProvider clubId={activeClub.clubId}>
              {children}
            </TreasuryStoreProvider>
          </DocumentStoreProvider>
        </EventStoreProvider>
      </CanvasPresenceProvider>
    </CanvasStoreProvider>
  );
}
