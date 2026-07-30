'use client';

/**
 * The calendar surface.
 *
 * The event store mounts here rather than in the shared layout because it is
 * scoped to one club and opens a polling subscription. Keeping it on this
 * route means leaving the calendar tears the subscription down.
 */

import {CalendarView} from '../../../components/calendar/calendar-view';
import {EventStoreProvider} from '../../../lib/event-store';
import {useSession} from '../../../lib/session';

export default function CalendarPage() {
  const {activeClub} = useSession();

  // AuthGuard in the layout has already returned early when there is no club.
  if (!activeClub) {
    return null;
  }

  return (
    <EventStoreProvider clubId={activeClub.clubId}>
      <CalendarView />
    </EventStoreProvider>
  );
}
