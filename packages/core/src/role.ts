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
  ],
  member: ['event:view'],
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
