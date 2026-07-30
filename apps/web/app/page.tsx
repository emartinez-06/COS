import {CalendarView} from '../components/calendar/calendar-view';
import {DashboardShell} from '../components/shell/dashboard-shell';

/**
 * The dashboard is the calendar for now. When v0.2 adds more surfaces this
 * becomes a redirect to /calendar and each surface gets its own route.
 */
export default function DashboardPage() {
  return (
    <DashboardShell>
      <CalendarView />
    </DashboardShell>
  );
}
