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

import {relations, sql} from 'drizzle-orm';
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

/**
 * Mirrors `Position` in @cos/core.
 *
 * Deliberately a different column from `role`, not a widening of it. A
 * position is a job title and grants nothing; `role` remains the only input to
 * an authorization decision. Storing them together would make every new
 * officer title a permissions change.
 */
export const clubPosition = pgEnum('club_position', [
  'president',
  'vice_president',
  'treasurer',
  'marketing_director',
]);

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
    /**
     * The officer's title, or null. Nullable because most members hold no
     * position and because an officer without a title is a normal state, not a
     * broken row - the club simply has not said which job they do.
     */
    position: clubPosition('position'),
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

/** Mirrors `InvitationStatus` in @cos/core. */
export const invitationStatus = pgEnum('invitation_status', [
  'pending',
  'accepted',
  'declined',
  'revoked',
]);

/**
 * Invitations, addressed to an email rather than to a user.
 *
 * That is the point: the person being invited may not have an account yet, so
 * this cannot be a foreign key to `user`. It resolves to a person only when
 * someone signs in with that address and accepts.
 */
export const clubInvitations = pgTable(
  'club_invitations',
  {
    id: text('id').primaryKey(),
    clubId: text('club_id')
      .notNull()
      .references(() => clubs.id, {onDelete: 'cascade'}),
    /** Always stored lowercase - @cos/core normalises before it gets here. */
    email: text('email').notNull(),
    role: clubRole('role').notNull().default('member'),
    position: clubPosition('position'),
    status: invitationStatus('status').notNull().default('pending'),
    /**
     * Who sent it. `set null` rather than cascade: an invitation should
     * outlive the officer who sent it, since revoking it is the club's
     * decision and not a side effect of that person leaving.
     */
    invitedBy: text('invited_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', {withTimezone: true})
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', {withTimezone: true}).notNull(),
  },
  (table) => [
    // The recipient's query is "what is pending for my address", across every
    // club, so email leads.
    index('club_invitations_email_idx').on(table.email),
    index('club_invitations_club_idx').on(table.clubId),
    // One live invitation per address per club. Partial, so a declined
    // invitation does not block the club from trying again later - which is an
    // ordinary thing to want after someone changes their mind.
    uniqueIndex('club_invitations_pending_idx')
      .on(table.clubId, table.email)
      .where(sql`${table.status} = 'pending'`),
  ],
);

export const clubsRelations = relations(clubs, ({many}) => ({
  members: many(clubMembers),
  invitations: many(clubInvitations),
}));

export const clubInvitationsRelations = relations(
  clubInvitations,
  ({one}) => ({
    club: one(clubs, {
      fields: [clubInvitations.clubId],
      references: [clubs.id],
    }),
    invitedByUser: one(user, {
      fields: [clubInvitations.invitedBy],
      references: [user.id],
    }),
  }),
);

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
