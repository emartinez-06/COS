'use client';

/**
 * Client-side provider stack.
 *
 * Order is deliberate: Theme outermost so every component below can resolve
 * tokens, then the session (the event store needs the viewer's name to record
 * an author), then the event store.
 */

import {Theme} from '@astryxdesign/core/theme';
import {cosTheme} from '../theme/cos';
import {EventStoreProvider} from '../lib/event-store';
import {SessionProvider} from '../lib/session';
import {DEMO_CLUB_ID} from '../lib/seed-events';

export function Providers({children}: {children: React.ReactNode}) {
  return (
    <Theme theme={cosTheme} mode="light">
      <SessionProvider>
        <EventStoreProvider clubId={DEMO_CLUB_ID}>
          {children}
        </EventStoreProvider>
      </SessionProvider>
    </Theme>
  );
}
