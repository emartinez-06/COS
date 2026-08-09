import {describe, expect, it} from 'vitest';

import {
  PRESENCE_ACTIVE_SECONDS,
  PRESENCE_IDLE_SECONDS,
  isInterruptible,
  presenceUpdateSchema,
  resolvePresence,
  type PresenceRecord,
} from './presence.js';

const NOW = new Date('2026-08-08T12:00:00.000Z');

function secondsAgo(seconds: number): string {
  return new Date(NOW.getTime() - seconds * 1000).toISOString();
}

function record(overrides: Partial<PresenceRecord> = {}): PresenceRecord {
  return {
    userId: 'user_1',
    manualStatus: null,
    lastSeenAt: secondsAgo(5),
    ...overrides,
  };
}

describe('resolvePresence', () => {
  it('is active for a recent heartbeat', () => {
    expect(resolvePresence(record(), NOW)).toBe('active');
  });

  it('is idle once the heartbeat is older than the active window', () => {
    const quiet = record({lastSeenAt: secondsAgo(PRESENCE_ACTIVE_SECONDS + 1)});

    expect(resolvePresence(quiet, NOW)).toBe('idle');
  });

  it('stays active right up to the boundary', () => {
    const edge = record({lastSeenAt: secondsAgo(PRESENCE_ACTIVE_SECONDS)});

    expect(resolvePresence(edge, NOW)).toBe('active');
  });

  it('is offline past the idle window', () => {
    const gone = record({lastSeenAt: secondsAgo(PRESENCE_IDLE_SECONDS + 1)});

    expect(resolvePresence(gone, NOW)).toBe('offline');
  });

  it('is offline when a browser has never checked in', () => {
    expect(resolvePresence(record({lastSeenAt: null}), NOW)).toBe('offline');
  });

  it('lets a person override what the heartbeat says', () => {
    const busy = record({manualStatus: 'dnd'});

    expect(resolvePresence(busy, NOW)).toBe('dnd');
  });

  it('honours a manual idle while the person is plainly still typing', () => {
    expect(resolvePresence(record({manualStatus: 'idle'}), NOW)).toBe('idle');
  });

  it('honours a manual active while the heartbeat says idle', () => {
    const stale = record({
      manualStatus: 'active',
      lastSeenAt: secondsAgo(PRESENCE_ACTIVE_SECONDS + 60),
    });

    expect(resolvePresence(stale, NOW)).toBe('active');
  });

  /**
   * The rule that keeps the badge honest. Someone who set do-not-disturb and
   * then shut their laptop is gone, and a week-old "busy" badge is worse than
   * no badge at all - it is a claim about the present made from stale data.
   */
  it('goes offline despite a manual status once the heartbeat is long gone', () => {
    const abandoned = record({
      manualStatus: 'dnd',
      lastSeenAt: secondsAgo(PRESENCE_IDLE_SECONDS + 60),
    });

    expect(resolvePresence(abandoned, NOW)).toBe('offline');
  });

  /** A clock ahead of the server must not read as "seen in the future". */
  it('treats a future heartbeat as just now', () => {
    const skewed = record({lastSeenAt: secondsAgo(-120)});

    expect(resolvePresence(skewed, NOW)).toBe('active');
  });

  it('defaults `now` to the current time', () => {
    const fresh = record({lastSeenAt: new Date().toISOString()});

    expect(resolvePresence(fresh)).toBe('active');
  });
});

describe('isInterruptible', () => {
  it('is true only when someone is actually around and has not asked not to be', () => {
    expect(isInterruptible('active')).toBe(true);
    expect(isInterruptible('idle')).toBe(false);
    expect(isInterruptible('dnd')).toBe(false);
    expect(isInterruptible('offline')).toBe(false);
  });
});

describe('presenceUpdateSchema', () => {
  it('accepts a bare heartbeat that says nothing about the choice', () => {
    expect(presenceUpdateSchema.parse({})).toEqual({});
  });

  it('accepts an explicit null as "go back to automatic"', () => {
    expect(presenceUpdateSchema.parse({manualStatus: null})).toEqual({
      manualStatus: null,
    });
  });

  it('accepts each settable status', () => {
    for (const status of ['active', 'idle', 'dnd'] as const) {
      expect(presenceUpdateSchema.parse({manualStatus: status})).toEqual({
        manualStatus: status,
      });
    }
  });

  /**
   * `offline` is the absence of a heartbeat, not a mood. Allowing it to be set
   * would make the one factual status mean nothing.
   */
  it('refuses to let anyone declare themselves offline', () => {
    expect(() =>
      presenceUpdateSchema.parse({manualStatus: 'offline'}),
    ).toThrow();
  });
});
