/**
 * The demo club's calendar.
 *
 * This moved here from `apps/web/lib/seed-events.ts` when the dashboard
 * started reading events over the API. The web fixture was rebuilt in the
 * browser on every load; these are real rows, so the anchoring problem has to
 * be solved at seed time instead.
 *
 * Offsets are relative to the day the seed runs, never to a day of the month.
 * Anchoring to a day of the month means that late in the month every event is
 * already in the past, so "Up next" and the GroupMe draft render empty and the
 * product looks broken. Two events sit deliberately in the past so the
 * calendar shows history as well as what is coming.
 */

import type {StoredLink, StoredSpeaker} from './schema/event.js';

type Category = 'meeting' | 'social' | 'service' | 'workshop' | 'fundraiser';
type Visibility = 'members' | 'public';

interface EventSeed {
  /** Stable id so re-seeding updates a row rather than duplicating it. */
  id: string;
  /** Days from the day the seed runs. Negative is in the past. */
  dayOffset: number;
  /** Local start hour, 24h. */
  hour: number;
  durationHours: number;
  title: string;
  description: string;
  location: string;
  category: Category;
  visibility: Visibility;
  speaker?: StoredSpeaker;
  links?: StoredLink[];
}

const SEEDS: EventSeed[] = [
  {
    id: 'evt_seed_chapter_meeting',
    dayOffset: -9,
    hour: 18,
    durationHours: 1.5,
    title: 'Weekly Chapter Meeting',
    description:
      'Officer updates, upcoming event planning, and open floor for member questions. Pizza is provided.',
    location: 'Rogers Engineering 109',
    category: 'meeting',
    visibility: 'members',
  },
  {
    id: 'evt_seed_resume_workshop',
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
  },
  {
    id: 'evt_seed_tech_talk',
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
  },
  {
    id: 'evt_seed_service_morning',
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
  },
  {
    id: 'evt_seed_game_night',
    dayOffset: 12,
    hour: 18,
    durationHours: 3,
    title: 'Game Night + New Member Mixer',
    description:
      'Low-key social to welcome new members. Board games, Smash setup, and snacks.',
    location: 'SUB Den',
    category: 'social',
    visibility: 'public',
  },
  {
    id: 'evt_seed_bake_sale',
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
  },
];

export interface SeedEventRow {
  id: string;
  clubId: string;
  title: string;
  description: string;
  startsAt: Date;
  endsAt: Date;
  location: string;
  speaker: StoredSpeaker | null;
  links: StoredLink[];
  category: Category;
  visibility: Visibility;
  createdBy: string;
}

/** Builds the seeded rows, positioned relative to `now`. */
export function buildSeedEventRows(
  clubId: string,
  authorId: string,
  now: Date = new Date(),
): SeedEventRow[] {
  return SEEDS.map((seed) => {
    // Arithmetic on the day component: the Date constructor normalises
    // overflow, so +19 days from the 29th correctly rolls into next month.
    const startsAt = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + seed.dayOffset,
      seed.hour,
      0,
      0,
      0,
    );

    return {
      id: seed.id,
      clubId,
      title: seed.title,
      description: seed.description,
      startsAt,
      endsAt: new Date(startsAt.getTime() + seed.durationHours * 3_600_000),
      location: seed.location,
      speaker: seed.speaker ?? null,
      links: seed.links ?? [],
      category: seed.category,
      visibility: seed.visibility,
      createdBy: authorId,
    };
  });
}
