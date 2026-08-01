/**
 * Tests for the HTTP DocumentRepository.
 *
 * Weighted toward the two things this repository does that the event one never
 * had to: carry bytes, and lose a race.
 *
 * The bytes half is not ceremony. `apiFetch` declares `Content-Type:
 * application/json` on every request, and a multipart body whose content type
 * says JSON is unparseable by the server - the boundary that separates its
 * parts is missing. That is a silent, total failure of every upload in the
 * product, so it is pinned here rather than left to be discovered against a
 * running API.
 *
 * The race half is the version counter, which only means something if a stale
 * save is actually refused. The fake models the counter for real, so these
 * tests fail if the 409 stops being translated into a
 * `DocumentVersionConflictError` carrying the version the document is at.
 */

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {DocumentVersionConflictError} from '@cos/core';

import {ApiError} from './api-error';
import {HttpDocumentRepository} from './http-document-repository';
import {
  FakeDocumentApi,
  makeStoredDocument,
  resetDocumentFixtures,
} from './test-support/fake-document-api';

const CLUB = 'club_demo';

let api: FakeDocumentApi;
let repository: HttpDocumentRepository;

beforeEach(() => {
  resetDocumentFixtures();
  api = new FakeDocumentApi();
  vi.stubGlobal('fetch', api.handle);
  repository = new HttpDocumentRepository();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function pdf(name = 'constitution.pdf'): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, {
    type: 'application/pdf',
  });
}

describe('reading', () => {
  it('lists a club’s documents with the session cookie attached', async () => {
    api.add(CLUB, makeStoredDocument({title: 'Bylaws'}));

    const documents = await repository.list(CLUB);

    expect(documents.map((doc) => doc.title)).toEqual(['Bylaws']);
    expect(api.calls[0]).toMatchObject({
      method: 'GET',
      path: `/api/clubs/${CLUB}/documents`,
      credentials: 'include',
    });
  });

  it('never carries a body in a listing', async () => {
    api.add(CLUB, makeStoredDocument({content: 'A very long constitution.'}));

    const [document] = await repository.list(CLUB);

    // The port has nowhere to put content on a `ClubDocument`, and this is the
    // over-the-wire half of that guarantee.
    expect(document).not.toHaveProperty('content');
  });

  it('answers null for a document that is not here', async () => {
    expect(await repository.get(CLUB, 'doc_missing')).toBeNull();
  });

  it('throws rather than answering null when the read was refused', async () => {
    api.add(CLUB, makeStoredDocument());
    api.failEveryRequest(403);

    // A 403 rendered as "no such document" would tell a member the club has
    // nothing on file when the truth is that they may not read it.
    await expect(repository.get(CLUB, 'doc_1')).rejects.toBeInstanceOf(ApiError);
  });

  it('returns the body on a single document', async () => {
    api.add(CLUB, makeStoredDocument({id: 'doc_1', content: 'Article I.'}));

    const document = await repository.get(CLUB, 'doc_1');

    expect(document?.content).toBe('Article I.');
  });
});

describe('creating', () => {
  it('sends a text document as JSON', async () => {
    const created = await repository.create(CLUB, {
      kind: 'text',
      title: 'Bylaws',
      summary: '',
      section: 'rules',
      status: 'draft',
      content: '# Article I',
    });

    expect(created.kind).toBe('text');
    expect(created.content).toBe('# Article I');
    expect(api.calls[0]?.headers['Content-Type']).toBe('application/json');
  });

  it('sends an uploaded document as multipart, without declaring JSON', async () => {
    const created = await repository.create(
      CLUB,
      {
        kind: 'file',
        title: 'Signed constitution',
        summary: '',
        section: 'rules',
        status: 'published',
      },
      pdf(),
    );

    expect(created.file).toEqual({
      name: 'constitution.pdf',
      contentType: 'application/pdf',
      byteSize: 4,
    });

    const call = api.calls[0];
    expect(call?.body).toBeInstanceOf(FormData);
    // The regression this file exists for: declaring a content type here sends
    // a multipart body with no boundary, which no server can parse.
    expect(call?.headers['Content-Type']).toBeUndefined();
  });

  it('keeps the file’s own name rather than inventing one', async () => {
    // Deliberately *not* a browser `File`. `FileBytes` is a structural type -
    // core cannot name `Blob` without assuming a browser - so anything with
    // size, type, and arrayBuffer satisfies the port, and only a `File`
    // carries a name of its own. This is the case where passing the name to
    // `FormData.append` is load-bearing: without it the part arrives as
    // "blob", which is then the name every member sees on the download.
    const bytes: {
      size: number;
      type: string;
      name: string;
      arrayBuffer: () => Promise<ArrayBuffer>;
    } = {
      size: 4,
      type: 'application/pdf',
      name: '2026-charter.pdf',
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    };

    await repository.create(
      CLUB,
      {
        kind: 'file',
        title: 'Signed constitution',
        summary: '',
        section: 'rules',
        status: 'published',
      },
      bytes,
    );

    const form = api.calls[0]?.body as FormData;
    expect((form.get('file') as File).name).toBe('2026-charter.pdf');
  });

  it('sends a browser File under its own name too', async () => {
    await repository.create(
      CLUB,
      {
        kind: 'file',
        title: 'Signed constitution',
        summary: '',
        section: 'rules',
        status: 'published',
      },
      pdf('signed-2026.pdf'),
    );

    const form = api.calls[0]?.body as FormData;
    expect((form.get('file') as File).name).toBe('signed-2026.pdf');
  });

  it('refuses to quietly drop a file handed to a text draft', async () => {
    await expect(
      repository.create(
        CLUB,
        {
          kind: 'text',
          title: 'Notes',
          summary: '',
          section: 'meeting_notes',
          status: 'draft',
          content: '',
        },
        pdf(),
      ),
    ).rejects.toThrow(/cannot carry a file/);
  });
});

describe('editing', () => {
  it('saves a content change and moves the version on', async () => {
    api.add(CLUB, makeStoredDocument({id: 'doc_1', version: 1}));

    const updated = await repository.update(CLUB, 'doc_1', {
      content: 'Revised.',
      expectedVersion: 1,
    });

    expect(updated.content).toBe('Revised.');
    expect(updated.version).toBe(2);
  });

  it('raises a conflict naming both versions when someone else saved first', async () => {
    api.add(CLUB, makeStoredDocument({id: 'doc_1', version: 1}));
    api.someoneElseSaves(CLUB, 'doc_1', 'Their text.');

    const thrown = await repository
      .update(CLUB, 'doc_1', {content: 'My text.', expectedVersion: 1})
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(DocumentVersionConflictError);
    const conflict = thrown as DocumentVersionConflictError;
    // Both numbers matter: one is what the editor was on, the other is what to
    // offer to reload. A conflict that could not say which is which would be
    // an error message, not a recovery path.
    expect(conflict.expectedVersion).toBe(1);
    expect(conflict.currentVersion).toBe(2);
  });

  it('leaves the stored document untouched when a save is refused', async () => {
    api.add(CLUB, makeStoredDocument({id: 'doc_1', version: 1}));
    api.someoneElseSaves(CLUB, 'doc_1', 'Their text.');

    await repository
      .update(CLUB, 'doc_1', {content: 'My text.', expectedVersion: 1})
      .catch(() => undefined);

    expect(api.find(CLUB, 'doc_1')?.content).toBe('Their text.');
  });

  it('does not need a version for a metadata-only change', async () => {
    api.add(CLUB, makeStoredDocument({id: 'doc_1', version: 3}));

    const updated = await repository.update(CLUB, 'doc_1', {
      section: 'rules',
      title: 'Bylaws',
    });

    // Renaming must not invalidate someone else's in-progress edit, so it does
    // not move the version.
    expect(updated.version).toBe(3);
    expect(updated.section).toBe('rules');
  });

  it('removes a document without choking on the empty 204 body', async () => {
    api.add(CLUB, makeStoredDocument({id: 'doc_1'}));

    await expect(repository.remove(CLUB, 'doc_1')).resolves.toBeUndefined();
    expect(api.find(CLUB, 'doc_1')).toBeUndefined();
  });
});

describe('files', () => {
  it('downloads the current bytes', async () => {
    api.add(
      CLUB,
      makeStoredDocument({
        id: 'doc_1',
        kind: 'file',
        content: null,
        file: {name: 'a.pdf', contentType: 'application/pdf', byteSize: 4},
        bytes: new Uint8Array([9, 8, 7, 6]),
      }),
    );

    const bytes = await repository.download(CLUB, 'doc_1');

    expect(new Uint8Array(await bytes.arrayBuffer())).toEqual(
      new Uint8Array([9, 8, 7, 6]),
    );
  });

  it('asks for a past revision by version', async () => {
    api.add(
      CLUB,
      makeStoredDocument({
        id: 'doc_1',
        kind: 'file',
        content: null,
        bytes: new Uint8Array([1]),
      }),
    );

    await repository.download(CLUB, 'doc_1', 2);

    expect(api.calls.at(-1)?.path).toBe(
      `/api/clubs/${CLUB}/documents/doc_1/file`,
    );
    // The version travels as a query parameter, which the path above drops.
    expect(api.calls.at(-1)?.method).toBe('GET');
  });

  it('replaces the bytes as a new revision, carrying the version it saw', async () => {
    api.add(
      CLUB,
      makeStoredDocument({
        id: 'doc_1',
        kind: 'file',
        content: null,
        version: 2,
        bytes: new Uint8Array([1]),
      }),
    );

    const updated = await repository.replaceFile(
      CLUB,
      'doc_1',
      pdf('newer.pdf'),
      2,
    );

    expect(updated.version).toBe(3);
    expect(updated.file?.name).toBe('newer.pdf');
    const form = api.calls.at(-1)?.body as FormData;
    expect(form.get('expectedVersion')).toBe('2');
    expect(api.calls.at(-1)?.headers['Content-Type']).toBeUndefined();
  });

  it('raises a conflict when someone else uploaded first', async () => {
    api.add(
      CLUB,
      makeStoredDocument({
        id: 'doc_1',
        kind: 'file',
        content: null,
        version: 5,
        bytes: new Uint8Array([1]),
      }),
    );

    const thrown = await repository
      .replaceFile(CLUB, 'doc_1', pdf(), 4)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(DocumentVersionConflictError);
    expect((thrown as DocumentVersionConflictError).currentVersion).toBe(5);
  });
});

describe('history', () => {
  it('lists revisions newest first, without bodies', async () => {
    api.add(CLUB, makeStoredDocument({id: 'doc_1', version: 1}));
    api.someoneElseSaves(CLUB, 'doc_1', 'Second.');

    const revisions = await repository.revisions(CLUB, 'doc_1');

    expect(revisions.map((r) => r.version)).toEqual([2, 1]);
    expect(revisions[0]).not.toHaveProperty('content');
  });

  it('fetches one past revision with its text', async () => {
    api.add(CLUB, makeStoredDocument({id: 'doc_1'}));

    const revision = await repository.revision(CLUB, 'doc_1', 1);

    expect(revision?.content).toBe('content of v1');
  });

  it('answers null for a revision that does not exist', async () => {
    api.add(CLUB, makeStoredDocument({id: 'doc_1'}));

    expect(await repository.revision(CLUB, 'doc_1', 99)).toBeNull();
  });
});
