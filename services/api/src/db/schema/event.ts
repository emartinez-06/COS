/**
 * Club events: the persisted form of `ClubEvent` in @cos/core.
 *
 * Instants are stored as `timestamptz`. Core represents them as ISO 8601
 * strings with an offset, so the repository converts at the boundary rather
 * than leaking `Date` into the domain.
 *
 * `speaker` and `links` are jsonb because they are value objects owned
 * entirely by the event. Neither is queried across events, and giving them
 * their own tables would buy joins we would never use.
 */

import {relations} from 'drizzle-orm';
import {index, jsonb, pgEnum, pgTable, text, timestamp} from 'drizzle-orm/pg-core';

import {user} from './auth.js';
import {clubs} from './club.js';

/** Mirrors `eventCategorySchema` in @cos/core. */
export const eventCategory = pgEnum('event_category', [
  'meeting',
  'social',
  'service',
  'workshop',
  'fundraiser',
]);

/** Mirrors `eventVisibilitySchema` in @cos/core. */
export const eventVisibility = pgEnum('event_visibility', [
  'members',
  'public',
]);

export interface StoredSpeaker {
  name: string;
  title?: string;
  affiliation?: string;
}

export interface StoredLink {
  label: string;
  url: string;
}

export const events = pgTable(
  'events',
  {
    id: text('id').primaryKey(),
    clubId: text('club_id')
      .notNull()
      .references(() => clubs.id, {onDelete: 'cascade'}),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    startsAt: timestamp('starts_at', {withTimezone: true}).notNull(),
    endsAt: timestamp('ends_at', {withTimezone: true}).notNull(),
    location: text('location').notNull().default(''),
    speaker: jsonb('speaker').$type<StoredSpeaker | null>(),
    links: jsonb('links').$type<StoredLink[]>().notNull().default([]),
    category: eventCategory('category').notNull().default('meeting'),
    visibility: eventVisibility('visibility').notNull().default('members'),
    /**
     * Who created it. A real foreign key rather than the display name core
     * carries, so attribution survives a rename. The name is joined on read.
     *
     * `set null` rather than `cascade`: deleting a person must not delete the
     * club's history of what happened.
     */
    createdBy: text('created_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', {withTimezone: true})
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true})
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Every read is "this club's events, in time order", so the composite
    // index serves both the filter and the sort.
    index('events_club_starts_idx').on(table.clubId, table.startsAt),
  ],
);

export const eventsRelations = relations(events, ({one}) => ({
  club: one(clubs, {fields: [events.clubId], references: [clubs.id]}),
  author: one(user, {fields: [events.createdBy], references: [user.id]}),
}));
