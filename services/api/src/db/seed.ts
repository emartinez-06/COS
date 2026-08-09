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
import {documentRevisions, documents} from './schema/document.js';
import {events} from './schema/event.js';
import {DOCUMENT_SEEDS} from './seed-documents.js';
import {buildSeedEventRows} from './seed-events.js';

/**
 * The demo club. The id no longer has to match anything on the web side: the
 * dashboard reads events over the API and gets the club id from the session,
 * so this is now just a fixed id that makes re-seeding idempotent.
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
    position: 'president' as const,
  },
  {
    email: 'treasurer@example.com',
    name: 'Jordan Treasurer',
    password: 'development-only-password',
    role: 'admin' as const,
    // A second officer with a different title and identical permissions. This
    // exists in the seed specifically so the "positions grant nothing" rule is
    // visible in the running app rather than only in a test.
    position: 'treasurer' as const,
  },
  {
    email: 'member@example.com',
    name: 'Sam Member',
    password: 'development-only-password',
    role: 'member' as const,
    position: null,
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

/**
 * Puts the demo calendar in place, attributed to the officer.
 *
 * Re-seeding *updates* rather than skipping, which is the one place this seed
 * is deliberately not "insert or ignore". The rows are positioned relative to
 * the day the seed runs, so a database seeded three weeks ago would otherwise
 * show a calendar where every event is in the past - which is exactly the
 * empty-looking dashboard this fixture exists to prevent.
 *
 * Only the seeded ids are touched, so events an officer created by hand are
 * left alone.
 */
async function seedEvents(authorId: string | undefined): Promise<void> {
  if (!authorId) {
    console.log('  no officer to attribute events to, skipping events');
    return;
  }

  const rows = buildSeedEventRows(CLUB.id, authorId);

  for (const row of rows) {
    await db
      .insert(events)
      .values(row)
      .onConflictDoUpdate({
        target: events.id,
        set: {
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          title: row.title,
          description: row.description,
          location: row.location,
          speaker: row.speaker,
          links: row.links,
          category: row.category,
          visibility: row.visibility,
        },
      });
  }

  console.log(`  ${rows.length} events ready, anchored to today`);
}

/**
 * Puts the demo document hub in place, attributed to the officer.
 *
 * Unlike events, these do not need re-anchoring to today - a constitution is
 * not stale because it was written last month - so this skips documents that
 * already exist rather than updating them. That also means an officer who
 * edited a seeded document in the dev app does not lose the edit on the next
 * `pnpm db:seed`.
 */
async function seedDocuments(authorId: string | undefined): Promise<void> {
  if (!authorId) {
    console.log('  no officer to attribute documents to, skipping documents');
    return;
  }

  let created = 0;

  for (const seed of DOCUMENT_SEEDS) {
    const bodies = [...(seed.priorContent ?? []), seed.content];
    const version = bodies.length;

    // The document and every one of its revisions land together, so a hub can
    // never contain a document whose current version has no body.
    const inserted = await db
      .insert(documents)
      .values({
        id: seed.id,
        clubId: CLUB.id,
        kind: 'text',
        section: seed.section,
        title: seed.title,
        summary: seed.summary,
        status: seed.status,
        version,
        createdBy: authorId,
        updatedBy: authorId,
      })
      .onConflictDoNothing({target: documents.id})
      .returning({id: documents.id});

    if (inserted.length === 0) {
      continue;
    }

    await db.insert(documentRevisions).values(
      bodies.map((content, index) => ({
        id: `rev_seed_${seed.id}_v${index + 1}`,
        documentId: seed.id,
        version: index + 1,
        content,
        authoredBy: authorId,
      })),
    );

    created += 1;
  }

  console.log(
    created === 0
      ? `  ${DOCUMENT_SEEDS.length} documents already present`
      : `  ${created} documents created`,
  );
}

async function main(): Promise<void> {
  /**
   * An allowlist, not a denylist, and the difference is the whole point.
   *
   * `NODE_ENV` defaults to `development`, so a denylist on `=== 'production'`
   * means the one operator who deploys without setting it seeds a public
   * database with credentials that are published in this repository - and the
   * officer account holds every capability. The failure mode of forgetting an
   * environment variable should be a refusal, not a wide-open club.
   *
   * `test` is included because the API suite is not hermetic by design and
   * runs against a real, seeded database.
   */
  if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') {
    throw new Error(
      `Refusing to seed: NODE_ENV is "${env.NODE_ENV}". ` +
        'This seed creates accounts whose passwords are public in the ' +
        'repository, so it only runs in development or test.',
    );
  }

  console.log('Seeding development data...');

  await db
    .insert(clubs)
    .values(CLUB)
    .onConflictDoNothing({target: clubs.id});
  console.log(`  club ${CLUB.slug} ready`);

  const userIdByEmail = new Map<string, string>();

  for (const person of PEOPLE) {
    const userId = await ensureUser(person);
    userIdByEmail.set(person.email, userId);
    await db
      .insert(clubMembers)
      .values({
        userId,
        clubId: CLUB.id,
        role: person.role,
        position: person.position,
      })
      // Position updates on re-seed, unlike the rest of the row. A database
      // seeded before positions existed would otherwise keep null titles
      // forever and the feature would look broken on an existing dev machine.
      .onConflictDoUpdate({
        target: [clubMembers.userId, clubMembers.clubId],
        set: {position: person.position},
      });
    console.log(
      `  ${person.email} is ${person.position ?? person.role} of ${CLUB.slug}`,
    );
  }

  await seedEvents(userIdByEmail.get('officer@example.com'));
  await seedDocuments(userIdByEmail.get('officer@example.com'));

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
