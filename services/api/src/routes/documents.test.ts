/**
 * Integration tests for the document hub.
 *
 * Against real Postgres and real object storage, for the same reason the event
 * tests use a real database: the things under test are a role lookup, a
 * conditional UPDATE that depends on Postgres' locking, and a round trip
 * through an S3 API. Mocking any of those would test the mock.
 *
 * Requires `docker compose up -d` (Postgres and MinIO) and a migrated
 * database.
 */

import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {and, eq} from 'drizzle-orm';

import {app} from '../app.js';
import {auth} from '../auth/auth.js';
import {closeDatabase, db} from '../db/client.js';
import {user} from '../db/schema/auth.js';
import {clubMembers, clubs} from '../db/schema/club.js';
import {documentRevisions, documents} from '../db/schema/document.js';
import {documentStorageKey, getObject} from '../storage/object-store.js';

const ORIGIN = 'http://localhost:3100';
const PASSWORD = 'test-only-password-1234';

const CLUB_ID = 'club_test_docs';
const OTHER_CLUB_ID = 'club_test_docs_other';

interface Actor {
  userId: string;
  cookie: string;
}

async function createActor(email: string, name: string): Promise<Actor> {
  const existing = await db
    .select({id: user.id})
    .from(user)
    .where(eq(user.email, email))
    .limit(1);

  if (existing.length === 0) {
    await auth.api.signUpEmail({body: {email, name, password: PASSWORD}});
  }

  const response = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Origin: ORIGIN},
    body: JSON.stringify({email, password: PASSWORD}),
  });

  expect(response.status, `sign-in for ${email}`).toBe(200);

  const cookie = (response.headers.getSetCookie?.() ?? [])
    .map((value) => value.split(';')[0])
    .join('; ');

  const [row] = await db
    .select({id: user.id})
    .from(user)
    .where(eq(user.email, email))
    .limit(1);

  if (!row) {
    throw new Error(`No user row for ${email}`);
  }

  return {userId: row.id, cookie};
}

/** A JSON request. */
async function request(
  path: string,
  actor: Actor | null,
  init: RequestInit = {},
): Promise<Response> {
  return app.request(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      ...(actor ? {Cookie: actor.cookie} : {}),
      ...init.headers,
    },
  });
}

/**
 * A multipart upload.
 *
 * Content-Type is deliberately left unset so the runtime generates it with the
 * boundary; setting it by hand produces a body the server cannot parse.
 */
async function upload(
  path: string,
  actor: Actor | null,
  form: FormData,
  method: 'POST' | 'PUT' = 'POST',
): Promise<Response> {
  return app.request(path, {
    method,
    body: form,
    headers: {
      Origin: ORIGIN,
      ...(actor ? {Cookie: actor.cookie} : {}),
    },
  });
}

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x01, 0x02]);
const REPLACEMENT_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xff]);

function fileForm(
  fields: Record<string, string>,
  bytes: Uint8Array = PDF_BYTES,
  name = 'bylaws.pdf',
  type = 'application/pdf',
): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }
  form.set('file', new File([bytes], name, {type}));
  return form;
}

let officer: Actor;
let member: Actor;
let outsider: Actor;

/** A published text document, recreated fresh for the suites that mutate it. */
async function createPublishedText(title: string, content = 'Article I.') {
  const response = await request(`/api/clubs/${CLUB_ID}/documents`, officer, {
    method: 'POST',
    body: JSON.stringify({
      title,
      content,
      section: 'rules',
      status: 'published',
    }),
  });
  expect(response.status, `create ${title}`).toBe(201);
  return (await response.json()) as {id: string; version: number};
}

beforeAll(async () => {
  await db
    .insert(clubs)
    .values([
      {id: CLUB_ID, name: 'Docs Test Club', slug: 'docs-test-club'},
      {id: OTHER_CLUB_ID, name: 'Other Docs Club', slug: 'docs-other-club'},
    ])
    .onConflictDoNothing();

  officer = await createActor('docs-officer@example.com', 'Dana Officer');
  member = await createActor('docs-member@example.com', 'Morgan Member');
  outsider = await createActor('docs-outsider@example.com', 'Outer Person');

  await db
    .insert(clubMembers)
    .values([
      {userId: officer.userId, clubId: CLUB_ID, role: 'admin'},
      {userId: member.userId, clubId: CLUB_ID, role: 'member'},
      {userId: outsider.userId, clubId: OTHER_CLUB_ID, role: 'admin'},
    ])
    .onConflictDoNothing();

  // A clean hub: earlier runs of this file leave documents behind.
  await db.delete(documents).where(eq(documents.clubId, CLUB_ID));
});

afterAll(async () => {
  await db.delete(documents).where(eq(documents.clubId, CLUB_ID));
  await db.delete(clubs).where(eq(clubs.id, CLUB_ID));
  await db.delete(clubs).where(eq(clubs.id, OTHER_CLUB_ID));
  await closeDatabase();
});

describe('anonymous callers', () => {
  it('cannot list documents', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/documents`, null);
    expect(response.status).toBe(401);
  });

  it('cannot create a document', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/documents`, null, {
      method: 'POST',
      body: JSON.stringify({title: 'Sneaky'}),
    });
    expect(response.status).toBe(401);
  });

  it('cannot upload a file', async () => {
    const response = await upload(
      `/api/clubs/${CLUB_ID}/documents`,
      null,
      fileForm({title: 'Sneaky'}),
    );
    expect(response.status).toBe(401);
  });
});

describe('authoring a text document', () => {
  let created: {id: string; version: number};

  it('creates it at version 1, attributed to the session', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/documents`, officer, {
      method: 'POST',
      body: JSON.stringify({
        title: '  Constitution  ',
        summary: 'How this club works',
        section: 'rules',
        status: 'published',
        content: 'Article I. The club exists.',
      }),
    });

    expect(response.status).toBe(201);
    created = (await response.json()) as typeof created;

    const body = created as unknown as Record<string, unknown>;
    expect(body['title']).toBe('Constitution');
    expect(body['kind']).toBe('text');
    expect(body['version']).toBe(1);
    expect(body['content']).toBe('Article I. The club exists.');
    expect(body['file']).toBeNull();
    // Attribution comes from the session, never the body.
    expect(body['createdBy']).toBe('Dana Officer');
    expect(body['updatedBy']).toBe('Dana Officer');
  });

  it('writes a first revision holding the content', async () => {
    const rows = await db
      .select()
      .from(documentRevisions)
      .where(eq(documentRevisions.documentId, created.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.version).toBe(1);
    expect(rows[0]?.content).toBe('Article I. The club exists.');
    expect(rows[0]?.storageKey).toBeNull();
  });

  it('returns the content when the document is read directly', async () => {
    const response = await request(
      `/api/clubs/${CLUB_ID}/documents/${created.id}`,
      member,
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as {content: string}).content).toBe(
      'Article I. The club exists.',
    );
  });

  it('never includes a body in a listing', async () => {
    // The scaling invariant, checked over the wire rather than in the schema:
    // a hub listing must not transfer document bodies.
    const response = await request(`/api/clubs/${CLUB_ID}/documents`, officer);
    expect(response.status).toBe(200);

    const list = (await response.json()) as Record<string, unknown>[];
    expect(list.length).toBeGreaterThan(0);
    for (const document of list) {
      expect(document).not.toHaveProperty('content');
    }
  });

  it('refuses a document with no title', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/documents`, officer, {
      method: 'POST',
      body: JSON.stringify({title: '   '}),
    });
    expect(response.status).toBe(400);
  });
});

describe('editing, and two officers editing at once', () => {
  let doc: {id: string; version: number};

  beforeAll(async () => {
    doc = await createPublishedText('Editing Target', 'first');
  });

  it('does not bump the version for a metadata-only change', async () => {
    // The version is the concurrency token for *content*. If a rename
    // invalidated an in-progress edit, people would learn to ignore the
    // conflict message.
    const response = await request(
      `/api/clubs/${CLUB_ID}/documents/${doc.id}`,
      officer,
      {method: 'PATCH', body: JSON.stringify({section: 'onboarding'})},
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {version: number; section: string};
    expect(body.section).toBe('onboarding');
    expect(body.version).toBe(1);
  });

  it('bumps the version and writes a revision for a content change', async () => {
    const response = await request(
      `/api/clubs/${CLUB_ID}/documents/${doc.id}`,
      officer,
      {
        method: 'PATCH',
        body: JSON.stringify({content: 'second', expectedVersion: 1}),
      },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {version: number; content: string};
    expect(body.version).toBe(2);
    expect(body.content).toBe('second');

    const rows = await db
      .select()
      .from(documentRevisions)
      .where(eq(documentRevisions.documentId, doc.id));
    expect(rows).toHaveLength(2);
  });

  it('refuses a second save based on a version that has moved on', async () => {
    // The whole point of the feature: an officer who loaded version 1, went to
    // a meeting, and saved after someone else already saved must not silently
    // erase that person's work.
    const response = await request(
      `/api/clubs/${CLUB_ID}/documents/${doc.id}`,
      officer,
      {
        method: 'PATCH',
        body: JSON.stringify({content: 'stale write', expectedVersion: 1}),
      },
    );

    expect(response.status).toBe(409);
    expect(((await response.json()) as {currentVersion: number}).currentVersion).toBe(2);
  });

  it('leaves the newer content intact after a refused write', async () => {
    const response = await request(
      `/api/clubs/${CLUB_ID}/documents/${doc.id}`,
      officer,
    );
    expect(((await response.json()) as {content: string}).content).toBe('second');
  });

  it('refuses a content change that does not say which version it edited', async () => {
    const response = await request(
      `/api/clubs/${CLUB_ID}/documents/${doc.id}`,
      officer,
      {method: 'PATCH', body: JSON.stringify({content: 'no version'})},
    );
    expect(response.status).toBe(400);
  });

  it('lets exactly one of two simultaneous saves win', async () => {
    // Both read version 2 and both save. Postgres serialises them on the row
    // lock, so the second re-evaluates `version = 2` against the committed
    // value and matches nothing.
    const [first, second] = await Promise.all([
      request(`/api/clubs/${CLUB_ID}/documents/${doc.id}`, officer, {
        method: 'PATCH',
        body: JSON.stringify({content: 'racer A', expectedVersion: 2}),
      }),
      request(`/api/clubs/${CLUB_ID}/documents/${doc.id}`, officer, {
        method: 'PATCH',
        body: JSON.stringify({content: 'racer B', expectedVersion: 2}),
      }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);

    // And the loser left nothing behind: exactly one new revision.
    const rows = await db
      .select()
      .from(documentRevisions)
      .where(eq(documentRevisions.documentId, doc.id));
    expect(rows).toHaveLength(3);
  });
});

describe('history', () => {
  let doc: {id: string; version: number};

  beforeAll(async () => {
    doc = await createPublishedText('History Target', 'version one text');
    await request(`/api/clubs/${CLUB_ID}/documents/${doc.id}`, officer, {
      method: 'PATCH',
      body: JSON.stringify({content: 'version two', expectedVersion: 1}),
    });
  });

  it('lists revisions newest first, without bodies', async () => {
    const response = await request(
      `/api/clubs/${CLUB_ID}/documents/${doc.id}/revisions`,
      member,
    );
    expect(response.status).toBe(200);

    const revisions = (await response.json()) as Record<string, unknown>[];
    expect(revisions).toHaveLength(2);
    expect(revisions[0]?.['version']).toBe(2);
    expect(revisions[1]?.['version']).toBe(1);
    expect(revisions[0]?.['authoredBy']).toBe('Dana Officer');
    // Length, not content: history must not fetch every body to render.
    expect(revisions[0]?.['charCount']).toBe('version two'.length);
    expect(revisions[0]?.['file']).toBeNull();
    for (const revision of revisions) {
      expect(revision).not.toHaveProperty('content');
    }
  });

  it('serves the text a past revision held', async () => {
    const response = await request(
      `/api/clubs/${CLUB_ID}/documents/${doc.id}/revisions/1`,
      member,
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as {content: string}).content).toBe(
      'version one text',
    );
  });

  it('404s a revision that does not exist', async () => {
    const response = await request(
      `/api/clubs/${CLUB_ID}/documents/${doc.id}/revisions/99`,
      member,
    );
    expect(response.status).toBe(404);
  });
});

describe('uploading a file document', () => {
  let doc: {id: string; version: number};

  it('stores the bytes and the file metadata', async () => {
    const response = await upload(
      `/api/clubs/${CLUB_ID}/documents`,
      officer,
      fileForm({
        title: 'Signed Bylaws',
        section: 'rules',
        status: 'published',
      }),
    );

    expect(response.status).toBe(201);
    doc = (await response.json()) as typeof doc;

    const body = doc as unknown as Record<string, unknown>;
    expect(body['kind']).toBe('file');
    expect(body['content']).toBeNull();
    expect(body['file']).toEqual({
      name: 'bylaws.pdf',
      contentType: 'application/pdf',
      byteSize: PDF_BYTES.byteLength,
    });
  });

  it('downloads exactly the bytes that were uploaded', async () => {
    const response = await request(
      `/api/clubs/${CLUB_ID}/documents/${doc.id}/file`,
      member,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toContain(
      'attachment; filename="bylaws.pdf"',
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF_BYTES);
  });

  it('refuses a content type that is not on the allowlist', async () => {
    const response = await upload(
      `/api/clubs/${CLUB_ID}/documents`,
      officer,
      fileForm(
        {title: 'Not a document'},
        new Uint8Array([1, 2, 3]),
        'payload.html',
        'text/html',
      ),
    );
    expect(response.status).toBe(400);
  });

  it('refuses an empty file', async () => {
    const response = await upload(
      `/api/clubs/${CLUB_ID}/documents`,
      officer,
      fileForm({title: 'Empty'}, new Uint8Array([]), 'empty.pdf'),
    );
    expect(response.status).toBe(400);
  });

  it('replaces the bytes as a new revision', async () => {
    const form = fileForm(
      {expectedVersion: '1'},
      REPLACEMENT_BYTES,
      'bylaws-v2.pdf',
    );
    const response = await upload(
      `/api/clubs/${CLUB_ID}/documents/${doc.id}/file`,
      officer,
      form,
      'PUT',
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body['version']).toBe(2);
    expect((body['file'] as {name: string}).name).toBe('bylaws-v2.pdf');
  });

  it('still serves the original bytes at version 1, because storage is append-only', async () => {
    // The reason each revision gets its own storage key: replacing a file must
    // not overwrite the file it replaces.
    const response = await request(
      `/api/clubs/${CLUB_ID}/documents/${doc.id}/file?version=1`,
      member,
    );

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF_BYTES);
  });

  it('serves the replacement at the current version', async () => {
    const response = await request(
      `/api/clubs/${CLUB_ID}/documents/${doc.id}/file`,
      member,
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      REPLACEMENT_BYTES,
    );
  });

  it('refuses a replacement based on a stale version', async () => {
    const response = await upload(
      `/api/clubs/${CLUB_ID}/documents/${doc.id}/file`,
      officer,
      fileForm({expectedVersion: '1'}, REPLACEMENT_BYTES),
      'PUT',
    );
    expect(response.status).toBe(409);
  });

  it('does not upload bytes for a replacement it is going to refuse', async () => {
    // The version is checked twice, and this pins the reason the *first* check
    // exists. The check inside the transaction closes the race window; this
    // one runs before `putObject` so a doomed replacement never writes an
    // object nothing will ever reference. Without it the refused upload above
    // still lands bytes at the next version's key and leaks them forever.
    const orphanKey = documentStorageKey(CLUB_ID, doc.id, 3);
    expect(await getObject(orphanKey)).toBeNull();
  });

  it('refuses text sent to a file document rather than discarding it', async () => {
    const response = await request(
      `/api/clubs/${CLUB_ID}/documents/${doc.id}`,
      officer,
      {
        method: 'PATCH',
        body: JSON.stringify({content: 'typed into a PDF', expectedVersion: 2}),
      },
    );
    expect(response.status).toBe(400);
  });

  it('accepts a metadata change on a file document', async () => {
    const response = await request(
      `/api/clubs/${CLUB_ID}/documents/${doc.id}`,
      officer,
      {method: 'PATCH', body: JSON.stringify({summary: 'The signed copy'})},
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as {summary: string}).summary).toBe(
      'The signed copy',
    );
  });

  it('refuses to serve a file document as a text revision', async () => {
    const response = await request(
      `/api/clubs/${CLUB_ID}/documents/${doc.id}/revisions/1`,
      member,
    );
    expect(response.status).toBe(409);
  });

  it('records both file revisions in history', async () => {
    const response = await request(
      `/api/clubs/${CLUB_ID}/documents/${doc.id}/revisions`,
      officer,
    );
    const revisions = (await response.json()) as Record<string, unknown>[];

    expect(revisions).toHaveLength(2);
    expect(revisions[0]?.['charCount']).toBeNull();
    expect((revisions[0]?.['file'] as {name: string}).name).toBe(
      'bylaws-v2.pdf',
    );
  });
});

describe('drafts', () => {
  let draftDoc: {id: string};

  beforeAll(async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/documents`, officer, {
      method: 'POST',
      body: JSON.stringify({
        title: 'Unfinished Minutes',
        section: 'meeting_notes',
        content: 'we discussed',
      }),
    });
    draftDoc = (await response.json()) as typeof draftDoc;
  });

  it('is what a new document defaults to', async () => {
    const response = await request(
      `/api/clubs/${CLUB_ID}/documents/${draftDoc.id}`,
      officer,
    );
    expect(((await response.json()) as {status: string}).status).toBe('draft');
  });

  it('is visible to an officer, who could edit it', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/documents`, officer);
    const titles = ((await response.json()) as {title: string}[]).map(
      (d) => d.title,
    );
    expect(titles).toContain('Unfinished Minutes');
  });

  it('is hidden from a member in the listing', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/documents`, member);
    const titles = ((await response.json()) as {title: string}[]).map(
      (d) => d.title,
    );
    expect(titles).not.toContain('Unfinished Minutes');
    // But published documents still reach them.
    expect(titles).toContain('Constitution');
  });

  it('404s for a member who guesses its id directly', async () => {
    const response = await request(
      `/api/clubs/${CLUB_ID}/documents/${draftDoc.id}`,
      member,
    );
    expect(response.status).toBe(404);
  });

  it('hides its history from a member too', async () => {
    const response = await request(
      `/api/clubs/${CLUB_ID}/documents/${draftDoc.id}/revisions`,
      member,
    );
    expect(response.status).toBe(404);
  });

  it('reaches the whole club once it is published', async () => {
    const published = await request(
      `/api/clubs/${CLUB_ID}/documents/${draftDoc.id}`,
      officer,
      {method: 'PATCH', body: JSON.stringify({status: 'published'})},
    );
    expect(published.status).toBe(200);

    const response = await request(
      `/api/clubs/${CLUB_ID}/documents/${draftDoc.id}`,
      member,
    );
    expect(response.status).toBe(200);
  });
});

describe('a member', () => {
  let doc: {id: string; version: number};

  beforeAll(async () => {
    doc = await createPublishedText('Member Cannot Touch This', 'original');
  });

  it('may read the hub, which is the capability they hold', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/documents`, member);
    expect(response.status).toBe(200);
    expect(Array.isArray(await response.json())).toBe(true);
  });

  it('is refused when authoring a document, bypassing the UI entirely', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/documents`, member, {
      method: 'POST',
      body: JSON.stringify({title: 'Member Rules'}),
    });
    expect(response.status).toBe(403);
  });

  it('is refused when uploading a file', async () => {
    const response = await upload(
      `/api/clubs/${CLUB_ID}/documents`,
      member,
      fileForm({title: 'Member Upload'}),
    );
    expect(response.status).toBe(403);
  });

  it('is refused when editing', async () => {
    const response = await request(
      `/api/clubs/${CLUB_ID}/documents/${doc.id}`,
      member,
      {
        method: 'PATCH',
        body: JSON.stringify({content: 'rewritten', expectedVersion: 1}),
      },
    );
    expect(response.status).toBe(403);
  });

  it('is refused when deleting', async () => {
    const response = await request(
      `/api/clubs/${CLUB_ID}/documents/${doc.id}`,
      member,
      {method: 'DELETE'},
    );
    expect(response.status).toBe(403);
  });

  it('leaves no trace: the document is untouched and still at version 1', async () => {
    const [row] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, doc.id));

    expect(row?.version).toBe(1);
    expect(row?.deletedAt).toBeNull();
    expect(row?.title).toBe('Member Cannot Touch This');
  });
});

describe('deleting', () => {
  let doc: {id: string; version: number};

  beforeAll(async () => {
    doc = await createPublishedText('Doomed Document', 'delete me');
  });

  it('removes it from the hub', async () => {
    const response = await request(
      `/api/clubs/${CLUB_ID}/documents/${doc.id}`,
      officer,
      {method: 'DELETE'},
    );
    expect(response.status).toBe(204);

    const listing = await request(`/api/clubs/${CLUB_ID}/documents`, officer);
    const titles = ((await listing.json()) as {title: string}[]).map(
      (d) => d.title,
    );
    expect(titles).not.toContain('Doomed Document');
  });

  it('404s the deleted document, for an officer as well as a member', async () => {
    for (const actor of [officer, member]) {
      const response = await request(
        `/api/clubs/${CLUB_ID}/documents/${doc.id}`,
        actor,
      );
      expect(response.status).toBe(404);
    }
  });

  it('404s a second delete, so a client cannot believe it removed something twice', async () => {
    const response = await request(
      `/api/clubs/${CLUB_ID}/documents/${doc.id}`,
      officer,
      {method: 'DELETE'},
    );
    expect(response.status).toBe(404);
  });

  it('keeps the row and its history, because this is a soft delete', async () => {
    const [row] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, doc.id));
    expect(row?.deletedAt).not.toBeNull();

    const revisions = await db
      .select()
      .from(documentRevisions)
      .where(eq(documentRevisions.documentId, doc.id));
    expect(revisions.length).toBeGreaterThan(0);
  });
});

describe('a signed-in user who is not a member of this club', () => {
  it('gets 404 listing, so club ids cannot be enumerated', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/documents`, outsider);
    expect(response.status).toBe(404);
  });

  it('gets 404 creating, for the same reason', async () => {
    const response = await request(`/api/clubs/${CLUB_ID}/documents`, outsider, {
      method: 'POST',
      body: JSON.stringify({title: 'Trespass'}),
    });
    expect(response.status).toBe(404);
  });

  it('cannot reach this club document through their own club path', async () => {
    const doc = await createPublishedText('Cross Club Target');

    const response = await request(
      `/api/clubs/${OTHER_CLUB_ID}/documents/${doc.id}`,
      outsider,
    );
    // Authorized in their own club, but the document belongs to another one.
    expect(response.status).toBe(404);
  });

  it('cannot download a file through their own club path', async () => {
    const created = await upload(
      `/api/clubs/${CLUB_ID}/documents`,
      officer,
      fileForm({title: 'Cross Club File', status: 'published'}),
    );
    const doc = (await created.json()) as {id: string};

    const response = await request(
      `/api/clubs/${OTHER_CLUB_ID}/documents/${doc.id}/file`,
      outsider,
    );
    expect(response.status).toBe(404);
  });
});

describe('tenancy', () => {
  it('scopes every document row to its club', async () => {
    const rows = await db
      .select({id: documents.id})
      .from(documents)
      .where(
        and(eq(documents.clubId, CLUB_ID), eq(documents.kind, 'text')),
      );

    // Sanity check that the suite actually wrote through the club-scoped path
    // rather than leaving rows attached to nothing.
    expect(rows.length).toBeGreaterThan(0);
  });
});
