/**
 * The HTTP DocumentRepository: the club's documents, backed by services/api.
 *
 * The port was written before this file existed and this file is the first
 * thing to satisfy it, so a few of its shapes are worth restating here as the
 * reasons this implementation looks the way it does.
 *
 * ## A conflict is a return value, not a crash
 *
 * `update` and `replaceFile` translate the API's 409 into a
 * `DocumentVersionConflictError` carrying the version the document is actually
 * at. Two officers editing the same meeting notes is the ordinary case, and the
 * UI is expected to handle this outcome by name rather than showing whatever
 * string an error happened to have. Everything else non-2xx stays an
 * `ApiError`.
 *
 * ## `get` and `revision` answer null rather than throwing
 *
 * A 404 from those two means "not here", which the port already has a way to
 * say. Turning it into an exception would make every caller write a try/catch
 * to express the same thing. Every other status is still an error, so a 403 is
 * never quietly rendered as an empty page.
 *
 * ## Bytes never travel as JSON
 *
 * Uploads go out as multipart and downloads come back as a `Blob`, which
 * satisfies `FileBytes` in the browser. Base64 in a JSON body would be a third
 * larger for no benefit, and the API would have to decode it before it could
 * tell whether it was even an allowed type.
 *
 * ## There is no `subscribe`
 *
 * Deliberately, and the port explains why: re-sending an entire document body
 * every few seconds is both wasteful and unable to merge two people's edits.
 * The hub re-reads after its own writes and on demand. Live editing is a
 * separate seam - see docs/COLLABORATIVE-EDITING.md.
 */

import type {
  ClubDocument,
  ClubDocumentDetail,
  DocumentDraft,
  DocumentPatch,
  DocumentRepository,
  DocumentRevision,
  DocumentRevisionDetail,
  FileBytes,
} from '@cos/core';
import {DocumentVersionConflictError} from '@cos/core';

import {ApiError, readErrorMessage} from './api-error';
import {apiFetch} from './auth-client';

/** The body the API sends with a 409. */
interface ConflictBody {
  error?: string;
  currentVersion?: number;
}

export class HttpDocumentRepository implements DocumentRepository {
  async list(clubId: string): Promise<ClubDocument[]> {
    return this.#request<ClubDocument[]>(this.#documentsPath(clubId));
  }

  async get(
    clubId: string,
    documentId: string,
  ): Promise<ClubDocumentDetail | null> {
    return this.#requestOrNull<ClubDocumentDetail>(
      this.#documentPath(clubId, documentId),
    );
  }

  async create(
    clubId: string,
    draft: DocumentDraft,
    file?: FileBytes & {name: string},
  ): Promise<ClubDocumentDetail> {
    if (draft.kind === 'file') {
      if (!file) {
        throw new Error('A file document needs the file to upload');
      }

      const form = new FormData();
      form.append('file', await toBlob(file), file.name);
      form.append('title', draft.title);
      form.append('summary', draft.summary);
      form.append('section', draft.section);
      form.append('status', draft.status);

      return this.#request<ClubDocumentDetail>(this.#documentsPath(clubId), {
        method: 'POST',
        body: form,
      });
    }

    if (file) {
      // Refused rather than ignored: silently dropping someone's upload
      // because the draft said `text` is how a file goes missing without
      // anyone finding out until they look for it.
      throw new Error('A text document cannot carry a file');
    }

    return this.#request<ClubDocumentDetail>(this.#documentsPath(clubId), {
      method: 'POST',
      body: JSON.stringify(draft),
    });
  }

  async update(
    clubId: string,
    documentId: string,
    patch: DocumentPatch,
  ): Promise<ClubDocumentDetail> {
    return this.#requestWithConflict<ClubDocumentDetail>(
      this.#documentPath(clubId, documentId),
      {method: 'PATCH', body: JSON.stringify(patch)},
      patch.expectedVersion,
    );
  }

  async remove(clubId: string, documentId: string): Promise<void> {
    await this.#request<void>(
      this.#documentPath(clubId, documentId),
      {method: 'DELETE'},
      false,
    );
  }

  async revisions(
    clubId: string,
    documentId: string,
  ): Promise<DocumentRevision[]> {
    return this.#request<DocumentRevision[]>(
      `${this.#documentPath(clubId, documentId)}/revisions`,
    );
  }

  async revision(
    clubId: string,
    documentId: string,
    version: number,
  ): Promise<DocumentRevisionDetail | null> {
    return this.#requestOrNull<DocumentRevisionDetail>(
      `${this.#documentPath(clubId, documentId)}/revisions/${version}`,
    );
  }

  async download(
    clubId: string,
    documentId: string,
    version?: number,
  ): Promise<FileBytes> {
    const path = `${this.#documentPath(clubId, documentId)}/file${
      version === undefined ? '' : `?version=${version}`
    }`;

    const response = await apiFetch(path);
    if (!response.ok) {
      throw new ApiError(response.status, await readErrorMessage(response));
    }
    // A Blob is a FileBytes: it has `size`, `type`, and `arrayBuffer()`. The
    // port is written structurally for exactly this reason - core cannot name
    // `Blob` without assuming a browser.
    return response.blob();
  }

  async replaceFile(
    clubId: string,
    documentId: string,
    file: FileBytes & {name: string},
    expectedVersion: number,
  ): Promise<ClubDocumentDetail> {
    const form = new FormData();
    form.append('file', await toBlob(file), file.name);
    form.append('expectedVersion', String(expectedVersion));

    return this.#requestWithConflict<ClubDocumentDetail>(
      `${this.#documentPath(clubId, documentId)}/file`,
      {method: 'PUT', body: form},
      expectedVersion,
    );
  }

  // --- requests -----------------------------------------------------------

  #documentsPath(clubId: string): string {
    return `/api/clubs/${encodeURIComponent(clubId)}/documents`;
  }

  #documentPath(clubId: string, documentId: string): string {
    return `${this.#documentsPath(clubId)}/${encodeURIComponent(documentId)}`;
  }

  async #request<T>(
    path: string,
    init: RequestInit = {},
    expectBody = true,
  ): Promise<T> {
    const response = await apiFetch(path, init);

    if (!response.ok) {
      throw new ApiError(response.status, await readErrorMessage(response));
    }

    // DELETE answers 204 with no body; calling .json() on it throws.
    if (!expectBody || response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  /** A 404 means "not here" and is answered as null; anything else throws. */
  async #requestOrNull<T>(path: string): Promise<T | null> {
    const response = await apiFetch(path);

    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new ApiError(response.status, await readErrorMessage(response));
    }
    return (await response.json()) as T;
  }

  /**
   * A write that can lose a race.
   *
   * `expectedVersion` is passed in rather than read back out of the response
   * because a 409 body only reports where the document actually is; what the
   * caller *thought* they were editing is only known here.
   */
  async #requestWithConflict<T>(
    path: string,
    init: RequestInit,
    expectedVersion: number | undefined,
  ): Promise<T> {
    const response = await apiFetch(path, init);

    if (response.status === 409) {
      const body = (await response.json().catch(() => ({}))) as ConflictBody;
      throw new DocumentVersionConflictError(
        body.currentVersion ?? 0,
        expectedVersion ?? 0,
      );
    }

    if (!response.ok) {
      throw new ApiError(response.status, await readErrorMessage(response));
    }

    return (await response.json()) as T;
  }
}

/**
 * The bytes as something `FormData` accepts.
 *
 * A browser `File` is already a `Blob` and passes straight through; anything
 * else satisfying `FileBytes` is copied once. The type is carried over because
 * it is what the API checks against the allowlist.
 */
async function toBlob(file: FileBytes): Promise<Blob> {
  if (file instanceof Blob) {
    return file;
  }
  return new Blob([await file.arrayBuffer()], {type: file.type});
}
