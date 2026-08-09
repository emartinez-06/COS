import {describe, expect, it} from 'vitest';

import {
  scoreMatch,
  searchPlaces,
  searchRecords,
  searchSite,
  type PlaceInput,
  type RecordInput,
} from './site-search';

const PLACES: PlaceInput[] = [
  {href: '/home', label: 'Dashboard', section: 'Overview', keywords: ['home']},
  {
    href: '/calendar',
    label: 'Calendar',
    section: 'Club',
    keywords: ['events', 'schedule'],
  },
  {
    href: '/documents',
    label: 'Documents',
    section: 'Club',
    keywords: ['bylaws'],
  },
  {
    href: '/expenses',
    label: 'Expenses',
    section: 'Treasury',
    keywords: ['money', 'budget'],
  },
];

const RECORDS: RecordInput[] = [
  {
    kind: 'event',
    id: 'e1',
    label: 'Spring Formal Fundraiser Bake Sale',
    href: '/calendar',
  },
  {kind: 'document', id: 'd1', label: 'Chapter Constitution', href: '/documents/d1'},
  {kind: 'request', id: 'r1', label: 'Pizza for the October meeting', href: '/expenses'},
];

describe('scoreMatch', () => {
  it('ranks exact above prefix above word-start above substring', () => {
    const exact = scoreMatch('calendar', 'Calendar');
    const prefix = scoreMatch('cal', 'Calendar');
    const wordStart = scoreMatch('sale', 'Bake Sale');
    const substring = scoreMatch('ale', 'Bake Sale');

    expect(exact).toBeGreaterThan(prefix!);
    expect(prefix).toBeGreaterThan(wordStart!);
    expect(wordStart).toBeGreaterThan(substring!);
  });

  it('is case insensitive', () => {
    expect(scoreMatch('CALENDAR', 'calendar')).toBe(1);
  });

  it('returns null when nothing matches', () => {
    expect(scoreMatch('zzz', 'Calendar')).toBeNull();
  });

  it('returns null for an empty query rather than matching everything', () => {
    expect(scoreMatch('   ', 'Calendar')).toBeNull();
  });

  it('scores a keyword hit below the same hit on the label', () => {
    const onLabel = scoreMatch('budget', 'Budget');
    const onKeyword = scoreMatch('budget', 'Expenses', ['budget']);

    expect(onKeyword).not.toBeNull();
    expect(onKeyword!).toBeLessThan(onLabel!);
  });

  /** A query containing regex metacharacters must not throw or match wildly. */
  it('treats the query as literal text', () => {
    expect(() => scoreMatch('c.l', 'Calendar')).not.toThrow();
    expect(scoreMatch('c.l', 'Calendar')).toBeNull();
  });
});

describe('searchPlaces', () => {
  it('finds a destination by its name', () => {
    const results = searchPlaces('calendar', PLACES);

    expect(results[0]?.label).toBe('Calendar');
    expect(results[0]?.href).toBe('/calendar');
    expect(results[0]?.tier).toBe('place');
  });

  it('finds a destination by a word nobody sees', () => {
    const results = searchPlaces('budget', PLACES);

    expect(results[0]?.label).toBe('Expenses');
  });

  it('carries the section so two similar labels stay distinguishable', () => {
    expect(searchPlaces('expenses', PLACES)[0]?.sublabel).toBe('Treasury');
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(searchPlaces('xylophone', PLACES)).toEqual([]);
  });
});

describe('searchRecords', () => {
  it('finds a record by a word in the middle of its title', () => {
    const results = searchRecords('bake', RECORDS);

    expect(results[0]?.label).toBe('Spring Formal Fundraiser Bake Sale');
    expect(results[0]?.tier).toBe('record');
  });

  it('groups a record by its kind', () => {
    expect(searchRecords('constitution', RECORDS)[0]?.group).toBe('Documents');
    expect(searchRecords('pizza', RECORDS)[0]?.group).toBe('Requests');
  });
});

describe('searchSite', () => {
  /**
   * The tier rule, and the reason it is a rule. "documents" matches the
   * Documents destination exactly and also appears inside record titles; the
   * destination has to win or navigating by search stops feeling reliable.
   */
  it('puts every place above every record', () => {
    const results = searchSite('doc', PLACES, [
      {kind: 'document', id: 'd9', label: 'doc', href: '/documents/d9'},
    ]);

    expect(results[0]?.tier).toBe('place');
    expect(results.at(-1)?.tier).toBe('record');
  });

  it('keeps a place first even when a record matches better', () => {
    // Exact record match versus a mere prefix match on the place.
    const results = searchSite('cal', PLACES, [
      {kind: 'event', id: 'e9', label: 'cal', href: '/calendar'},
    ]);

    expect(results[0]?.label).toBe('Calendar');
    expect(results[0]?.tier).toBe('place');
  });

  it('returns nothing for an empty query', () => {
    expect(searchSite('', PLACES, RECORDS)).toEqual([]);
    expect(searchSite('   ', PLACES, RECORDS)).toEqual([]);
  });

  it('caps the result list', () => {
    const many: RecordInput[] = Array.from({length: 40}, (_, i) => ({
      kind: 'event' as const,
      id: `e${i}`,
      label: `Meeting ${i}`,
      href: '/calendar',
    }));

    expect(searchSite('meeting', PLACES, many, 5)).toHaveLength(5);
  });

  it('gives every result a distinct key', () => {
    const results = searchSite('e', PLACES, RECORDS, 50);
    const keys = new Set(results.map((r) => r.key));

    expect(keys.size).toBe(results.length);
  });
});
