import type {Metadata, Viewport} from 'next';
import {DM_Sans} from 'next/font/google';

// Astryx base styles. Order matters: reset, then the component stylesheet,
// then the built COS theme so its token overrides win.
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '../theme/cos.css';

import {Providers} from './providers';

// Self-hosted by Next at build time (no runtime request to Google), which
// matters here specifically: the product ships for self-hosting, and a
// webfont that phones home on every load is a dependency a self-hoster did
// not sign up for. The theme reads this through the CSS variable below.
const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  // A template rather than a fixed string: the calendar is no longer the only
  // surface, and a tab reading "Club Calendar" while the treasury is open is
  // wrong in the one place a user scans to find the right window.
  title: {
    default: 'COS',
    template: '%s - COS',
  },
  description:
    'Club Organizational Software: the shared workspace for club officers and members.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Light mode only for now; the theme defines dark tokens but the product
  // direction has not been designed for dark yet.
  colorScheme: 'light',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={dmSans.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
