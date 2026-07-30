/**
 * Exists only to name the route. See the calendar's layout for why.
 */

import type {Metadata} from 'next';

export const metadata: Metadata = {
  title: 'Settings',
};

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
