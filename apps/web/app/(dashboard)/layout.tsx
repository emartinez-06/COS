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
 */

import {AuthGuard} from '../../components/shell/auth-guard';
import {DashboardShell} from '../../components/shell/dashboard-shell';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <DashboardShell>{children}</DashboardShell>
    </AuthGuard>
  );
}
