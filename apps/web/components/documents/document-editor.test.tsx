/**
 * Tests for the document editor, and specifically for what happens when a save
 * loses a race.
 *
 * This is the first test under `components/`, and it is here rather than on a
 * layout component because the conflict path is the one piece of document UI
 * with a real invariant: when the API refuses a stale save, the officer's
 * writing must still be in the box. Everything else about a conflict - the
 * wording, the button - is recoverable by reading the screen. Silently losing
 * a paragraph someone typed is not, and it is invisible in a screenshot.
 *
 * The editor takes its save and reload as props, so these tests drive it
 * directly with no store and no transport. The repository's own test covers
 * turning a 409 into the error thrown here.
 */

import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {ClubDocumentDetail, DocumentPatch} from '@cos/core';
import {DocumentVersionConflictError} from '@cos/core';

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
  options: {
    document?: ClubDocumentDetail;
    onReload?: () => Promise<ClubDocumentDetail | null>;
    onDone?: () => void;
  } = {},
) {
  const document = options.document ?? makeDocument();
  const onReload = options.onReload ?? vi.fn(async () => document);
  const onDone = options.onDone ?? vi.fn();

  render(
    <DocumentEditor
      document={document}
      onSave={onSave}
      onReload={onReload}
      onDone={onDone}
    />,
  );

  return {document, onReload, onDone};
}

/**
 * A save mock typed as the prop it stands in for, so `mock.calls[0][0]` is the
 * patch rather than `never`.
 */
function saveSpy(
  implementation: (patch: DocumentPatch) => Promise<ClubDocumentDetail>,
) {
  return vi.fn<(patch: DocumentPatch) => Promise<ClubDocumentDetail>>(
    implementation,
  );
}

function contentBox(): HTMLTextAreaElement {
  return screen.getByLabelText(/Content/) as HTMLTextAreaElement;
}

function type(element: HTMLElement, value: string): void {
  fireEvent.change(element, {target: {value}});
}

function clickButton(name: RegExp): void {
  fireEvent.click(screen.getByRole('button', {name}));
}

describe('saving', () => {
  it('sends the content with the version the editor opened on', async () => {
    const onSave = saveSpy(async () => makeDocument({version: 5}));
    renderEditor(onSave);

    type(contentBox(), 'Article I. Rewritten.');
    clickButton(/^Save$/);

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]![0]).toMatchObject({
      content: 'Article I. Rewritten.',
      expectedVersion: 4,
    });
  });

  it('omits the content when only metadata changed', async () => {
    const onSave = saveSpy(async () => makeDocument());
    renderEditor(onSave);

    type(screen.getByLabelText(/Title/), 'Constitution');
    clickButton(/^Save$/);

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const patch = onSave.mock.calls[0]![0];
    expect(patch.title).toBe('Constitution');
    // A rename must not write an identical revision into a history that is
    // supposed to record what changed, and must not bump a version that
    // someone else's open editor is holding.
    expect(patch).not.toHaveProperty('content');
    expect(patch.expectedVersion).toBeUndefined();
  });

  it('closes the editor once the save lands', async () => {
    const onDone = vi.fn();
    renderEditor(async () => makeDocument({version: 5}), {onDone});

    type(contentBox(), 'Changed.');
    clickButton(/^Save$/);

    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});

describe('when someone else saved first', () => {
  const conflict = () =>
    Promise.reject(new DocumentVersionConflictError(7, 4));

  it('keeps the officer’s writing in the box', async () => {
    renderEditor(conflict);

    type(contentBox(), 'An hour of my writing.');
    clickButton(/^Save$/);

    await screen.findByText(/Someone else saved first/);
    // The whole point. A refused save is not a reason to discard what someone
    // typed, and there is nowhere else for it to have been kept.
    expect(contentBox().value).toBe('An hour of my writing.');
  });

  it('says which version was being edited and which one it is now', async () => {
    renderEditor(conflict);

    type(contentBox(), 'Mine.');
    clickButton(/^Save$/);

    const message = await screen.findByText(/version 4/);
    expect(message.textContent).toMatch(/version 7/);
  });

  it('leaves the editor open rather than treating it as a failure', async () => {
    const onDone = vi.fn();
    renderEditor(conflict, {onDone});

    type(contentBox(), 'Mine.');
    clickButton(/^Save$/);

    await screen.findByText(/Someone else saved first/);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('discards the local edit only when the officer asks for it', async () => {
    const onReload = vi.fn(async () => makeDocument({version: 7}));
    const onDone = vi.fn();
    renderEditor(conflict, {onReload, onDone});

    type(contentBox(), 'Mine.');
    clickButton(/^Save$/);
    await screen.findByText(/Someone else saved first/);

    expect(onReload).not.toHaveBeenCalled();

    clickButton(/Discard mine/);
    await waitFor(() => expect(onReload).toHaveBeenCalled());
    expect(onDone).toHaveBeenCalled();
  });

  it('reports an ordinary failure as an error, not as a conflict', async () => {
    renderEditor(() => Promise.reject(new Error('The API is down')));

    type(contentBox(), 'Mine.');
    clickButton(/^Save$/);

    await screen.findByText(/The API is down/);
    expect(screen.queryByText(/Someone else saved first/)).toBeNull();
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
