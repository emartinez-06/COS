/**
 * A stand-in for the document routes in services/api, installed over `fetch`.
 *
 * Separate from `fake-api.ts` rather than bolted onto it: that one models a
 * club's event list and this one models documents, revisions, and a version
 * counter, and a single fake pretending to be both would be harder to read than
 * either.
 *
 * Same principle as the other fake, though, and it is the important one:
 * `fetch` is what gets replaced, never `apiFetch`. That keeps URL
 * construction, `credentials: 'include'`, the missing content type on a
 * multipart body, and the 204-has-no-body path inside the system under test.
 *
 * The version counter is modelled for real - a PATCH carrying a stale
 * `expectedVersion` gets a 409 with the version actually stored - because
 * losing that race is the behaviour the repository and the editor exist to
 * handle, and a fake that always said yes would leave it untested.
 */

import type {
  ClubDocument,
  ClubDocumentDetail,
  DocumentRevision,
} from '@cos/core';

import {API_URL} from '../auth-client';

export interface RecordedCall {
  method: string;
  path: string;
  /** Parsed JSON, the `FormData` itself, or undefined. */
  body: unknown;
  credentials: RequestCredentials | undefined;
  headers: Record<string, string>;
}

/** What the fake stores: the listing shape plus the body and the history. */
interface StoredDocument extends ClubDocumentDetail {
  revisions: DocumentRevision[];
  bytes: Uint8Array | null;
}

export class FakeDocumentApi {
  readonly calls: RecordedCall[] = [];

  readonly #byClub = new Map<string, StoredDocument[]>();
  #nextId = 1;
  #status: number | null = null;

  // --- arranging ----------------------------------------------------------

  /** Seeds a document without recording a call. */
  add(clubId: string, document: StoredDocument): StoredDocument {
    this.#byClub.set(clubId, [...this.documentsOf(clubId), document]);
    return document;
  }

  documentsOf(clubId: string): StoredDocument[] {
    return this.#byClub.get(clubId) ?? [];
  }

  find(clubId: string, documentId: string): StoredDocument | undefined {
    return this.documentsOf(clubId).find((doc) => doc.id === documentId);
  }

  /**
   * Another officer saves, moving the document on without this browser
   * knowing. The next stale save is the conflict case.
   */
  someoneElseSaves(clubId: string, documentId: string, content: string): void {
    const document = this.find(clubId, documentId);
    if (!document) {
      throw new Error(`No document ${documentId}`);
    }
    document.content = content;
    document.version += 1;
    document.updatedBy = 'Someone Else';
    document.revisions = [
      makeRevision({
        documentId,
        version: document.version,
        authoredBy: 'Someone Else',
        charCount: content.length,
      }),
      ...document.revisions,
    ];
  }

  /** Every request answers this status until `recover()`. */
  failEveryRequest(status: number): void {
    this.#status = status;
  }

  recover(): void {
    this.#status = null;
  }

  // --- asserting ----------------------------------------------------------

  callsTo(method: string): RecordedCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  get getCount(): number {
    return this.callsTo('GET').length;
  }

  clearCalls(): void {
    this.calls.length = 0;
  }

  // --- the handler --------------------------------------------------------

  readonly handle = async (
    input: string | URL | Request,
    init: RequestInit = {},
  ): Promise<Response> => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();

    this.calls.push({
      method,
      path: url.pathname,
      body:
        typeof init.body === 'string'
          ? (JSON.parse(init.body) as unknown)
          : init.body,
      credentials: init.credentials,
      headers: {...((init.headers ?? {}) as Record<string, string>)},
    });

    if (this.#status !== null) {
      return json({error: `Request failed with ${this.#status}`}, this.#status);
    }

    return this.#route(method, url, init.body);
  };

  async #route(
    method: string,
    url: URL,
    body: BodyInit | null | undefined,
  ): Promise<Response> {
    const match =
      /^\/api\/clubs\/([^/]+)\/documents(?:\/([^/]+))?(?:\/(file|revisions))?(?:\/(\d+))?$/.exec(
        url.pathname,
      );
    if (!match) {
      return json({error: 'Not found'}, 404);
    }

    const clubId = decodeURIComponent(match[1]!);
    const documentId = match[2] ? decodeURIComponent(match[2]) : null;
    const sub = match[3] ?? null;
    const version = match[4] ? Number(match[4]) : null;

    if (!documentId) {
      if (method === 'GET') {
        return json(this.documentsOf(clubId).map(toListing), 200);
      }
      if (method === 'POST') {
        return json(await this.#create(clubId, body), 201);
      }
      return json({error: 'Method not allowed'}, 405);
    }

    const document = this.find(clubId, documentId);
    if (!document) {
      return json({error: 'Document not found'}, 404);
    }

    if (sub === 'revisions') {
      if (version !== null) {
        const revision = document.revisions.find((r) => r.version === version);
        if (!revision) {
          return json({error: 'Revision not found'}, 404);
        }
        return json({...revision, content: `content of v${version}`}, 200);
      }
      return json(document.revisions, 200);
    }

    if (sub === 'file') {
      if (method === 'GET') {
        if (!document.bytes) {
          return json({error: 'File not found'}, 404);
        }
        return new Response(document.bytes as unknown as ArrayBuffer, {
          status: 200,
          headers: {'Content-Type': document.file?.contentType ?? 'text/plain'},
        });
      }
      if (method === 'PUT') {
        return this.#replaceFile(document, body);
      }
      return json({error: 'Method not allowed'}, 405);
    }

    if (method === 'GET') {
      return json(toDetail(document), 200);
    }

    if (method === 'PATCH') {
      return this.#patch(document, JSON.parse(String(body)) as PatchBody);
    }

    if (method === 'DELETE') {
      this.#byClub.set(
        clubId,
        this.documentsOf(clubId).filter((doc) => doc.id !== documentId),
      );
      // 204 with no body at all: calling .json() on this throws, which is the
      // case `expectBody = false` exists for.
      return new Response(null, {status: 204});
    }

    return json({error: 'Method not allowed'}, 405);
  }

  async #create(
    clubId: string,
    body: BodyInit | null | undefined,
  ): Promise<ClubDocumentDetail> {
    const id = `doc_server_${this.#nextId++}`;

    if (body instanceof FormData) {
      const file = body.get('file') as File;
      const created = makeStoredDocument({
        id,
        clubId,
        kind: 'file',
        title: String(body.get('title') ?? file.name),
        summary: String(body.get('summary') ?? ''),
        section: String(body.get('section') ?? 'other') as ClubDocument['section'],
        status: String(body.get('status') ?? 'draft') as ClubDocument['status'],
        content: null,
        file: {
          name: file.name,
          contentType: file.type,
          byteSize: file.size,
        },
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      this.add(clubId, created);
      return toDetail(created);
    }

    const draft = JSON.parse(String(body)) as {
      title: string;
      summary?: string;
      section?: ClubDocument['section'];
      status?: ClubDocument['status'];
      content?: string;
    };

    const created = makeStoredDocument({
      id,
      clubId,
      kind: 'text',
      title: draft.title,
      summary: draft.summary ?? '',
      section: draft.section ?? 'other',
      status: draft.status ?? 'draft',
      content: draft.content ?? '',
    });
    this.add(clubId, created);
    return toDetail(created);
  }

  #patch(document: StoredDocument, patch: PatchBody): Response {
    if (patch.title !== undefined) {
      document.title = patch.title;
    }
    if (patch.summary !== undefined) {
      document.summary = patch.summary;
    }
    if (patch.section !== undefined) {
      document.section = patch.section;
    }
    if (patch.status !== undefined) {
      document.status = patch.status;
    }

    if (patch.content !== undefined) {
      if (patch.expectedVersion === undefined) {
        return json({error: 'A content change must include expectedVersion'}, 400);
      }
      if (patch.expectedVersion !== document.version) {
        return json(
          {
            error:
              'This document was changed by someone else while you were editing it',
            currentVersion: document.version,
          },
          409,
        );
      }
      document.content = patch.content;
      document.version += 1;
      document.updatedBy = 'Avery Officer';
      document.revisions = [
        makeRevision({
          documentId: document.id,
          version: document.version,
          authoredBy: 'Avery Officer',
          charCount: patch.content.length,
        }),
        ...document.revisions,
      ];
    }

    return json(toDetail(document), 200);
  }

  async #replaceFile(
    document: StoredDocument,
    body: BodyInit | null | undefined,
  ): Promise<Response> {
    if (!(body instanceof FormData)) {
      return json({error: 'Expected a multipart form'}, 400);
    }

    const expectedVersion = Number(body.get('expectedVersion'));
    if (expectedVersion !== document.version) {
      return json(
        {
          error:
            'This document was changed by someone else while you were editing it',
          currentVersion: document.version,
        },
        409,
      );
    }

    const file = body.get('file') as File;
    document.bytes = new Uint8Array(await file.arrayBuffer());
    document.file = {
      name: file.name,
      contentType: file.type,
      byteSize: file.size,
    };
    document.version += 1;
    document.revisions = [
      makeRevision({
        documentId: document.id,
        version: document.version,
        authoredBy: 'Avery Officer',
        charCount: null,
        file: document.file,
      }),
      ...document.revisions,
    ];

    return json(toDetail(document), 200);
  }
}

interface PatchBody {
  title?: string;
  summary?: string;
  section?: ClubDocument['section'];
  status?: ClubDocument['status'];
  content?: string;
  expectedVersion?: number;
}

/**
 * The listing shape.
 *
 * Strips `content` explicitly, mirroring the API, so a test that expects a
 * listing to carry a body fails here rather than passing against a fake that
 * was more generous than the real thing.
 */
function toListing(document: StoredDocument): ClubDocument {
  const {content: _content, revisions: _revisions, bytes: _bytes, ...listing} =
    document;
  return listing;
}

function toDetail(document: StoredDocument): ClubDocumentDetail {
  const {revisions: _revisions, bytes: _bytes, ...detail} = document;
  return detail;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

// --- fixtures -------------------------------------------------------------

let fixtureCounter = 0;

/** Fresh ids per test; call `resetDocumentFixtures()` in beforeEach. */
export function resetDocumentFixtures(): void {
  fixtureCounter = 0;
}

export function makeStoredDocument(
  overrides: Partial<StoredDocument> = {},
): StoredDocument {
  fixtureCounter += 1;
  const id = overrides.id ?? `doc_${fixtureCounter}`;
  return {
    id,
    clubId: 'club_demo',
    kind: 'text',
    section: 'other',
    title: `Document ${fixtureCounter}`,
    summary: '',
    status: 'published',
    version: 1,
    file: null,
    content: 'The original text.',
    createdBy: 'Avery Officer',
    updatedBy: 'Avery Officer',
    createdAt: '2026-07-30T12:00:00.000Z',
    updatedAt: '2026-07-30T12:00:00.000Z',
    bytes: null,
    revisions: [
      makeRevision({documentId: id, version: 1, charCount: 18}),
    ],
    ...overrides,
  };
}

export function makeRevision(
  overrides: Partial<DocumentRevision> & {documentId: string},
): DocumentRevision {
  return {
    id: `rev_${overrides.documentId}_${overrides.version ?? 1}`,
    version: 1,
    authoredBy: 'Avery Officer',
    charCount: 0,
    file: null,
    createdAt: '2026-07-30T12:00:00.000Z',
    ...overrides,
  };
}
