'use client';

/**
 * React binding for the DocumentRepository port.
 *
 * Same idea as the event store: components ask `useDocuments()` for the hub's
 * listing and never learn what is underneath it. What differs is deliberate and
 * follows from the port.
 *
 * **There is no subscription here.** `EventRepository.subscribe` exists because
 * a calendar is a small ordered list that is cheap to re-send; a document hub is
 * not, and a document body least of all. So the listing is read on mount and
 * re-read after this browser's own writes, and that is the whole freshness
 * story until the collaborative-editing seam lands.
 *
 * **Bodies are not in this store.** The listing is metadata, because the port
 * refuses to offer an operation that would fetch every body in the club at
 * once. One document's content is loaded by `useDocument`, one document at a
 * time, which is the only shape the port allows.
 *
 * The repository itself is exposed rather than wrapped in a mutator per
 * operation. Reads that belong to a single document - its history, a past
 * revision, its bytes - have no place in a store whose state is the listing,
 * and inventing store methods for them would mean caching things nobody asked
 * to have cached.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type {
  ClubDocument,
  ClubDocumentDetail,
  DocumentDraft,
  DocumentPatch,
  DocumentRepository,
  FileBytes,
} from '@cos/core';

import {HttpDocumentRepository} from './http-document-repository';
import {useSession} from './session';

interface DocumentStore {
  /** The club's documents, metadata only. Drafts only if you could edit them. */
  documents: ClubDocument[];
  /** True until the first listing arrives. */
  isLoading: boolean;
  /** Set when the listing could not be loaded at all. */
  error: string | null;
  /** The club this store is reading, so callers need not thread it again. */
  clubId: string;
  /**
   * The port, for the single-document reads that are not listing state.
   * Stable across renders.
   */
  repository: DocumentRepository;
  refresh: () => Promise<void>;
  createDocument: (
    draft: DocumentDraft,
    file?: FileBytes & {name: string},
  ) => Promise<ClubDocumentDetail>;
  updateDocument: (
    documentId: string,
    patch: DocumentPatch,
  ) => Promise<ClubDocumentDetail>;
  deleteDocument: (documentId: string) => Promise<void>;
  replaceFile: (
    documentId: string,
    file: FileBytes & {name: string},
    expectedVersion: number,
  ) => Promise<ClubDocumentDetail>;
}

const DocumentStoreContext = createContext<DocumentStore | null>(null);

interface DocumentStoreProviderProps {
  children: React.ReactNode;
  clubId: string;
}

export function DocumentStoreProvider({
  children,
  clubId,
}: DocumentStoreProviderProps) {
  const [repository] = useState<DocumentRepository>(
    () => new HttpDocumentRepository(),
  );

  // Signing out and back in as someone else happens without this provider
  // unmounting, and the answer to "which documents exist" is role-dependent:
  // an officer sees drafts a member does not. Keying the load on the viewer
  // means the new person never inherits the previous person's listing.
  const {user} = useSession();
  const viewerId = user?.id ?? null;

  const [documents, setDocuments] = useState<ClubDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Re-reads the listing.
   *
   * Deliberately does not raise the loading flag: this runs after every write,
   * and flashing the hub back to a skeleton because someone renamed a document
   * would be worse than the half-second of slightly stale metadata it replaces.
   */
  const load = useCallback(async () => {
    try {
      setDocuments(await repository.list(clubId));
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not load this club’s documents.',
      );
    }
  }, [repository, clubId]);

  useEffect(() => {
    let isActive = true;

    setIsLoading(true);
    setError(null);
    setDocuments([]);

    void repository
      .list(clubId)
      .then((initial) => {
        if (isActive) {
          setDocuments(initial);
          setIsLoading(false);
        }
      })
      .catch((cause: unknown) => {
        if (isActive) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not load this club’s documents.',
          );
          setIsLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [repository, clubId, viewerId]);

  const createDocument = useCallback(
    async (draft: DocumentDraft, file?: FileBytes & {name: string}) => {
      const created = await repository.create(clubId, draft, file);
      await load();
      return created;
    },
    [repository, clubId, load],
  );

  const updateDocument = useCallback(
    async (documentId: string, patch: DocumentPatch) => {
      const updated = await repository.update(clubId, documentId, patch);
      await load();
      return updated;
    },
    [repository, clubId, load],
  );

  const deleteDocument = useCallback(
    async (documentId: string) => {
      await repository.remove(clubId, documentId);
      await load();
    },
    [repository, clubId, load],
  );

  const replaceFile = useCallback(
    async (
      documentId: string,
      file: FileBytes & {name: string},
      expectedVersion: number,
    ) => {
      const updated = await repository.replaceFile(
        clubId,
        documentId,
        file,
        expectedVersion,
      );
      await load();
      return updated;
    },
    [repository, clubId, load],
  );

  const value = useMemo<DocumentStore>(
    () => ({
      documents,
      isLoading,
      error,
      clubId,
      repository,
      refresh: load,
      createDocument,
      updateDocument,
      deleteDocument,
      replaceFile,
    }),
    [
      documents,
      isLoading,
      error,
      clubId,
      repository,
      load,
      createDocument,
      updateDocument,
      deleteDocument,
      replaceFile,
    ],
  );

  return (
    <DocumentStoreContext.Provider value={value}>
      {children}
    </DocumentStoreContext.Provider>
  );
}

export function useDocuments(): DocumentStore {
  const store = useContext(DocumentStoreContext);
  if (!store) {
    throw new Error('useDocuments must be used within a DocumentStoreProvider');
  }
  return store;
}

export interface DocumentDetailState {
  document: ClubDocumentDetail | null;
  isLoading: boolean;
  /** True when the club has no such document, as opposed to a failed read. */
  isMissing: boolean;
  error: string | null;
  /** Re-reads this document. Used after a save and after a conflict. */
  reload: () => Promise<ClubDocumentDetail | null>;
  /** Installs a document the caller already has, avoiding a redundant read. */
  set: (document: ClubDocumentDetail) => void;
}

/**
 * One document, with its content.
 *
 * Separate from the listing because it is a different cost: the hub is cheap
 * and always loaded, a body is fetched only when someone opens it.
 *
 * `isMissing` is distinguished from `error` because the two need different
 * words on screen - "this document does not exist" and "we could not reach the
 * API" are not the same news, and the port already distinguishes them by
 * answering null rather than throwing.
 */
export function useDocument(documentId: string): DocumentDetailState {
  const {repository, clubId} = useDocuments();

  const [document, setDocument] = useState<ClubDocumentDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMissing, setIsMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async () => {
    const found = await repository.get(clubId, documentId);
    setDocument(found);
    setIsMissing(found === null);
    setError(null);
    return found;
  }, [repository, clubId, documentId]);

  useEffect(() => {
    let isActive = true;

    setIsLoading(true);
    setIsMissing(false);
    setError(null);
    setDocument(null);

    void repository
      .get(clubId, documentId)
      .then((found) => {
        if (isActive) {
          setDocument(found);
          setIsMissing(found === null);
          setIsLoading(false);
        }
      })
      .catch((cause: unknown) => {
        if (isActive) {
          setError(
            cause instanceof Error ? cause.message : 'Could not load it.',
          );
          setIsLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [repository, clubId, documentId]);

  return useMemo(
    () => ({
      document,
      isLoading,
      isMissing,
      error,
      reload: read,
      set: setDocument,
    }),
    [document, isLoading, isMissing, error, read],
  );
}
