/**
 * Names the route. The page is a client component and cannot export metadata
 * itself, which is why every surface here has one of these.
 *
 * No provider in this layout, unlike documents and expenses: the stores this
 * page needs are mounted on the page, so navigating away from the dashboard
 * stops the calendar's polling rather than leaving it running.
 */

import type {Metadata} from 'next';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export default function HomeLayout({children}: {children: React.ReactNode}) {
  return children;
}
