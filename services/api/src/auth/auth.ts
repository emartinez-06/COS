/**
 * The better-auth instance.
 *
 * Scope is deliberately narrow: users, credentials, and sessions. Nothing
 * here knows what a club is or what a role may do. Authorization is
 * `can(role, capability)` in @cos/core, and membership lives in our own
 * tables - see docs/ARCHITECTURE.md, "Identity and authorization are separate
 * systems".
 *
 * The organization plugin is intentionally not enabled.
 */

import {betterAuth} from 'better-auth';
import {drizzleAdapter} from 'better-auth/adapters/drizzle';

import {db} from '../db/client.js';
import {account, session, user, verification} from '../db/schema/auth.js';
import {env, isProduction} from '../env.js';

export const auth = betterAuth({
  appName: 'COS',

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {user, session, account, verification},
  }),

  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  basePath: '/api/auth',

  // The web app runs on a different port in development, so it has to be
  // named explicitly or better-auth rejects its callbacks as cross-origin.
  trustedOrigins: env.WEB_ORIGINS,

  emailAndPassword: {
    enabled: true,
    // No verification gate yet: there is no transactional email provider
    // wired up, and a gate with nothing behind it locks everyone out.
    // See BACKLOG - this flips on with the email provider.
    requireEmailVerification: false,
    // Longer than the common 8. Officers hold the keys to a club's roster and
    // eventually its ledger, and length is the only knob that reliably helps.
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    // Sliding window: an active member is not logged out mid-semester, but an
    // abandoned session still ages out.
    updateAge: 60 * 60 * 24, // refresh at most once a day
    cookieCache: {
      // Avoids a database read on every request while keeping revocation
      // meaningful - a revoked session goes dead within the minute.
      enabled: true,
      maxAge: 60,
    },
  },

  advanced: {
    // Cross-site cookies need Secure, and Secure needs HTTPS. In development
    // the web app and the API are both on localhost, which browsers treat as
    // same-site, so Lax works and does not require a TLS certificate.
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: isProduction ? 'none' : 'lax',
      secure: isProduction,
    },
  },
});

/** The session shape better-auth hands back, for typing middleware. */
export type AuthSession = typeof auth.$Infer.Session;
