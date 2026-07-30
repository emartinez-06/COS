'use client';

/**
 * Inviting people to the club, and seeing who is already invited.
 *
 * The invite form is gated on `member:invite`, which every officer holds and
 * no member does. It is deliberately *not* gated on being the President: a
 * club whose president has gone quiet still needs its treasurer able to add
 * someone. Positions are titles, not permissions - see @cos/core role.ts.
 *
 * Note what an invitation is not: it is not a membership. Nothing happens to
 * the invitee's account until they accept, which is why this list can contain
 * addresses that have no user behind them yet.
 */

import {useCallback, useEffect, useState, type CSSProperties} from 'react';
import {Badge} from '@astryxdesign/core/Badge';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Divider} from '@astryxdesign/core/Divider';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Icon} from '@astryxdesign/core/Icon';
import {Selector} from '@astryxdesign/core/Selector';
import {HStack, VStack} from '@astryxdesign/core/Stack';
import {Text, Heading} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {EnvelopeIcon} from '@heroicons/react/24/outline';
import type {ClubInvitation, Position, Role} from '@cos/core';
import {ALL_POSITIONS, POSITION_LABELS, ROLE_LABELS} from '@cos/core';

import {createInvitation, listClubInvitations} from '../../lib/invitation-client';
import {useCan, useSession} from '../../lib/session';

const NO_POSITION = 'none';

const ROLE_OPTIONS = [
  {
    value: 'member' as Role,
    label: `${ROLE_LABELS.member} - can see the calendar`,
  },
  {
    value: 'admin' as Role,
    label: `${ROLE_LABELS.admin} - can run the club`,
  },
];

const POSITION_OPTIONS = [
  {value: NO_POSITION, label: 'No title'},
  ...ALL_POSITIONS.map((position) => ({
    value: position as string,
    label: POSITION_LABELS[position],
  })),
];

const rowPadding: CSSProperties = {paddingBlock: 'var(--spacing-3)'};

function statusVariant(status: ClubInvitation['status']) {
  switch (status) {
    case 'accepted':
      return 'success' as const;
    case 'declined':
    case 'revoked':
      return 'error' as const;
    default:
      return 'neutral' as const;
  }
}

function InvitationRow({invitation}: {invitation: ClubInvitation}) {
  return (
    <>
      <HStack hAlign="between" vAlign="center" style={rowPadding} gap={3}>
        <VStack gap={0}>
          <Text type="body" weight="semibold" display="block">
            {invitation.email}
          </Text>
          <Text type="supporting" color="secondary" display="block">
            {invitation.position
              ? POSITION_LABELS[invitation.position]
              : ROLE_LABELS[invitation.role]}
            {invitation.invitedByName
              ? ` - invited by ${invitation.invitedByName}`
              : null}
          </Text>
        </VStack>
        <Badge label={invitation.status} variant={statusVariant(invitation.status)} />
      </HStack>
      <Divider />
    </>
  );
}

export function MembersSection() {
  const {activeClub} = useSession();
  const canInvite = useCan('member:invite');

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [position, setPosition] = useState<string>(NO_POSITION);

  const [invitations, setInvitations] = useState<ClubInvitation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const clubId = activeClub?.clubId ?? null;

  const refresh = useCallback(async () => {
    if (!clubId) {
      return;
    }
    setIsLoading(true);
    try {
      setInvitations(await listClubInvitations(clubId));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsLoading(false);
    }
  }, [clubId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function submit() {
    if (!clubId) {
      return;
    }

    // Checked here as well as by the schema so the message lands on the field
    // rather than in a banner at the top of the page.
    const trimmed = email.trim();
    if (!trimmed) {
      setEmailError('Enter an email address.');
      return;
    }

    setEmailError(null);
    setIsSending(true);
    setError(null);
    setSent(null);

    try {
      const created = await createInvitation(clubId, {
        email: trimmed,
        role,
        position: position === NO_POSITION ? null : (position as Position),
      });
      setSent(created.email);
      setEmail('');
      setPosition(NO_POSITION);
      setRole('member');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSending(false);
    }
  }

  return (
    <VStack gap={5} hAlign="stretch">
      <VStack gap={1}>
        <Heading level={2}>Members</Heading>
        <Text type="body" color="secondary">
          Invite people to {activeClub?.name ?? 'the club'} and see who has
          been asked.
        </Text>
      </VStack>

      {canInvite ? (
        <Card padding={6}>
          <VStack gap={4} hAlign="stretch">
            <VStack gap={1}>
              <Heading level={3}>Invite someone</Heading>
              <Text type="supporting" color="secondary">
                They will be asked to accept the next time they sign in. Nothing
                changes for them until they do.
              </Text>
            </VStack>

            <TextInput
              label="Email address"
              type="email"
              value={email}
              onChange={setEmail}
              isRequired
              status={
                emailError ? {type: 'error', message: emailError} : undefined
              }
            />

            <Selector
              label="Role"
              options={ROLE_OPTIONS}
              value={role}
              onChange={(value) => setRole(value as Role)}
              description="What they will be able to do. This is the part that matters."
            />

            <Selector
              label="Position"
              options={POSITION_OPTIONS}
              value={position}
              onChange={(value) => setPosition(value ?? NO_POSITION)}
              description="Their job title. Optional, and grants nothing on its own."
            />

            {error ? <Banner status="error" title={error} /> : null}
            {sent ? (
              <Banner
                status="success"
                title={`Invitation sent to ${sent}`}
                description="It stays open for 14 days."
              />
            ) : null}

            <HStack hAlign="start">
              <Button
                label={isSending ? 'Sending...' : 'Send invitation'}
                variant="primary"
                isDisabled={isSending}
                onClick={() => void submit()}
              />
            </HStack>
          </VStack>
        </Card>
      ) : null}

      <Card padding={6}>
        <VStack gap={2} hAlign="stretch">
          <Heading level={3}>Invitations</Heading>

          {isLoading ? (
            <Text type="body" color="secondary">
              Loading...
            </Text>
          ) : invitations.length === 0 ? (
            <EmptyState
              icon={<Icon icon={EnvelopeIcon} />}
              title="Nobody has been invited yet"
              description={
                canInvite
                  ? 'Invitations you send appear here with their status.'
                  : 'An officer can invite new members.'
              }
              isCompact
            />
          ) : (
            <VStack gap={0} hAlign="stretch">
              {invitations.map((invitation) => (
                <InvitationRow key={invitation.id} invitation={invitation} />
              ))}
            </VStack>
          )}
        </VStack>
      </Card>
    </VStack>
  );
}
