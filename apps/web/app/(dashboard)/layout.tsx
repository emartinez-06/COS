'use client';

/**
 * The frame every signed-in surface shares.
 *
 * The guard and the shell live here rather than in each page so that a new
 * destination is a single `page.tsx` - forgetting to wrap one is how a surface
 * ends up rendering without navigation, or worse, without the auth gate.
 *
 * `(dashboard)` is a route group, so it adds no path segment: the routes below
 * are `/calendar` and `/expenses`, not `/dashboard/calendar`.
 *
 * Data providers deliberately do not live here. The event store is scoped to
 * the calendar, and mounting it around the whole dashboard would start a
 * polling subscription for anyone sitting on a treasury page.
 *
 * `PresenceProvider` is the one exception, and it is an exception rather than
 * a loosening of that rule. The rule exists so a subscription belongs to the
 * surface that needs it; presence is drawn by the *shell* - the sidebar's
 * avatar, on every screen - so its surface is all of them. Scoped to a route
 * it would report someone as online only while they sat on that one page, and
 * their own dot would change as they navigated. Its polling is the feature
 * rather than a cost to be scoped away, and it stops with the tab.
 *
 * It sits inside AuthGuard because there is nobody to report a heartbeat for
 * until the session resolves.
 */

import {AuthGuard} from '../../components/shell/auth-guard';
import {DashboardShell} from '../../components/shell/dashboard-shell';
import {PresenceProvider} from '../../lib/presence-store';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <PresenceProvider>
        <DashboardShell>{children}</DashboardShell>
      </PresenceProvider>
    </AuthGuard>
  );
}
