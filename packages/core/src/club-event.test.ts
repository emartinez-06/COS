/**
 * These exist mainly to pin schema *behaviour* across the Zod 3 to 4 upgrade,
 * which better-auth forced. Types compiling proves nothing about whether the
 * same inputs still validate the same way.
 */

import {describe, expect, it} from 'vitest';

import {
  byStartTime,
  clubEventSchema,
  eventDraftSchema,
  eventLinkSchema,
  groupEventsByDay,
  isoInstantSchema,
  toLocalDayKey,
  upcomingEvents,
} from './club-event.js';
import type {ClubEvent} from './club-event.js';

function event(overrides: Partial<ClubEvent> = {}): ClubEvent {
  return {
    id: 'evt_1',
    clubId: 'club_1',
    title: 'Weekly Chapter Meeting',
    description: '',
    startsAt: '2026-08-14T18:00:00.000Z',
    endsAt: '2026-08-14T19:00:00.000Z',
    location: '',
    speaker: null,
    links: [],
    category: 'meeting',
    visibility: 'members',
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    createdBy: 'Erick Martinez',
    ...overrides,
  };
}

describe('isoInstantSchema', () => {
  it('accepts instants with an offset', () => {
    expect(isoInstantSchema.parse('2026-08-14T18:00:00.000Z')).toBe(
      '2026-08-14T18:00:00.000Z',
    );
    expect(isoInstantSchema.parse('2026-08-14T18:00:00-05:00')).toBe(
      '2026-08-14T18:00:00-05:00',
    );
  });

  it('rejects a bare local datetime, which is the whole point of the type', () => {
    expect(isoInstantSchema.safeParse('2026-08-14T18:00:00').success).toBe(
      false,
    );
  });

  it('rejects a date with no time and outright garbage', () => {
    expect(isoInstantSchema.safeParse('2026-08-14').success).toBe(false);
    expect(isoInstantSchema.safeParse('next tuesday').success).toBe(false);
    expect(isoInstantSchema.safeParse('').success).toBe(false);
  });
});

describe('eventLinkSchema', () => {
  it('requires a label and a real URL', () => {
    expect(
      eventLinkSchema.safeParse({label: 'RSVP', url: 'https://example.com'})
        .success,
    ).toBe(true);
    expect(
      eventLinkSchema.safeParse({label: '', url: 'https://example.com'}).success,
    ).toBe(false);
    expect(
      eventLinkSchema.safeParse({label: 'RSVP', url: 'not a url'}).success,
    ).toBe(false);
  });
});

describe('eventDraftSchema', () => {
  const minimal = {
    title: 'Resume Workshop',
    startsAt: '2026-08-14T18:00:00.000Z',
    endsAt: '2026-08-14T19:30:00.000Z',
  };

  it('fills in every optional field so the API never sees undefined', () => {
    const draft = eventDraftSchema.parse(minimal);
    expect(draft.description).toBe('');
    expect(draft.location).toBe('');
    expect(draft.speaker).toBeNull();
    expect(draft.links).toEqual([]);
    expect(draft.category).toBe('meeting');
    expect(draft.visibility).toBe('members');
  });

  it('rejects an end time at or before the start time', () => {
    const backwards = eventDraftSchema.safeParse({
      ...minimal,
      endsAt: '2026-08-14T17:00:00.000Z',
    });
    expect(backwards.success).toBe(false);

    const zeroLength = eventDraftSchema.safeParse({
      ...minimal,
      endsAt: minimal.startsAt,
    });
    expect(zeroLength.success).toBe(false);
  });

  it('reports the end-time error on endsAt, which is where the form shows it', () => {
    const result = eventDraftSchema.safeParse({
      ...minimal,
      endsAt: '2026-08-14T17:00:00.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['endsAt']);
    }
  });

  it('requires a title and caps its length', () => {
    expect(eventDraftSchema.safeParse({...minimal, title: ''}).success).toBe(
      false,
    );
    expect(
      eventDraftSchema.safeParse({...minimal, title: 'x'.repeat(121)}).success,
    ).toBe(false);
    expect(
      eventDraftSchema.safeParse({...minimal, title: 'x'.repeat(120)}).success,
    ).toBe(true);
  });

  it('caps links at ten', () => {
    const link = {label: 'RSVP', url: 'https://example.com'};
    expect(
      eventDraftSchema.safeParse({...minimal, links: Array(10).fill(link)})
        .success,
    ).toBe(true);
    expect(
      eventDraftSchema.safeParse({...minimal, links: Array(11).fill(link)})
        .success,
    ).toBe(false);
  });

  it('rejects an unknown category', () => {
    expect(
      eventDraftSchema.safeParse({...minimal, category: 'rager'}).success,
    ).toBe(false);
  });
});

describe('clubEventSchema', () => {
  it('accepts a fully formed event', () => {
    expect(clubEventSchema.safeParse(event()).success).toBe(true);
  });

  it('does not invent defaults, unlike the draft schema', () => {
    const {description, ...withoutDescription} = event();
    expect(description).toBe('');
    expect(clubEventSchema.safeParse(withoutDescription).success).toBe(false);
  });
});

describe('upcomingEvents', () => {
  const from = new Date('2026-08-14T12:00:00.000Z');

  it('drops events that already started and sorts the rest', () => {
    const past = event({id: 'past', startsAt: '2026-08-10T18:00:00.000Z'});
    const soon = event({id: 'soon', startsAt: '2026-08-14T18:00:00.000Z'});
    const later = event({id: 'later', startsAt: '2026-08-20T18:00:00.000Z'});

    expect(upcomingEvents([later, past, soon], from).map((e) => e.id)).toEqual([
      'soon',
      'later',
    ]);
  });

  it('includes an event starting exactly now', () => {
    const now = event({id: 'now', startsAt: from.toISOString()});
    expect(upcomingEvents([now], from).map((e) => e.id)).toEqual(['now']);
  });

  it('does not mutate its input', () => {
    const events = [
      event({id: 'b', startsAt: '2026-08-20T18:00:00.000Z'}),
      event({id: 'a', startsAt: '2026-08-15T18:00:00.000Z'}),
    ];
    upcomingEvents(events, from);
    expect(events.map((e) => e.id)).toEqual(['b', 'a']);
  });
});

describe('byStartTime', () => {
  it('orders earliest first', () => {
    const early = event({startsAt: '2026-08-14T18:00:00.000Z'});
    const late = event({startsAt: '2026-08-20T18:00:00.000Z'});
    expect(byStartTime(early, late)).toBeLessThan(0);
    expect(byStartTime(late, early)).toBeGreaterThan(0);
    expect(byStartTime(early, early)).toBe(0);
  });
});

describe('groupEventsByDay', () => {
  it('keys by local calendar day and sorts within a day', () => {
    const morning = event({
      id: 'morning',
      startsAt: new Date(2026, 7, 14, 9, 0).toISOString(),
    });
    const evening = event({
      id: 'evening',
      startsAt: new Date(2026, 7, 14, 19, 0).toISOString(),
    });

    const byDay = groupEventsByDay([evening, morning]);
    expect(byDay.get('2026-08-14')?.map((e) => e.id)).toEqual([
      'morning',
      'evening',
    ]);
  });

  it('separates different days', () => {
    const day1 = event({startsAt: new Date(2026, 7, 14, 9, 0).toISOString()});
    const day2 = event({startsAt: new Date(2026, 7, 15, 9, 0).toISOString()});
    expect(groupEventsByDay([day1, day2]).size).toBe(2);
  });
});

describe('toLocalDayKey', () => {
  it('zero-pads month and day', () => {
    expect(toLocalDayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('uses local parts, so a late-evening event stays on its own day', () => {
    // 23:30 local is the next day in UTC for anyone behind it; the key must
    // not follow toISOString() here.
    expect(toLocalDayKey(new Date(2026, 7, 14, 23, 30))).toBe('2026-08-14');
  });
});
