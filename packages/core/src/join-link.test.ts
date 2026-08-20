import {describe, expect, it} from 'vitest';

import {
  JOIN_LINK_MAX_MINUTES,
  JOIN_LINK_MIN_MINUTES,
  isJoinLinkActionable,
  joinLinkDraftSchema,
} from './join-link.js';

const NOW = new Date('2026-08-20T12:00:00.000Z');

function link(overrides: {status?: string; expiresAt?: string} = {}) {
  return {
    status: 'active',
    expiresAt: '2026-08-21T12:00:00.000Z',
    ...overrides,
  } as Parameters<typeof isJoinLinkActionable>[0];
}

describe('joinLinkDraftSchema', () => {
  it('defaults position to null', () => {
    const parsed = joinLinkDraftSchema.parse({
      role: 'member',
      expiresInMinutes: 60,
    });
    expect(parsed.position).toBeNull();
  });

  it('rejects a duration shorter than the minimum', () => {
    const result = joinLinkDraftSchema.safeParse({
      role: 'member',
      expiresInMinutes: JOIN_LINK_MIN_MINUTES - 1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a duration longer than the maximum', () => {
    const result = joinLinkDraftSchema.safeParse({
      role: 'member',
      expiresInMinutes: JOIN_LINK_MAX_MINUTES + 1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a role that is not a real role', () => {
    const result = joinLinkDraftSchema.safeParse({
      role: 'president',
      expiresInMinutes: 60,
    });
    expect(result.success).toBe(false);
  });
});

describe('isJoinLinkActionable', () => {
  it('accepts an active link that has not expired', () => {
    expect(isJoinLinkActionable(link(), NOW)).toBe(true);
  });

  it('refuses one that has expired, even though it is still active', () => {
    expect(
      isJoinLinkActionable(link({expiresAt: '2026-08-19T12:00:00.000Z'}), NOW),
    ).toBe(false);
  });

  it('treats the exact expiry instant as expired', () => {
    expect(
      isJoinLinkActionable(link({expiresAt: NOW.toISOString()}), NOW),
    ).toBe(false);
  });

  it('refuses a revoked link regardless of expiry', () => {
    expect(
      isJoinLinkActionable(
        link({status: 'revoked', expiresAt: '2026-12-01T12:00:00.000Z'}),
        NOW,
      ),
    ).toBe(false);
  });
});
