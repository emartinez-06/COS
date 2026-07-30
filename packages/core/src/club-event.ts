/**
 * The club event domain model.
 *
 * This is the shape the calendar renders, the API will persist, and the GroupMe
 * bot reads to draft announcements. It lives in packages/core precisely because
 * all three consumers must agree on it.
 *
 * Instants are stored as ISO 8601 strings with an offset, never as `Date`.
 * A `Date` crossing a JSON boundary silently becomes a string anyway, and
 * keeping one representation end to end avoids a class of timezone bugs.
 */

import {z} from 'zod';

/** An ISO 8601 instant, e.g. `2026-08-14T18:00:00.000Z`. */
export const isoInstantSchema = z
  .string()
  .datetime({offset: true})
  .describe('ISO 8601 instant');

export const speakerSchema = z.object({
  name: z.string().min(1, 'Speaker name is required'),
  /** Role or job title, e.g. "VP of Engineering". */
  title: z.string().optional(),
  /** Company, department, or affiliation. */
  affiliation: z.string().optional(),
});

export type Speaker = z.infer<typeof speakerSchema>;

export const eventLinkSchema = z.object({
  /** Human label; what the member actually sees and clicks. */
  label: z.string().min(1, 'Link label is required'),
  url: z.string().url('Must be a valid URL'),
});

export type EventLink = z.infer<typeof eventLinkSchema>;

/**
 * Event categories. These drive the colour of a chip in the calendar, so the
 * list is deliberately short - more than a handful stops being scannable.
 */
export const eventCategorySchema = z.enum([
  'meeting',
  'social',
  'service',
  'workshop',
  'fundraiser',
]);

export type EventCategory = z.infer<typeof eventCategorySchema>;

/** Who can see the event. Public events are the ones a club page may expose. */
export const eventVisibilitySchema = z.enum(['members', 'public']);

export type EventVisibility = z.infer<typeof eventVisibilitySchema>;

/**
 * The fields an officer fills in. Everything server-owned (id, timestamps,
 * author) is absent - that is the difference between a draft and an event.
 */
export const eventDraftSchema = z
  .object({
    title: z.string().min(1, 'Title is required').max(120),
    description: z.string().max(2000).default(''),
    startsAt: isoInstantSchema,
    endsAt: isoInstantSchema,
    location: z.string().max(200).default(''),
    speaker: speakerSchema.nullable().default(null),
    links: z.array(eventLinkSchema).max(10).default([]),
    category: eventCategorySchema.default('meeting'),
    visibility: eventVisibilitySchema.default('members'),
  })
  .refine((event) => new Date(event.endsAt) > new Date(event.startsAt), {
    message: 'End time must be after the start time',
    path: ['endsAt'],
  });

export type EventDraft = z.infer<typeof eventDraftSchema>;

/** A persisted event. */
export const clubEventSchema = z.object({
  id: z.string().min(1),
  clubId: z.string().min(1),
  title: z.string().min(1).max(120),
  description: z.string().max(2000),
  startsAt: isoInstantSchema,
  endsAt: isoInstantSchema,
  location: z.string().max(200),
  speaker: speakerSchema.nullable(),
  links: z.array(eventLinkSchema).max(10),
  category: eventCategorySchema,
  visibility: eventVisibilitySchema,
  createdAt: isoInstantSchema,
  updatedAt: isoInstantSchema,
  /** Display name of the officer who created it. Not an identity claim. */
  createdBy: z.string().min(1),
});

export type ClubEvent = z.infer<typeof clubEventSchema>;

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  meeting: 'Meeting',
  social: 'Social',
  service: 'Service',
  workshop: 'Workshop',
  fundraiser: 'Fundraiser',
};

/**
 * Category to Astryx colour name. Kept here rather than in the web app so the
 * bot and any future client label an event the same way the calendar does.
 */
export const CATEGORY_COLORS: Record<EventCategory, string> = {
  meeting: 'blue',
  social: 'purple',
  service: 'green',
  workshop: 'teal',
  fundraiser: 'orange',
};

/** Chronological comparator, earliest first. Use with `[...events].sort()`. */
export function byStartTime(a: ClubEvent, b: ClubEvent): number {
  return Date.parse(a.startsAt) - Date.parse(b.startsAt);
}

/**
 * Events starting at or after `from`, earliest first.
 * `from` defaults to now, which is what both the member agenda and the bot want.
 */
export function upcomingEvents(
  events: readonly ClubEvent[],
  from: Date = new Date(),
): ClubEvent[] {
  const cutoff = from.getTime();
  return events
    .filter((event) => Date.parse(event.startsAt) >= cutoff)
    .sort(byStartTime);
}

/**
 * Groups events by local calendar day, keyed `YYYY-MM-DD`.
 *
 * The key is derived from local date parts rather than `toISOString()` so an
 * evening event does not jump to the next day for users behind UTC.
 */
export function groupEventsByDay(
  events: readonly ClubEvent[],
): Map<string, ClubEvent[]> {
  const byDay = new Map<string, ClubEvent[]>();
  for (const event of [...events].sort(byStartTime)) {
    const key = toLocalDayKey(new Date(event.startsAt));
    const bucket = byDay.get(key);
    if (bucket) {
      bucket.push(event);
    } else {
      byDay.set(key, [event]);
    }
  }
  return byDay;
}

/** `YYYY-MM-DD` for a date's *local* calendar day. */
export function toLocalDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
