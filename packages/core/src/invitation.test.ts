import {describe, expect, it} from 'vitest';

import {
  INVITATION_TTL_DAYS,
  invitationDraftSchema,
  invitationStatusSchema,
  isInvitationActionable,
} from './invitation.js';

const NOW = new Date('2026-08-01T12:00:00.000Z');

function invitation(overrides: {status?: string; expiresAt?: string} = {}) {
  return {
    status: 'pending',
    expiresAt: '2026-08-15T12:00:00.000Z',
    ...overrides,
  } as Parameters<typeof isInvitationActionable>[0];
}

describe('invitationDraftSchema', () => {
  it('normalises the email so lookup and uniqueness cannot disagree', () => {
    const parsed = invitationDraftSchema.parse({
      email: '  Jordan.Smith@Baylor.EDU ',
      role: 'admin',
      position: 'treasurer',
    });
    expect(parsed.email).toBe('jordan.smith@baylor.edu');
  });

  it('defaults position to null, since a title is optional', () => {
    const parsed = invitationDraftSchema.parse({
      email: 'sam@example.com',
      role: 'member',
    });
    expect(parsed.position).toBeNull();
  });

  it('rejects an address that is not an email', () => {
    const result = invitationDraftSchema.safeParse({
      email: 'not-an-address',
      role: 'member',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a role that is not a real role', () => {
    // Guards the boundary where a client could otherwise invent a role.
    const result = invitationDraftSchema.safeParse({
      email: 'sam@example.com',
      role: 'president',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a position that is not a real position', () => {
    const result = invitationDraftSchema.safeParse({
      email: 'sam@example.com',
      role: 'admin',
      position: 'supreme_leader',
    });
    expect(result.success).toBe(false);
  });
});

describe('isInvitationActionable', () => {
  it('accepts a pending invitation that has not expired', () => {
    expect(isInvitationActionable(invitation(), NOW)).toBe(true);
  });

  it('refuses one that has expired, even though it is still pending', () => {
    // The status column alone is not the answer. An invitation nobody ever
    // answered stays 'pending' forever, and time is what closes it.
    expect(
      isInvitationActionable(
        invitation({expiresAt: '2026-07-31T12:00:00.000Z'}),
        NOW,
      ),
    ).toBe(false);
  });

  it('treats the exact expiry instant as expired', () => {
    expect(
      isInvitationActionable(
        invitation({expiresAt: NOW.toISOString()}),
        NOW,
      ),
    ).toBe(false);
  });

  it('refuses anything already resolved', () => {
    for (const status of ['accepted', 'declined', 'revoked']) {
      expect(isInvitationActionable(invitation({status}), NOW), status).toBe(
        false,
      );
    }
  });
});

describe('invitationStatusSchema', () => {
  it('keeps declined and revoked distinct', () => {
    // One is the person saying no, the other is the club withdrawing. An
    // officer needs to be able to tell those apart.
    expect(invitationStatusSchema.options).toContain('declined');
    expect(invitationStatusSchema.options).toContain('revoked');
  });

  it('bounds an invitation to a sane lifetime', () => {
    expect(INVITATION_TTL_DAYS).toBeGreaterThan(0);
    expect(INVITATION_TTL_DAYS).toBeLessThanOrEqual(30);
  });
});
