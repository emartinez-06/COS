/**
 * Tests for the document hub's domain model.
 *
 * The interesting ones are not the schema round-trips - they are the
 * invariants that would be expensive to discover later:
 *
 * - a listing shape that cannot carry a body, which is what keeps the hub cheap
 * - the upload allowlist, which is a security boundary and not a convenience
 * - draft visibility deriving from a capability rather than a second list
 */

import {describe, expect, it} from 'vitest';

import {
  ALLOWED_DOCUMENT_CONTENT_TYPES,
  ALL_DOCUMENT_SECTIONS,
  DOCUMENT_SECTION_LABELS,
  MAX_DOCUMENT_CONTENT_CHARS,
  MAX_DOCUMENT_FILE_BYTES,
  canSeeDraftDocuments,
  checkDocumentUpload,
  clubDocumentSchema,
  documentDraftSchema,
  documentPatchSchema,
  groupDocumentsBySection,
  onlyOfficeFileInfo,
  textDocumentDraftSchema,
} from './document.js';
import type {ClubDocument} from './document.js';
import {can, capabilitiesFor} from './role.js';

const baseDocument: ClubDocument = {
  id: 'doc_1',
  clubId: 'club_1',
  kind: 'text',
  section: 'rules',
  title: 'Constitution',
  summary: '',
  status: 'published',
  version: 1,
  file: null,
  createdBy: 'Avery Officer',
  updatedBy: 'Avery Officer',
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
};

describe('the listing shape', () => {
  it('has no content field, so a listing cannot carry a body', () => {
    const parsed = clubDocumentSchema.parse({
      ...baseDocument,
      content: 'the entire constitution',
    });

    // Not merely "content is undefined" - the key must be absent, because the
    // whole point is that this shape has nowhere to put a body even when a
    // careless caller supplies one.
    expect(Object.keys(parsed)).not.toContain('content');
  });

  it('describes a file document with its file metadata', () => {
    const parsed = clubDocumentSchema.parse({
      ...baseDocument,
      kind: 'file',
      file: {name: 'bylaws.pdf', contentType: 'application/pdf', byteSize: 2048},
    });

    expect(parsed.file?.name).toBe('bylaws.pdf');
  });
});

describe('sections', () => {
  it('lists rules and onboarding before the working material', () => {
    // The order is what the hub renders, and it is deliberately not
    // alphabetical: it is the order a new member needs them in.
    expect(ALL_DOCUMENT_SECTIONS.slice(0, 2)).toEqual(['rules', 'onboarding']);
  });

  it('labels every section', () => {
    for (const section of ALL_DOCUMENT_SECTIONS) {
      expect(DOCUMENT_SECTION_LABELS[section]).toBeTruthy();
    }
  });

  it('groups documents into every section, including the empty ones', () => {
    const grouped = groupDocumentsBySection([
      baseDocument,
      {...baseDocument, id: 'doc_2', section: 'meeting_notes'},
    ]);

    expect([...grouped.keys()]).toEqual([...ALL_DOCUMENT_SECTIONS]);
    expect(grouped.get('rules')).toHaveLength(1);
    expect(grouped.get('meeting_notes')).toHaveLength(1);
    // A club that has written no onboarding material should still see that
    // the shelf exists.
    expect(grouped.get('onboarding')).toEqual([]);
  });
});

describe('upload checks', () => {
  it('accepts an ordinary PDF', () => {
    expect(
      checkDocumentUpload({contentType: 'application/pdf', byteSize: 1024}),
    ).toEqual({ok: true});
  });

  it('ignores charset parameters on the content type', () => {
    // Browsers send `text/plain; charset=utf-8`, and the charset is not what
    // is being allowed or refused.
    expect(
      checkDocumentUpload({
        contentType: 'text/plain; charset=utf-8',
        byteSize: 10,
      }),
    ).toEqual({ok: true});
  });

  it('refuses an empty file', () => {
    expect(
      checkDocumentUpload({contentType: 'application/pdf', byteSize: 0}),
    ).toEqual({ok: false, reason: 'empty'});
  });

  it('refuses a file over the limit', () => {
    expect(
      checkDocumentUpload({
        contentType: 'application/pdf',
        byteSize: MAX_DOCUMENT_FILE_BYTES + 1,
      }),
    ).toEqual({ok: false, reason: 'too-large'});
  });

  it('accepts a file exactly at the limit', () => {
    expect(
      checkDocumentUpload({
        contentType: 'application/pdf',
        byteSize: MAX_DOCUMENT_FILE_BYTES,
      }),
    ).toEqual({ok: true});
  });

  it('refuses a type that is not on the allowlist', () => {
    // The allowlist is a security boundary: this endpoint stores bytes and
    // hands them back to other members later.
    expect(
      checkDocumentUpload({contentType: 'text/html', byteSize: 100}),
    ).toEqual({ok: false, reason: 'unsupported-type'});
    expect(
      checkDocumentUpload({
        contentType: 'application/javascript',
        byteSize: 100,
      }),
    ).toEqual({ok: false, reason: 'unsupported-type'});
  });

  it('does not allow an executable type in through casing', () => {
    expect(
      checkDocumentUpload({contentType: 'TEXT/HTML', byteSize: 100}),
    ).toEqual({ok: false, reason: 'unsupported-type'});
  });

  it('has no HTML or script type on the allowlist at all', () => {
    for (const type of ALLOWED_DOCUMENT_CONTENT_TYPES) {
      expect(type).not.toContain('html');
      expect(type).not.toContain('javascript');
    }
  });
});

describe('onlyOfficeFileInfo', () => {
  it('recognizes a modern Word document', () => {
    expect(
      onlyOfficeFileInfo(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toEqual({documentType: 'word', fileType: 'docx'});
  });

  it('recognizes a modern Excel workbook', () => {
    expect(
      onlyOfficeFileInfo(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).toEqual({documentType: 'cell', fileType: 'xlsx'});
  });

  it('recognizes a modern PowerPoint deck', () => {
    expect(
      onlyOfficeFileInfo(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ),
    ).toEqual({documentType: 'slide', fileType: 'pptx'});
  });

  it('returns null for a PDF - OnlyOffice only understands Office formats here', () => {
    expect(onlyOfficeFileInfo('application/pdf')).toBeNull();
  });

  it('returns null for an image', () => {
    expect(onlyOfficeFileInfo('image/png')).toBeNull();
  });
});

describe('drafts', () => {
  it('is an officer who can see them, derived from being able to edit', () => {
    expect(canSeeDraftDocuments('admin')).toBe(true);
    expect(canSeeDraftDocuments('member')).toBe(false);
  });

  it('tracks document:edit rather than naming roles', () => {
    // If a future role gains editing, it gains draft visibility with it, and
    // there is no second list to forget to update.
    for (const role of ['admin', 'member'] as const) {
      expect(canSeeDraftDocuments(role)).toBe(can(role, 'document:edit'));
    }
  });
});

describe('capabilities', () => {
  it('lets every member read the hub', () => {
    // The rules are worthless if the people they govern cannot see them.
    expect(can('member', 'document:view')).toBe(true);
  });

  it('does not let a member write to it', () => {
    expect(can('member', 'document:create')).toBe(false);
    expect(can('member', 'document:edit')).toBe(false);
    expect(can('member', 'document:delete')).toBe(false);
  });

  it('gives an officer the whole hub', () => {
    const officer = capabilitiesFor('admin');
    expect(officer).toContain('document:create');
    expect(officer).toContain('document:edit');
    expect(officer).toContain('document:delete');
    expect(officer).toContain('document:view');
  });
});

describe('drafting a document', () => {
  it('defaults an authored document to a private draft in "other"', () => {
    const draft = textDocumentDraftSchema.parse({
      kind: 'text',
      title: 'Notes',
    });

    expect(draft.status).toBe('draft');
    expect(draft.section).toBe('other');
    expect(draft.content).toBe('');
    expect(draft.summary).toBe('');
  });

  it('trims the title', () => {
    expect(
      textDocumentDraftSchema.parse({kind: 'text', title: '  Bylaws  '}).title,
    ).toBe('Bylaws');
  });

  it('requires a title that is not only whitespace', () => {
    expect(
      textDocumentDraftSchema.safeParse({kind: 'text', title: '   '}).success,
    ).toBe(false);
  });

  it('refuses content past the limit', () => {
    expect(
      textDocumentDraftSchema.safeParse({
        kind: 'text',
        title: 'Long',
        content: 'x'.repeat(MAX_DOCUMENT_CONTENT_CHARS + 1),
      }).success,
    ).toBe(false);
  });

  it('discriminates the two kinds', () => {
    const text = documentDraftSchema.parse({kind: 'text', title: 'A'});
    const file = documentDraftSchema.parse({kind: 'file', title: 'B'});

    expect(text.kind).toBe('text');
    expect(file.kind).toBe('file');
    // A file draft carries no content: the bytes never travel as JSON.
    expect(file).not.toHaveProperty('content');
  });

  it('refuses an unknown kind', () => {
    expect(
      documentDraftSchema.safeParse({kind: 'video', title: 'A'}).success,
    ).toBe(false);
  });
});

describe('patching a document', () => {
  it('allows a metadata-only change with no version', () => {
    const patch = documentPatchSchema.parse({section: 'rules'});
    expect(patch.expectedVersion).toBeUndefined();
    expect(patch.content).toBeUndefined();
  });

  it('carries the version an editor was looking at', () => {
    const patch = documentPatchSchema.parse({
      content: 'new text',
      expectedVersion: 3,
    });
    expect(patch.expectedVersion).toBe(3);
  });

  it('refuses a version that is not a positive whole number', () => {
    expect(
      documentPatchSchema.safeParse({content: 'x', expectedVersion: 0}).success,
    ).toBe(false);
    expect(
      documentPatchSchema.safeParse({content: 'x', expectedVersion: 1.5})
        .success,
    ).toBe(false);
  });

  it('cannot change the kind or the club', () => {
    const patch = documentPatchSchema.parse({
      title: 'Renamed',
      kind: 'file',
      clubId: 'club_someone_else',
    });

    expect(patch).not.toHaveProperty('kind');
    expect(patch).not.toHaveProperty('clubId');
  });
});
