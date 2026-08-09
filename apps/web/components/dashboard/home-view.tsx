'use client';

/**
 * The dashboard's front door.
 *
 * Until now signing in landed on `/`, the public marketing page, and the three
 * things COS actually does were reachable only from the sidebar - so the first
 * screen after signing in was an advertisement for the product you had just
 * signed into. This is what that screen should have been: the state of the
 * club, with a named way into each part of it.
 *
 * The cards are summaries, not miniature copies of their surfaces. Each one
 * answers the single question that decides whether you need to go there -
 * what is next, what changed, what is left - and links out by name.
 *
 * Treasury appears only for officers. It is gated on `expense:view`, the same
 * capability the sidebar's Treasury group and the `/expenses` route use, so a
 * member sees a two-card dashboard rather than a card explaining what they may
 * not look at. Hiding it is a rendering decision, not a security one; the API
 * refuses a member's request regardless of what this drew.
 */

import type {CSSProperties} from 'react';
import {VStack} from '@astryxdesign/core/Stack';
import {Heading, Text} from '@astryxdesign/core/Text';

import {useCan, useSession} from '../../lib/session';
import styles from './dashboard.module.css';
import {DocumentsCard} from './documents-card';
import {NextUpCard} from './next-up-card';
import {TreasuryCard} from './treasury-card';

const page: CSSProperties = {
  padding: 'var(--spacing-5)',
  minWidth: 0,
};

/*
 * The grid itself lives in the CSS module, because it needs a media query and
 * an inline style cannot carry one. See dashboard.module.css for why the
 * column count is fixed rather than derived from a minimum card width.
 */

export function HomeView() {
  const {activeClub, user} = useSession();
  const canSeeTreasury = useCan('expense:view');

  return (
    <VStack gap={5} style={page} hAlign="stretch">
      <VStack gap={1}>
        <Heading level={1}>{activeClub?.name ?? 'Your club'}</Heading>
        <Text type="body" color="secondary">
          {user?.name ? `Signed in as ${user.name}. ` : ''}
          Everything the club is running, in one place.
        </Text>
      </VStack>

      <div className={styles.grid}>
        <NextUpCard />
        <DocumentsCard />
        {canSeeTreasury ? (
          <div className={styles.gridWide}>
            <TreasuryCard />
          </div>
        ) : null}
      </div>
    </VStack>
  );
}
