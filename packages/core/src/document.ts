/**
 * The club document hub.
 *
 * A document is one of the club's standing records - its rules, its onboarding
 * material, the notes from a meeting. Unlike an event, which is interesting for
 * a week and then history, a document is read repeatedly over years and edited
 * by whoever holds the office this term.
 *
 * Two kinds share this model, and the split is the central design decision:
 *
 * - **`text`** documents are authored in the app. Their content lives in
 *   Postgres as an append-only chain of revisions, so every edit is recoverable
 *   and the club can see who changed the rules and when.
 * - **`file`** documents are uploaded blobs - a PDF constitution, a signed
 *   form. Their bytes live in object storage; only metadata is in Postgres.
 *
 * They are one model rather than two because the *hub* is one surface: a member
 * looking for the onboarding packet does not care whether it was typed here or
 * uploaded, and forcing them to look in two places to find out would be the
 * product's problem, not theirs.
 *
 * ## Content is deliberately absent from this schema
 *
 * `clubDocumentSchema` is metadata only. Listing a club's documents must not
 * transfer a single body, because the hub renders titles and the bodies are
 * unbounded - a club with fifty documents would otherwise ship megabytes to
 * draw a list of links. `clubDocumentDetailSchema` is the shape that carries
 * content, and it is only ever produced for one document at a time.
 */

import {z} from 'zod';

import {isoInstantSchema} from './club-event.js';
import type {Role} from './role.js';
import {can} from './role.js';

/**
 * The sections the hub is divided into.
 *
 * A fixed list rather than a club-defined taxonomy, for the same reason the
 * event categories are fixed: these are the shelves every club already has, and
 * free-form sections turn into forty near-duplicates ("Minutes", "minutes",
 * "Meeting Minutes") that make the hub harder to scan, not easier.
 *
 * `other` exists so that a document nobody can classify still has somewhere to
 * live. A document that cannot be filed is a document that does not get saved.
 */
export const documentSectionSchema = z.enum([
  'rules',
  'onboarding',
  'meeting_notes',
  'forms',
  'other',
]);

export type DocumentSection = z.infer<typeof documentSectionSchema>;

export const DOCUMENT_SECTION_LABELS: Record<DocumentSection, string> = {
  rules: 'Rules and bylaws',
  onboarding: 'Onboarding',
  meeting_notes: 'Meeting notes',
  forms: 'Forms',
  other: 'Other',
};

/**
 * Sections in the order the hub lists them.
 *
 * Not alphabetical: this is the order a new member needs them in. Rules first
 * because it is what the club is, onboarding second because it is what to do,
 * and the working material after.
 */
export const ALL_DOCUMENT_SECTIONS: readonly DocumentSection[] =
  documentSectionSchema.options;

/** Where a document's content lives. See the module doc. */
export const documentKindSchema = z.enum(['text', 'file']);

export type DocumentKind = z.infer<typeof documentKindSchema>;

/**
 * Whether the club at large can see this document yet.
 *
 * Meeting notes are the motivating case: they are written during the meeting,
 * corrected afterwards, and only then are they something the club should read.
 * Without a draft state the choice is between publishing half a sentence and
 * writing the notes somewhere else, and clubs pick the second one.
 */
export const documentStatusSchema = z.enum(['draft', 'published']);

export type DocumentStatus = z.infer<typeof documentStatusSchema>;

/**
 * True when this role may see documents that are still drafts.
 *
 * The rule is deliberately derived rather than listed: **you can see a draft if
 * you could edit it.** Tying it to `document:edit` means a future role that
 * gains editing cannot accidentally gain it without also being trusted with
 * unfinished text, and there is no second list to keep in sync.
 */
export function canSeeDraftDocuments(role: Role): boolean {
  return can(role, 'document:edit');
}

/**
 * What is known about an uploaded file. Null on `text` documents.
 *
 * `byteSize` is stored rather than fetched from object storage on read: the hub
 * shows the size next to a download link, and a listing must not make one
 * network call per row to render it.
 */
export const documentFileSchema = z.object({
  /** The name as uploaded, shown to members and used for the download. */
  name: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  byteSize: z.number().int().nonnegative(),
});

export type DocumentFile = z.infer<typeof documentFileSchema>;

/**
 * The largest file the hub accepts, in bytes.
 *
 * 25 MB comfortably holds a scanned constitution or a slide deck. The limit
 * exists because an unbounded upload endpoint is a way to fill a self-hoster's
 * disk, and a club that needs to share a 500 MB video wants a link, not a
 * document.
 */
export const MAX_DOCUMENT_FILE_BYTES = 25 * 1024 * 1024;

/**
 * The largest authored document, in characters.
 *
 * Generous - roughly a 100-page document. Bounded anyway so a single row cannot
 * grow without limit, and because a text body this large is a sign the content
 * wanted to be an uploaded file.
 */
export const MAX_DOCUMENT_CONTENT_CHARS = 500_000;

/**
 * Content types the hub accepts for upload.
 *
 * An allowlist, not a blocklist. The set is what a student club actually
 * shares; anything outside it is refused rather than stored and served back
 * later, because an endpoint that stores arbitrary bytes and hands them to
 * other members with the uploader's chosen content type is how a document hub
 * becomes a way to serve a script to the club.
 */
export const ALLOWED_DOCUMENT_CONTENT_TYPES: readonly string[] = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/markdown',
  'text/csv',
  'image/png',
  'image/jpeg',
];

/**
 * OnlyOffice's own document-family name and file extension for a content
 * type, or `null` when OnlyOffice does not understand the format.
 *
 * Pure and shared for the same reason `checkDocumentUpload` is: the API's
 * OnlyOffice routes and `apps/web`'s document detail view both need to
 * answer "does this file get the OnlyOffice editor or the plain download
 * panel", and two separate implementations of that question could disagree
 * about which file types are real Office documents.
 */
const ONLYOFFICE_CONTENT_TYPES: Readonly<
  Record<string, {documentType: 'word' | 'cell' | 'slide'; fileType: string}>
> = {
  'application/msword': {documentType: 'word', fileType: 'doc'},
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    documentType: 'word',
    fileType: 'docx',
  },
  'application/vnd.ms-excel': {documentType: 'cell', fileType: 'xls'},
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    documentType: 'cell',
    fileType: 'xlsx',
  },
  'application/vnd.ms-powerpoint': {documentType: 'slide', fileType: 'ppt'},
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    {documentType: 'slide', fileType: 'pptx'},
};

export interface OnlyOfficeFileInfo {
  documentType: 'word' | 'cell' | 'slide';
  fileType: string;
}

export function onlyOfficeFileInfo(
  contentType: string,
): OnlyOfficeFileInfo | null {
  return ONLYOFFICE_CONTENT_TYPES[contentType] ?? null;
}

/**
 * The bytes of an uploaded file.
 *
 * A structural type rather than `Blob`, because core compiles with
 * `lib: ["ES2022"]` and neither DOM nor Node types - that is what keeps it
 * runnable in a browser, in Node, and in the bot without assuming any of them.
 * Both `Blob` and `File` satisfy this in every one of those environments.
 */
export interface FileBytes {
  readonly size: number;
  /** The MIME type, as the source reported it. Never trusted without checking. */
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Why an upload was refused. */
export type UploadRejection = 'too-large' | 'unsupported-type' | 'empty';

/**
 * Checks a file against the hub's limits.
 *
 * Pure and shared: the browser calls it before spending a minute uploading
 * something that will be refused, and the API calls it because a client-side
 * check protects nothing. Same function, so the two answers cannot disagree
 * about what is allowed.
 */
export function checkDocumentUpload(file: {
  contentType: string;
  byteSize: number;
}): {ok: true} | {ok: false; reason: UploadRejection} {
  if (file.byteSize <= 0) {
    return {ok: false, reason: 'empty'};
  }
  if (file.byteSize > MAX_DOCUMENT_FILE_BYTES) {
    return {ok: false, reason: 'too-large'};
  }
  // Compared without parameters: browsers send `text/plain; charset=utf-8`,
  // and the charset is not what is being allowed or refused here.
  const mediaType = file.contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!ALLOWED_DOCUMENT_CONTENT_TYPES.includes(mediaType)) {
    return {ok: false, reason: 'unsupported-type'};
  }
  return {ok: true};
}

/** Human-readable form of a rejection, shared by the API and the UI. */
export const UPLOAD_REJECTION_MESSAGES: Record<UploadRejection, string> = {
  'too-large': `That file is larger than the ${Math.floor(
    MAX_DOCUMENT_FILE_BYTES / (1024 * 1024),
  )} MB limit`,
  'unsupported-type': 'That file type is not accepted',
  empty: 'That file is empty',
};

/** Fields common to both kinds, as an officer fills them in. */
const documentDraftBase = {
  title: z.string().trim().min(1, 'Title is required').max(200),
  /** One line shown under the title in the hub listing. */
  summary: z.string().trim().max(500).default(''),
  section: documentSectionSchema.default('other'),
  status: documentStatusSchema.default('draft'),
};

/**
 * A new authored document. `content` is required, because a text document with
 * no body is just a title, and the hub has no way to render it usefully.
 */
export const textDocumentDraftSchema = z.object({
  kind: z.literal('text'),
  ...documentDraftBase,
  content: z.string().max(MAX_DOCUMENT_CONTENT_CHARS).default(''),
});

export type TextDocumentDraft = z.infer<typeof textDocumentDraftSchema>;

/**
 * A new uploaded document.
 *
 * Carries no bytes: the file arrives as a separate part of a multipart request,
 * and its name, type, and size are read from that part rather than trusted from
 * a JSON body a client could have made up.
 */
export const fileDocumentDraftSchema = z.object({
  kind: z.literal('file'),
  ...documentDraftBase,
});

export type FileDocumentDraft = z.infer<typeof fileDocumentDraftSchema>;

/** Either kind of new document, discriminated by `kind`. */
export const documentDraftSchema = z.discriminatedUnion('kind', [
  textDocumentDraftSchema,
  fileDocumentDraftSchema,
]);

export type DocumentDraft = z.infer<typeof documentDraftSchema>;

/**
 * A persisted document, without its content.
 *
 * This is what a listing returns. See the module doc for why content is not
 * here - it is the difference between the hub costing one small query and the
 * hub costing every body the club has ever written.
 */
export const clubDocumentSchema = z.object({
  id: z.string().min(1),
  clubId: z.string().min(1),
  kind: documentKindSchema,
  section: documentSectionSchema,
  title: z.string().min(1).max(200),
  summary: z.string().max(500),
  status: documentStatusSchema,
  /**
   * Increments on every content change. A client sends the version it read
   * back with its edit, and the API refuses the write if it has moved on - see
   * `documentPatchSchema.expectedVersion`.
   */
  version: z.number().int().positive(),
  /** Present on `file` documents, null on `text` ones. */
  file: documentFileSchema.nullable(),
  /** Display name of whoever created it. Not an identity claim. */
  createdBy: z.string().min(1),
  /** Display name of whoever last changed it. */
  updatedBy: z.string().min(1),
  createdAt: isoInstantSchema,
  updatedAt: isoInstantSchema,
});

export type ClubDocument = z.infer<typeof clubDocumentSchema>;

/**
 * One document, with its body.
 *
 * `content` is the current revision's text for a `text` document, and null for
 * a `file` document - those are fetched as bytes from the download route
 * instead, since a base64 body in JSON would be a third larger for no benefit.
 */
export const clubDocumentDetailSchema = clubDocumentSchema.extend({
  content: z.string().nullable(),
});

export type ClubDocumentDetail = z.infer<typeof clubDocumentDetailSchema>;

/**
 * An edit.
 *
 * Every field is optional, so a patch changes only what it names. `content` is
 * meaningful on text documents only; sending it for a file document is a
 * client error rather than a silent no-op, because quietly discarding someone's
 * writing is worse than refusing it.
 *
 * `expectedVersion` is the concurrency control, and it is the whole reason
 * this is not a plain last-write-wins update. Two officers editing the same
 * meeting notes is the ordinary case, not the exotic one: without this, the
 * second save silently erases the first, and neither person finds out. With
 * it, the second save is refused and the client can say so.
 */
export const documentPatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  summary: z.string().trim().max(500).optional(),
  section: documentSectionSchema.optional(),
  status: documentStatusSchema.optional(),
  content: z.string().max(MAX_DOCUMENT_CONTENT_CHARS).optional(),
  /**
   * The version the editor was looking at. Optional so that metadata-only
   * changes (refiling a document into another section) do not need it, and
   * required in practice for content edits - the API rejects a content change
   * that omits it rather than guessing.
   */
  expectedVersion: z.number().int().positive().optional(),
});

export type DocumentPatch = z.infer<typeof documentPatchSchema>;

/**
 * One entry in a document's history.
 *
 * Metadata only, again: a document edited weekly for three years has 150
 * revisions, and rendering "who changed this and when" must not fetch 150
 * bodies. The content of a specific revision is fetched on demand.
 *
 * Exactly one of `charCount` and `file` is non-null, mirroring the database
 * check constraint on the revisions table: a text revision has a length, a
 * file revision has a file.
 */
export const documentRevisionSchema = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1),
  version: z.number().int().positive(),
  /** Display name of the author, or a placeholder if the account is gone. */
  authoredBy: z.string().min(1),
  /**
   * Length of this revision's text, so history can show that an edit removed
   * half the document without fetching either version of it. Null on file
   * revisions.
   */
  charCount: z.number().int().nonnegative().nullable(),
  /** The file as of this revision. Null on text revisions. */
  file: documentFileSchema.nullable(),
  createdAt: isoInstantSchema,
});

export type DocumentRevision = z.infer<typeof documentRevisionSchema>;

/**
 * A past revision together with the text it held.
 *
 * Text revisions only. A historical *file* is bytes, not JSON, and is fetched
 * from the download route with a version rather than base64-encoded into a
 * response a third larger than the file itself.
 */
export const documentRevisionDetailSchema = documentRevisionSchema.extend({
  content: z.string(),
});

export type DocumentRevisionDetail = z.infer<
  typeof documentRevisionDetailSchema
>;

/**
 * Groups documents into the hub's sections, in display order.
 *
 * Every section appears, including the empty ones: a hub that hides "Rules"
 * because the club has not written any is a hub where nobody discovers they
 * should. The UI decides whether to render an empty section as a prompt.
 */
export function groupDocumentsBySection(
  documents: readonly ClubDocument[],
): Map<DocumentSection, ClubDocument[]> {
  const bySection = new Map<DocumentSection, ClubDocument[]>();
  for (const section of ALL_DOCUMENT_SECTIONS) {
    bySection.set(section, []);
  }
  for (const document of documents) {
    bySection.get(document.section)?.push(document);
  }
  return bySection;
}
