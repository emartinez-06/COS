/**
 * Development seed: one club, one officer, one member.
 *
 * Users are created through better-auth's own sign-up API rather than by
 * inserting rows. Inserting directly would mean hashing the password
 * ourselves and guessing at the account/user split, which is exactly the kind
 * of duplicated knowledge that rots on an upgrade.
 *
 * Safe to run more than once: everything is keyed on a fixed id or email and
 * skipped if already present. Refuses to run in production.
 */

import {eq} from 'drizzle-orm';

import {auth} from '../auth/auth.js';
import {env} from '../env.js';
import {closeDatabase, db} from './client.js';
import {clubMembers, clubs} from './schema/club.js';
import {user} from './schema/auth.js';

/**
 * Deliberately matches `DEMO_CLUB_ID` in apps/web/lib/seed-events.ts.
 *
 * The dashboard still reads events from an in-memory repository keyed by club
 * id, so a mismatch here renders an empty calendar for a club that plainly has
 * events. This alignment becomes unnecessary the moment events are persisted
 * through the API, and the web-side fixture goes away with it.
 */
const CLUB = {
  id: 'club_baylor_acm',
  name: 'Baylor ACM',
  slug: 'baylor-acm',
  description: 'The demo club used during development.',
};

const PEOPLE = [
  {
    email: 'officer@example.com',
    name: 'Avery Officer',
    password: 'development-only-password',
    role: 'admin' as const,
  },
  {
    email: 'member@example.com',
    name: 'Sam Member',
    password: 'development-only-password',
    role: 'member' as const,
  },
];

async function ensureUser(person: (typeof PEOPLE)[number]): Promise<string> {
  const [existing] = await db
    .select({id: user.id})
    .from(user)
    .where(eq(user.email, person.email))
    .limit(1);

  if (existing) {
    console.log(`  user ${person.email} already exists`);
    return existing.id;
  }

  const result = await auth.api.signUpEmail({
    body: {
      email: person.email,
      name: person.name,
      password: person.password,
    },
  });

  console.log(`  created ${person.email}`);
  return result.user.id;
}

async function main(): Promise<void> {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed a production database.');
  }

  console.log('Seeding development data...');

  await db
    .insert(clubs)
    .values(CLUB)
    .onConflictDoNothing({target: clubs.id});
  console.log(`  club ${CLUB.slug} ready`);

  for (const person of PEOPLE) {
    const userId = await ensureUser(person);
    await db
      .insert(clubMembers)
      .values({userId, clubId: CLUB.id, role: person.role})
      .onConflictDoNothing({
        target: [clubMembers.userId, clubMembers.clubId],
      });
    console.log(`  ${person.email} is ${person.role} of ${CLUB.slug}`);
  }

  console.log('\nSign in with:');
  for (const person of PEOPLE) {
    console.log(`  ${person.email} / ${person.password}  (${person.role})`);
  }
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
