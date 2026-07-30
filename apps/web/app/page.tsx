'use client';

/**
 * The dashboard is the calendar for now. When v0.2 adds more surfaces this
 * becomes a redirect to /calendar and each surface gets its own route.
 *
 * The event store mounts here rather than in the root providers because it is
 * scoped to one club, and the club is only known once AuthGuard has confirmed
 * a session with at least one membership.
 */

import {CalendarView} from '../components/calendar/calendar-view';
import {AuthGuard} from '../components/shell/auth-guard';
import {DashboardShell} from '../components/shell/dashboard-shell';
import {EventStoreProvider} from '../lib/event-store';
import {useSession} from '../lib/session';

function Dashboard() {
  const {activeClub} = useSession();

  // AuthGuard has already returned early when there is no club.
  if (!activeClub) {
    return null;
  }

  return (
    <EventStoreProvider clubId={activeClub.clubId}>
      <DashboardShell>
        <CalendarView />
      </DashboardShell>
    </EventStoreProvider>
  );
}

export default function DashboardPage() {
  return (
    <AuthGuard>
      <Dashboard />
    </AuthGuard>
  );
}
