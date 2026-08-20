/**
 * Tests for the document editor - now metadata only (title, summary,
 * section, status). Content moved to `DocumentCollabEditor`, which is always
 * mounted for a text document rather than toggled by this form, so there is
 * no conflict path left here to test: this component never sends `content`
 * or `expectedVersion`.
 */

import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {ClubDocumentDetail, DocumentPatch} from '@cos/core';

import {DocumentEditor} from './document-editor';

afterEach(cleanup);

function makeDocument(
  overrides: Partial<ClubDocumentDetail> = {},
): ClubDocumentDetail {
  return {
    id: 'doc_1',
    clubId: 'club_demo',
    kind: 'text',
    section: 'rules',
    title: 'Bylaws',
    summary: 'How the club runs.',
    status: 'published',
    version: 4,
    file: null,
    content: 'Article I. The original text.',
    createdBy: 'Avery Officer',
    updatedBy: 'Avery Officer',
    createdAt: '2026-07-30T12:00:00.000Z',
    updatedAt: '2026-07-30T12:00:00.000Z',
    ...overrides,
  };
}

function renderEditor(
  onSave: (patch: DocumentPatch) => Promise<ClubDocumentDetail>,
  options: {document?: ClubDocumentDetail; onDone?: () => void} = {},
) {
  const document = options.document ?? makeDocument();
  const onDone = options.onDone ?? vi.fn();

  render(<DocumentEditor document={document} onSave={onSave} onDone={onDone} />);

  return {document, onDone};
}

function saveSpy(
  implementation: (patch: DocumentPatch) => Promise<ClubDocumentDetail>,
) {
  return vi.fn<(patch: DocumentPatch) => Promise<ClubDocumentDetail>>(
    implementation,
  );
}

function type(element: HTMLElement, value: string): void {
  fireEvent.change(element, {target: {value}});
}

function clickButton(name: RegExp): void {
  fireEvent.click(screen.getByRole('button', {name}));
}

describe('saving metadata', () => {
  it('sends the metadata fields and never a content or expectedVersion field', async () => {
    const onSave = saveSpy(async () => makeDocument({title: 'Constitution'}));
    renderEditor(onSave);

    type(screen.getByLabelText(/Title/), 'Constitution');
    clickButton(/^Save$/);

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const patch = onSave.mock.calls[0]![0];
    expect(patch.title).toBe('Constitution');
    expect(patch).not.toHaveProperty('content');
    expect(patch).not.toHaveProperty('expectedVersion');
  });

  it('trims the title and summary before sending them', async () => {
    const onSave = saveSpy(async () => makeDocument());
    renderEditor(onSave);

    type(screen.getByLabelText(/Title/), '  Constitution  ');
    type(screen.getByLabelText(/Summary/), '  How the club runs, revised.  ');
    clickButton(/^Save$/);

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const patch = onSave.mock.calls[0]![0];
    expect(patch.title).toBe('Constitution');
    expect(patch.summary).toBe('How the club runs, revised.');
  });

  it('closes the editor once the save lands', async () => {
    const onDone = vi.fn();
    renderEditor(async () => makeDocument(), {onDone});

    clickButton(/^Save$/);

    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('closes without saving on cancel', () => {
    const onSave = saveSpy(async () => makeDocument());
    const onDone = vi.fn();
    renderEditor(onSave, {onDone});

    clickButton(/^Cancel$/);

    expect(onSave).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });

  it('reports a save failure as an error', async () => {
    renderEditor(() => Promise.reject(new Error('The API is down')));

    clickButton(/^Save$/);

    await screen.findByText(/The API is down/);
  });
});

it('refuses to save a document with no title', async () => {
  const onSave = saveSpy(async () => makeDocument());
  renderEditor(onSave);

  type(screen.getByLabelText(/Title/), '   ');
  clickButton(/^Save$/);

  await screen.findByText(/needs a title/);
  expect(onSave).not.toHaveBeenCalled();
});
