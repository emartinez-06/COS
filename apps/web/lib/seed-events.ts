/**
 * Seed data for the phase-1 dashboard.
 *
 * Offsets are relative to *today*, not to a day of the month. Anchoring to a
 * day of the month means that late in the month every seeded event is already
 * in the past, which makes "Up next" and the GroupMe draft render empty and
 * look broken. A couple of events sit in the past deliberately so the calendar
 * shows history as well as what is coming.
 *
 * Built by a function of `now` (not a module constant) because it is generated
 * on the client after hydration - see the mount gate in the calendar view.
 */

import type {ClubEvent, EventCategory, EventVisibility} from '@cos/core';

export const DEMO_CLUB_ID = 'club_baylor_acm';
export const DEMO_CLUB_NAME = 'Baylor ACM';

interface SeedSpec {
  /** Days from today. Negative is in the past. */
  dayOffset: number;
  /** Local start hour, 24h. */
  hour: number;
  durationHours: number;
  title: string;
  description: string;
  location: string;
  category: EventCategory;
  visibility: EventVisibility;
  speaker?: {name: string; title?: string; affiliation?: string};
  links?: {label: string; url: string}[];
  createdBy: string;
}

const SEEDS: SeedSpec[] = [
  {
    dayOffset: -9,
    hour: 18,
    durationHours: 1.5,
    title: 'Weekly Chapter Meeting',
    description:
      'Officer updates, upcoming event planning, and open floor for member questions. Pizza is provided.',
    location: 'Rogers Engineering 109',
    category: 'meeting',
    visibility: 'members',
    createdBy: 'Erick Martinez',
  },
  {
    dayOffset: -2,
    hour: 17,
    durationHours: 2,
    title: 'Resume Workshop with Career Center',
    description:
      'Bring a printed copy of your resume for live review. Career Center staff will walk through formatting for technical roles and answer questions about internship applications.',
    location: 'Foster 240',
    category: 'workshop',
    visibility: 'public',
    speaker: {
      name: 'Dana Whitfield',
      title: 'Associate Director',
      affiliation: 'Baylor Career Center',
    },
    links: [
      {
        label: 'Resume template',
        url: 'https://example.com/acm-resume-template.pdf',
      },
    ],
    createdBy: 'Erick Martinez',
  },
  {
    dayOffset: 2,
    hour: 19,
    durationHours: 2,
    title: 'Tech Talk: Scaling Real-Time Systems',
    description:
      'How a small team runs a real-time messaging backend at scale. Covers WebSocket fan-out, backpressure, and the operational side of keeping connections alive.',
    location: 'Cashion 200',
    category: 'meeting',
    visibility: 'public',
    speaker: {
      name: 'Priya Raghavan',
      title: 'Staff Engineer',
      affiliation: 'Datadog',
    },
    links: [
      {label: 'RSVP', url: 'https://example.com/acm-tech-talk-rsvp'},
      {label: 'Slides (posted after)', url: 'https://example.com/acm-slides'},
    ],
    createdBy: 'Erick Martinez',
  },
  {
    dayOffset: 5,
    hour: 10,
    durationHours: 4,
    title: 'Waco Community Service Morning',
    description:
      'Volunteering with Mission Waco. Wear closed-toe shoes. Transportation leaves from the SUB at 9:30am sharp.',
    location: 'Mission Waco, 1315 N 15th St',
    category: 'service',
    visibility: 'members',
    links: [
      {label: 'Sign-up sheet', url: 'https://example.com/acm-service-signup'},
    ],
    createdBy: 'Amara Osei',
  },
  {
    dayOffset: 12,
    hour: 18,
    durationHours: 3,
    title: 'Game Night + New Member Mixer',
    description:
      'Low-key social to welcome new members. Board games, Smash setup, and snacks.',
    location: 'SUB Den',
    category: 'social',
    visibility: 'public',
    createdBy: 'Amara Osei',
  },
  {
    dayOffset: 19,
    hour: 12,
    durationHours: 5,
    title: 'Spring Formal Fundraiser Bake Sale',
    description:
      'Proceeds fund the spring formal. Volunteers needed in two-hour shifts; sign up in the sheet below.',
    location: 'Fountain Mall',
    category: 'fundraiser',
    visibility: 'public',
    links: [
      {label: 'Volunteer shifts', url: 'https://example.com/acm-bake-sale'},
    ],
    createdBy: 'Amara Osei',
  },
];

/** Builds the seeded event list, positioned relative to `now`. */
export function buildSeedEvents(now: Date = new Date()): ClubEvent[] {
  const createdAt = now.toISOString();

  return SEEDS.map((spec, index) => {
    // Date arithmetic on the day component: the Date constructor normalises
    // overflow, so +19 days from the 29th correctly rolls into next month.
    const start = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + spec.dayOffset,
      spec.hour,
      0,
      0,
      0,
    );
    const end = new Date(start.getTime() + spec.durationHours * 3600_000);

    return {
      id: `seed_${index + 1}`,
      clubId: DEMO_CLUB_ID,
      title: spec.title,
      description: spec.description,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      location: spec.location,
      speaker: spec.speaker ?? null,
      links: spec.links ?? [],
      category: spec.category,
      visibility: spec.visibility,
      createdAt,
      updatedAt: createdAt,
      createdBy: spec.createdBy,
    };
  });
}
