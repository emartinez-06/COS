/**
 * Session resolution and capability enforcement.
 *
 * This is where authorization stops being advisory. `can()` running in a
 * React component only decides whether to render a button; the check here is
 * the one that actually protects anything, and it is the reason the client
 * check is allowed to be optimistic.
 */

import type {Capability} from '@cos/core';
import {can} from '@cos/core';
import {createMiddleware} from 'hono/factory';
import {HTTPException} from 'hono/http-exception';

import {auth} from './auth.js';
import type {Membership} from './membership.js';
import {findMembership} from './membership.js';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  image?: string | null | undefined;
}

export interface AppVariables {
  user: AuthUser | null;
  membership: Membership | null;
}

export interface AppEnv {
  Variables: AppVariables;
}

/**
 * Resolves the session cookie into `c.var.user`, or null.
 *
 * Deliberately does not reject anonymous requests: public club pages are a
 * planned surface, so "who is this" and "may they" are separate steps.
 */
export const withSession = createMiddleware<AppEnv>(async (c, next) => {
  const session = await auth.api.getSession({headers: c.req.raw.headers});
  c.set('user', session?.user ?? null);
  c.set('membership', null);
  await next();
});

/** Rejects anonymous requests. Use after `withSession`. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.user) {
    throw new HTTPException(401, {message: 'Authentication required'});
  }
  await next();
});

/**
 * Requires that the caller hold `capability` in the club named by the
 * `clubId` route parameter.
 *
 * A non-member gets 404 rather than 403: whether a club exists is itself
 * information, and leaking it would let anyone enumerate clubs by id.
 */
export function requireCapability(capability: Capability) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.var.user;
    if (!user) {
      throw new HTTPException(401, {message: 'Authentication required'});
    }

    const clubId = c.req.param('clubId');
    if (!clubId) {
      throw new HTTPException(400, {message: 'Missing club id'});
    }

    const membership = await findMembership(user.id, clubId);
    if (!membership) {
      throw new HTTPException(404, {message: 'Club not found'});
    }

    if (!can(membership.role, capability)) {
      throw new HTTPException(403, {
        message: `Your role in this club may not ${capability}`,
      });
    }

    c.set('membership', membership);
    await next();
  });
}
