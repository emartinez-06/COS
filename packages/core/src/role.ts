/**
 * Club roles and what each may do.
 *
 * Roles are per-club by design: a person belongs to many clubs and holds a
 * different role in each (see docs/OPEN-QUESTIONS.md, "Who is the account
 * holder"). Nothing here knows how a role is *proven* - that is auth's job.
 * This module only answers "given this role, is this action allowed".
 */

import {z} from 'zod';

export const roleSchema = z.enum(['admin', 'member']);

/** A person's role within one club. `admin` is club leadership. */
export type Role = z.infer<typeof roleSchema>;

/**
 * Every capability the event surface gates on.
 * Keeping these named rather than checking `role === 'admin'` inline means a
 * third role (advisor, alumni) only has to be described here once.
 */
export type Capability =
  | 'event:create'
  | 'event:edit'
  | 'event:delete'
  | 'event:view'
  | 'announcement:draft';

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

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Officer',
  member: 'Member',
};
