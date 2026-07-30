/**
 * Exists only to name the route.
 *
 * `page.tsx` is a client component and cannot export metadata, so the title
 * lives in this server layout alongside it.
 */

import type {Metadata} from 'next';

export const metadata: Metadata = {
  title: 'Calendar',
};

export default function CalendarLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
