/**
 * Club roles and what each may do.
 *
 * Roles are per-club by design: a person belongs to many clubs and holds a
 * different role in each. Nothing here knows how a role is *proven* - that is
 * auth's job. This module only answers "given this role, is this action
 * allowed".
 *
 * Authorization deliberately lives here rather than in the auth library. A
 * pure function runs identically in a React component, an API handler, the
 * GroupMe bot, and a test with no database, and it means an identity library
 * can be replaced without touching the permission model.
 */

import {z} from 'zod';

/**
 * Every resource in the product and the actions that can be taken on it.
 *
 * This is plain data on purpose. It is the shape better-auth's access control
 * expects for a statement, so an `ac` instance can be built from it in
 * `services/api` without `packages/core` ever importing better-auth.
 */
export const STATEMENT = {
  event: ['create', 'edit', 'delete', 'view'],
  announcement: ['draft'],
  expense: ['create', 'edit', 'delete', 'view'],
  member: ['invite', 'remove', 'view'],
  document: ['create', 'edit', 'delete', 'view'],
  canvas: ['create', 'edit', 'delete', 'view'],
} as const satisfies Record<string, readonly string[]>;

/** A resource the product gates access to. */
export type Resource = keyof typeof STATEMENT;

/** The actions available on one resource. */
export type Action<R extends Resource> = (typeof STATEMENT)[R][number];

/**
 * A single permission, as `resource:action`.
 *
 * Derived from STATEMENT rather than hand-written, so adding an action to the
 * statement makes every role map a compile error until it is accounted for.
 */
export type Capability = {
  [R in Resource]: `${R}:${Action<R>}`;
}[Resource];

/** Every capability the statement defines, flattened. */
export const ALL_CAPABILITIES: readonly Capability[] = Object.entries(
  STATEMENT,
).flatMap(([resource, actions]) =>
  actions.map((action) => `${resource}:${action}` as Capability),
);

export const capabilitySchema = z.enum(
  ALL_CAPABILITIES as [Capability, ...Capability[]],
);

export const roleSchema = z.enum(['admin', 'member']);

/** A person's role within one club. `admin` is club leadership. */
export type Role = z.infer<typeof roleSchema>;

/**
 * What each role may do.
 *
 * Grants are listed explicitly rather than derived (admin is *not* "everything
 * in STATEMENT") so that adding a resource never silently widens anyone's
 * access. Adding an action to STATEMENT surfaces here as a decision to make.
 */
const CAPABILITIES: Record<Role, readonly Capability[]> = {
  admin: [
    'event:create',
    'event:edit',
    'event:delete',
    'event:view',
    'announcement:draft',
    // The treasury is officer-only in full. A member sees no expense at all,
    // not even read-only: a club's spending is not something the whole roster
    // browses, and `expense:view` is what gates the navigation section.
    'expense:create',
    'expense:edit',
    'expense:delete',
    'expense:view',
    // Inviting is an officer capability, not a presidential one. A club whose
    // president has gone quiet still needs its treasurer able to add a member,
    // and tying this to a position would be the one place a title starts
    // granting something - see the position doc below.
    'member:invite',
    'member:remove',
    'member:view',
    // The document hub is the opposite of the treasury: everyone reads, only
    // officers write. The club's rules and onboarding material are worthless if
    // the people they govern cannot see them, while letting any member rewrite
    // the bylaws would make them nobody's.
    'document:create',
    'document:edit',
    'document:delete',
    'document:view',
    // The canvas is officer-only, including read - same shape as the
    // treasury. It's a planning space for the people running the club, not
    // a club-wide whiteboard.
    'canvas:create',
    'canvas:edit',
    'canvas:delete',
    'canvas:view',
  ],
  // A member sees the roster. Knowing who else is in your own club is not
  // privileged information, and it is what makes the club feel like a club.
  //
  // `document:view` is what puts the hub in their sidebar. It shows published
  // documents only - see `canSeeDraftDocuments`, which keys draft visibility to
  // `document:edit` rather than maintaining a second list.
  member: ['event:view', 'member:view', 'document:view'],
};

/** True when `role` is permitted to perform `capability`. */
export function can(role: Role, capability: Capability): boolean {
  return CAPABILITIES[role].includes(capability);
}

/** Every capability held by `role`. Useful for shipping a session to a client. */
export function capabilitiesFor(role: Role): readonly Capability[] {
  return CAPABILITIES[role];
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Officer',
  member: 'Member',
};

/**
 * An officer's position within the club.
 *
 * **A position confers no authority.** It is a title, not a permission: every
 * officer can do everything an officer can do, and `can()` does not take a
 * position at all. Treasurer and Marketing Director see the same treasury.
 *
 * This is separate from `Role` on purpose, and the separation is the whole
 * point. Modelling positions as roles would mean every new position needs its
 * own capability grant copied from the last one, and the failure mode of
 * forgetting is an officer who is silently locked out of their own club. Here
 * the failure mode of forgetting is a missing job title.
 *
 * What positions are actually for: telling members who to ask. "Who do I send
 * a receipt to" is answered by the title, not by the permission set.
 */
export const positionSchema = z.enum([
  'president',
  'vice_president',
  'treasurer',
  'marketing_director',
]);

/** A named officer position. Descriptive only - see `positionSchema`. */
export type Position = z.infer<typeof positionSchema>;

export const POSITION_LABELS: Record<Position, string> = {
  president: 'President',
  vice_president: 'Vice President',
  treasurer: 'Treasurer',
  marketing_director: 'Marketing Director',
};

/** Every position, in the order a club would list its officers. */
export const ALL_POSITIONS: readonly Position[] = positionSchema.options;

/**
 * What to call this person on screen.
 *
 * Prefers the specific title over the generic one, so an officer reads as
 * "Treasurer" rather than "Officer" once a position is set. Falls back to the
 * role, which is what every member without a position gets.
 */
export function memberTitle(
  role: Role,
  position?: Position | null,
): string {
  return position ? POSITION_LABELS[position] : ROLE_LABELS[role];
}
