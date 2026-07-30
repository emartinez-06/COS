/**
 * Clubs and membership: ours, deliberately not better-auth's organization
 * plugin.
 *
 * That plugin tracks a single `activeOrganizationId` per session, which is the
 * workspace-switcher shape. The product is a student in four clubs looking at
 * one merged calendar, so membership is queried as a set rather than switched
 * between. See docs/ARCHITECTURE.md, "The member model is person-first".
 *
 * The cost of owning these tables is that invitations, member removal, and
 * role changes are ours to write.
 */

import {relations} from 'drizzle-orm';
import {
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import {user} from './auth.js';

/**
 * Mirrors `Role` in @cos/core. Postgres needs its own enum type, but core
 * stays the source of truth for what a role *means* - this only constrains
 * what may be stored.
 */
export const clubRole = pgEnum('club_role', ['admin', 'member']);

export const clubs = pgTable(
  'clubs',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** URL-safe identifier for public club pages. */
    slug: text('slug').notNull(),
    description: text('description').notNull().default(''),
    createdAt: timestamp('created_at', {withTimezone: true})
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true})
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('clubs_slug_idx').on(table.slug)],
);

export const clubMembers = pgTable(
  'club_members',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, {onDelete: 'cascade'}),
    clubId: text('club_id')
      .notNull()
      .references(() => clubs.id, {onDelete: 'cascade'}),
    role: clubRole('role').notNull().default('member'),
    joinedAt: timestamp('joined_at', {withTimezone: true})
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // A person holds exactly one role per club, so the pair is the identity of
    // the row. This makes a duplicate membership impossible at the database
    // level rather than only in application code.
    primaryKey({columns: [table.userId, table.clubId]}),
    // Every authorization check is "what is this user's role in this club",
    // and every listing is "which clubs does this user belong to".
    index('club_members_user_idx').on(table.userId),
    index('club_members_club_idx').on(table.clubId),
  ],
);

export const clubsRelations = relations(clubs, ({many}) => ({
  members: many(clubMembers),
}));

export const clubMembersRelations = relations(clubMembers, ({one}) => ({
  club: one(clubs, {
    fields: [clubMembers.clubId],
    references: [clubs.id],
  }),
  user: one(user, {
    fields: [clubMembers.userId],
    references: [user.id],
  }),
}));
