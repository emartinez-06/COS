/**
 * Tests for the React binding over the DocumentRepository port.
 *
 * As with the event store, these drive the *real* `HttpDocumentRepository`
 * against a fake API and mock only `useSession`. The store is almost entirely
 * lifecycle, and a mock repository would leave the interesting half untested.
 *
 * What is worth pinning here is different from the calendar's store, because
 * this one has no subscription. Freshness comes from re-reading after this
 * browser's own writes, so "a write updates the hub" is a property of the store
 * rather than something a poll happens to fix a few seconds later - and a
 * mistake there is invisible until someone renames a document and watches the
 * old title stay on the screen.
 */

import {act, cleanup, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {DocumentStoreProvider, useDocument, useDocuments} from './document-store';
import {
  FakeDocumentApi,
  makeStoredDocument,
  resetDocumentFixtures,
} from './test-support/fake-document-api';

const CLUB = 'club_demo';

/** Swapped by tests to simulate an in-tab account switch. */
let viewer: {id: string} | null;

vi.mock('./session', () => ({
  useSession: () => ({user: viewer}),
}));

let api: FakeDocumentApi;

beforeEach(() => {
  resetDocumentFixtures();
  api = new FakeDocumentApi();
  vi.stubGlobal('fetch', api.handle);
  viewer = {id: 'user_avery'};
});

afterEach(() => {
  // Not automatic here: React Testing Library only registers its own cleanup
  // when vitest runs with globals enabled, and this project does not.
  cleanup();
  vi.unstubAllGlobals();
});

/** Lets the mount effect's fetch settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Renders the listing state so assertions read like the screen. */
function Probe() {
  const {documents, isLoading, error} = useDocuments();
  return (
    <div>
      <span data-testid="status">
        {isLoading ? 'loading' : error ? `error: ${error}` : 'ready'}
      </span>
      <span data-testid="titles">
        {documents.map((document) => document.title).join(', ')}
      </span>
    </div>
  );
}

function renderStore(ui: React.ReactNode = <Probe />, clubId = CLUB) {
  return render(
    <DocumentStoreProvider clubId={clubId}>{ui}</DocumentStoreProvider>,
  );
}

describe('the listing', () => {
  it('loads the club’s documents on mount', async () => {
    api.add(CLUB, makeStoredDocument({title: 'Bylaws'}));
    api.add(CLUB, makeStoredDocument({title: 'Onboarding'}));

    renderStore();
    expect(screen.getByTestId('status').textContent).toBe('loading');

    await settle();

    expect(screen.getByTestId('status').textContent).toBe('ready');
    expect(screen.getByTestId('titles').textContent).toBe('Bylaws, Onboarding');
  });

  it('reports a failed load instead of showing an empty hub', async () => {
    api.failEveryRequest(500);

    renderStore();
    await settle();

    // An empty hub says the club has written nothing down. That is a different
    // statement from "we could not reach the API", and only one of them is true.
    expect(screen.getByTestId('status').textContent).toMatch(/^error:/);
  });

  it('re-reads the listing after a write, so the hub reflects it', async () => {
    api.add(CLUB, makeStoredDocument({id: 'doc_1', title: 'Bylaws'}));

    let store: ReturnType<typeof useDocuments>;
    function Capture() {
      store = useDocuments();
      return <Probe />;
    }

    renderStore(<Capture />);
    await settle();

    await act(async () => {
      await store.updateDocument('doc_1', {title: 'Constitution'});
    });

    // Nothing polls this store. If the write did not re-read, the old title
    // stays on screen until the reader navigates away and back.
    expect(screen.getByTestId('titles').textContent).toBe('Constitution');
  });

  it('drops the previous person’s listing when the viewer changes', async () => {
    api.add(CLUB, makeStoredDocument({title: 'Officers only'}));

    const {rerender} = renderStore();
    await settle();
    expect(screen.getByTestId('titles').textContent).toBe('Officers only');

    // What a listing contains is role-dependent - an officer sees drafts a
    // member does not - so an account switch must re-read rather than leave
    // the previous person's documents on screen.
    api.clearCalls();
    viewer = {id: 'user_morgan'};
    rerender(
      <DocumentStoreProvider clubId={CLUB}>
        <Probe />
      </DocumentStoreProvider>,
    );
    await settle();

    expect(api.getCount).toBe(1);
  });
});

describe('one document', () => {
  function DetailProbe({documentId}: {documentId: string}) {
    const {document, isLoading, isMissing, error} = useDocument(documentId);
    return (
      <span data-testid="detail">
        {isLoading
          ? 'loading'
          : isMissing
            ? 'missing'
            : error
              ? `error: ${error}`
              : (document?.content ?? '')}
      </span>
    );
  }

  it('loads the body of one document', async () => {
    api.add(CLUB, makeStoredDocument({id: 'doc_1', content: 'Article I.'}));

    renderStore(<DetailProbe documentId="doc_1" />);
    await settle();

    expect(screen.getByTestId('detail').textContent).toBe('Article I.');
  });

  it('distinguishes a document that is not here from a failed read', async () => {
    renderStore(<DetailProbe documentId="doc_missing" />);
    await settle();

    expect(screen.getByTestId('detail').textContent).toBe('missing');
  });

  it('reports a refused read as an error, not as a missing document', async () => {
    api.add(CLUB, makeStoredDocument({id: 'doc_1'}));
    api.failEveryRequest(403);

    renderStore(<DetailProbe documentId="doc_1" />);
    await settle();

    expect(screen.getByTestId('detail').textContent).toMatch(/^error:/);
  });
});
