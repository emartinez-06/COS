'use client';

/**
 * Client-side provider stack.
 *
 * Theme is outermost so every component below can resolve tokens, then the
 * session, which every screen needs - including the login screen, which uses
 * it to redirect someone who is already signed in.
 *
 * The event store deliberately does *not* live here. It is scoped to a club,
 * and which club that is only becomes known once the session resolves, so it
 * mounts inside the guarded dashboard instead.
 */

import {Theme} from '@astryxdesign/core/theme';
import {cosTheme} from '../theme/cos';
import {SessionProvider} from '../lib/session';

export function Providers({children}: {children: React.ReactNode}) {
  return (
    <Theme theme={cosTheme} mode="light">
      <SessionProvider>{children}</SessionProvider>
    </Theme>
  );
}
