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
 *
 * `InvitationToast` does live here, and deliberately sits outside AuthGuard.
 * The person most likely to have a pending invitation is someone who belongs
 * to no club yet, and AuthGuard replaces the whole page for them with "You are
 * not in a club yet". Mounted inside it, the one prompt that would fix that
 * situation would be the one thing they could never see. It self-gates on an
 * authenticated session, so it stays absent from the login and sign-up
 * screens.
 */

import {Theme} from '@astryxdesign/core/theme';
import {cosTheme} from '../theme/cos';
import {SessionProvider} from '../lib/session';
import {InvitationToast} from '../components/shell/invitation-toast';

export function Providers({children}: {children: React.ReactNode}) {
  return (
    <Theme theme={cosTheme} mode="light">
      <SessionProvider>
        {children}
        <InvitationToast />
      </SessionProvider>
    </Theme>
  );
}
