'use client';

/**
 * The invitation prompt, bottom-left.
 *
 * This is the delivery mechanism for an invitation until there is a
 * transactional email provider. It is not a lesser substitute: even once mail
 * is sending, someone who is already signed in should be told here rather than
 * be asked to go and find an email.
 *
 * Only one invitation is shown at a time, the oldest first. A stack of
 * competing accept/decline prompts is how someone joins a club they did not
 * mean to.
 *
 * Polls rather than subscribes, on the same reasoning as the calendar: the
 * transport is isolated here, so moving to SSE later changes this file and
 * nothing else. The interval is slower than the calendar's because an
 * invitation is not time-critical - being told within a minute is fine, and
 * the cost of being wrong is an extra request per user per minute.
 */

import {useCallback, useEffect, useRef, useState, type CSSProperties} from 'react';
import {Badge} from '@astryxdesign/core/Badge';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Text, Heading} from '@astryxdesign/core/Text';
import type {ClubInvitation} from '@cos/core';
import {POSITION_LABELS, ROLE_LABELS} from '@cos/core';

import {
  listMyInvitations,
  respondToInvitation,
} from '../../lib/invitation-client';
import {useSession} from '../../lib/session';

const POLL_MS = 60_000;

const dock: CSSProperties = {
  position: 'fixed',
  insetInlineStart: 'var(--spacing-5)',
  insetBlockEnd: 'var(--spacing-5)',
  // Above the dot grid and the shell's own chrome, below any dialog: a modal
  // is a decision in progress and must not be covered by this.
  zIndex: 50,
  width: 'min(360px, calc(100vw - var(--spacing-10)))',
};

const card: CSSProperties = {
  // Opaque on purpose. It floats over the dotted canvas.
  backgroundColor: 'var(--color-background-surface)',
};

/**
 * Green accept, red decline.
 *
 * The colours are the point of this control, so they are set explicitly rather
 * than left to a variant that resolves to grey.
 *
 * Use `--color-success` / `--color-error`, not `--color-background-positive`.
 * The latter does not exist in this theme, and an unresolved custom property
 * falls back to `transparent` rather than erroring - which produced white text
 * on a white card, a button that was invisible until it was looked at.
 */
const acceptButton: CSSProperties = {
  backgroundColor: 'var(--color-success)',
  borderColor: 'var(--color-success)',
  color: 'var(--color-on-success)',
};

const declineButton: CSSProperties = {
  backgroundColor: 'var(--color-error)',
  borderColor: 'var(--color-error)',
  color: 'var(--color-on-error)',
};

export function InvitationToast() {
  const {status, user, refresh} = useSession();
  const [invitations, setInvitations] = useState<ClubInvitation[]>([]);
  const [isResponding, setIsResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against a poll that resolves after the component unmounts, and
  // against two polls overlapping if one is slow.
  const inFlight = useRef(false);

  const poll = useCallback(async () => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    try {
      setInvitations(await listMyInvitations());
    } catch {
      // A failed poll is not worth interrupting anyone over. The next one
      // will pick the invitation up, and a banner here would be noise on top
      // of whatever already went wrong.
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') {
      setInvitations([]);
      return;
    }

    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);

    // A tab that has been in the background is exactly where an invitation
    // sent five minutes ago is waiting, so catch up on return rather than
    // waiting out the remainder of the interval.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void poll();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // `user?.id` is load-bearing: an in-tab account switch must start polling
    // for the new person rather than keep the previous person's answers.
  }, [status, user?.id, poll]);

  const invitation = invitations[0] ?? null;

  async function respond(decision: 'accepted' | 'declined') {
    if (!invitation) {
      return;
    }

    setIsResponding(true);
    setError(null);
    try {
      await respondToInvitation(invitation.id, decision);
      // Drop it locally rather than waiting a full poll, so the card goes away
      // the moment the person answers.
      setInvitations((current) =>
        current.filter((entry) => entry.id !== invitation.id),
      );
      if (decision === 'accepted') {
        // The new membership changes the whole session: which clubs exist in
        // the switcher, and what the sidebar is allowed to show.
        await refresh();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      // Re-read: the usual reason this fails is that the invitation was
      // revoked or already answered elsewhere, and the list should reflect it.
      await poll();
    } finally {
      setIsResponding(false);
    }
  }

  if (!invitation) {
    return null;
  }

  const offered = invitation.position
    ? POSITION_LABELS[invitation.position]
    : ROLE_LABELS[invitation.role];

  return (
    <VStack gap={0} style={dock} hAlign="stretch">
      <Card padding={5} elevation="high" style={card}>
        <VStack gap={4} hAlign="stretch">
          <VStack gap={1}>
            <HStack gap={2} vAlign="center" hAlign="between">
              <Heading level={3}>Club invitation</Heading>
              <Badge label={offered} variant="info" />
            </HStack>
            <Text type="body" color="secondary">
              {invitation.invitedByName
                ? `${invitation.invitedByName} invited you to join ${invitation.clubName}.`
                : `You have been invited to join ${invitation.clubName}.`}
            </Text>
          </VStack>

          {/*
            Text has no negative colour in its scale, so the error uses a
            Banner, which is the component that owns error styling anyway.
          */}
          {error ? <Banner status="error" title={error} /> : null}

          <HStack gap={2}>
            <Button
              label="Accept"
              variant="primary"
              isDisabled={isResponding}
              style={acceptButton}
              onClick={() => void respond('accepted')}
            />
            <Button
              label="Decline"
              variant="secondary"
              isDisabled={isResponding}
              style={declineButton}
              onClick={() => void respond('declined')}
            />
          </HStack>

          {invitations.length > 1 ? (
            <Text type="supporting" color="secondary">
              {invitations.length - 1} more waiting.
            </Text>
          ) : null}
        </VStack>
      </Card>
    </VStack>
  );
}
