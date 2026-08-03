/**
 * Ports: the interfaces the app depends on instead of depending on transports.
 *
 * The calendar UI imports `EventRepository` and nothing else, so the transport
 * underneath it can change without touching a component. That held: swapping
 * the in-memory implementation for the HTTP one changed a single line in
 * `event-store.tsx`.
 *
 * `subscribe` is the realtime seam. It is defined in terms of *what the caller
 * is promised* - a fresh snapshot after any change to the club's events,
 * whoever made it - and deliberately not in terms of how that change is
 * discovered. Today the HTTP implementation discovers it by polling; replacing
 * that with a WebSocket frame is a change inside the repository and invisible
 * above it.
 *
 * Note that "whoever made it" is load-bearing. A change can originate from
 * another officer's browser, or from a server-side writer with no browser at
 * all, which the GroupMe bot will be. An implementation that only notifies the
 * caller of their own writes does not satisfy this interface.
 */

import type {ClubEvent, EventDraft} from './club-event.js';
import type {
  ClubDocument,
  ClubDocumentDetail,
  DocumentDraft,
  DocumentPatch,
  DocumentRevision,
  DocumentRevisionDetail,
  FileBytes,
} from './document.js';
import type {
  ExpenseRequest,
  ExpenseRequestDraft,
  ExpenseRequestPatch,
  Fund,
  FundAllocation,
  FundAllocationDraft,
  FundDraft,
  FundPatch,
  RequestStatus,
} from './treasury.js';

/** Unsubscribes a listener registered with `subscribe`. */
export type Unsubscribe = () => void;

/**
 * Fields of an event an officer may change after creation.
 * `id`, `clubId`, and the audit fields are deliberately excluded.
 */
export type EventPatch = Partial<EventDraft>;

export interface EventRepository {
  /** All events for a club, chronological. */
  list(clubId: string): Promise<ClubEvent[]>;

  /**
   * Creates an event and returns the persisted record.
   *
   * There is no author parameter on purpose. Attribution comes from the
   * authenticated session on the server; a client-supplied author would be
   * both untrustworthy and ignored.
   */
  create(clubId: string, draft: EventDraft): Promise<ClubEvent>;

  /**
   * Applies a partial update and returns the updated record.
   *
   * `clubId` is required even though `eventId` is unique, because it is what
   * authorization is scoped to: the server resolves the caller's role from
   * their membership of *this club* before touching the event. An in-memory
   * implementation can find the event by id alone, but designing the port
   * around that would have made the authorized case the awkward one.
   */
  update(clubId: string, eventId: string, patch: EventPatch): Promise<ClubEvent>;

  /** Removes an event. `clubId` scopes authorization, as in `update`. */
  remove(clubId: string, eventId: string): Promise<void>;

  /**
   * Registers `listener`, called with a fresh snapshot after any change to
   * this club's events - including changes this caller did not make.
   */
  subscribe(clubId: string, listener: (events: ClubEvent[]) => void): Unsubscribe;
}

/** Raised by `DocumentRepository.update` when someone else saved first. */
export class DocumentVersionConflictError extends Error {
  constructor(
    /** The version now stored, which the caller has not seen. */
    readonly currentVersion: number,
    /** The version the caller was editing. */
    readonly expectedVersion: number,
  ) {
    super(
      `This document was changed by someone else (you edited version ${expectedVersion}, it is now version ${currentVersion})`,
    );
    this.name = 'DocumentVersionConflictError';
  }
}

/**
 * The document hub.
 *
 * Note the shape of the read side: `list` returns `ClubDocument` (metadata) and
 * `get` returns `ClubDocumentDetail` (metadata plus body). That is not an
 * accident of convenience - it is the port refusing to offer an operation that
 * would fetch every body in the club at once. An implementation cannot
 * accidentally make the hub expensive, because the interface gives it nowhere
 * to put the content.
 *
 * There is deliberately **no `subscribe` here**, unlike `EventRepository`. A
 * calendar is a small ordered list where re-sending the whole snapshot is
 * cheap and correct. A document being typed into is neither: shipping the full
 * body every few seconds is both wasteful and unable to merge two people's
 * edits. Live document collaboration gets a purpose-built seam rather than a
 * copied one - see docs/COLLABORATIVE-EDITING.md.
 */
export interface DocumentRepository {
  /**
   * The club's documents, without their bodies.
   *
   * What comes back depends on the caller's role: drafts are included only for
   * someone who could edit them. The server decides that, not the caller.
   */
  list(clubId: string): Promise<ClubDocument[]>;

  /** One document with its body, or null when it does not exist here. */
  get(clubId: string, documentId: string): Promise<ClubDocumentDetail | null>;

  /**
   * Creates a document. `file` is required for a `file` draft and must be
   * absent for a `text` one - the bytes never travel as JSON.
   *
   * The name travels with the bytes, as it does in `replaceFile`. It is what
   * the hub offers the file back as, so a `FileBytes` without one would leave
   * an implementation inventing a filename for a document the club uploaded.
   */
  create(
    clubId: string,
    draft: DocumentDraft,
    file?: FileBytes & {name: string},
  ): Promise<ClubDocumentDetail>;

  /**
   * Applies a partial update, writing a new revision when content changes.
   *
   * Throws `DocumentVersionConflictError` when `patch.expectedVersion` is not
   * the version currently stored. Callers are expected to handle that as a
   * real outcome rather than an exception path: someone else saving first is
   * ordinary, not exceptional.
   */
  update(
    clubId: string,
    documentId: string,
    patch: DocumentPatch,
  ): Promise<ClubDocumentDetail>;

  /** Removes a document from the hub. */
  remove(clubId: string, documentId: string): Promise<void>;

  /** The document's history, newest first, without bodies. */
  revisions(clubId: string, documentId: string): Promise<DocumentRevision[]>;

  /** One past revision, with the text it held. */
  revision(
    clubId: string,
    documentId: string,
    version: number,
  ): Promise<DocumentRevisionDetail | null>;

  /** The bytes of a `file` document, at `version` or the current one. */
  download(
    clubId: string,
    documentId: string,
    version?: number,
  ): Promise<FileBytes>;

  /** Replaces a `file` document's bytes, creating a new revision. */
  replaceFile(
    clubId: string,
    documentId: string,
    file: FileBytes & {name: string},
    expectedVersion: number,
  ): Promise<ClubDocumentDetail>;
}

/**
 * The treasury.
 *
 * Reads return the club's funds, allocation entries, and requests as three
 * lists, and the balance is folded from them by `summarizeFund` rather than
 * fetched. That is deliberate: there is exactly one implementation of the
 * arithmetic, it is pure, and it runs over data the screen already needed in
 * order to draw its tables. An endpoint returning a precomputed total would be
 * a second implementation of the most consequential calculation in the product,
 * and the two would eventually disagree.
 *
 * There is deliberately **no `subscribe`**, unlike `EventRepository`. The
 * calendar has one because the GroupMe bot is a writer with no browser, so
 * changes originate where no tab can observe them. Nothing writes to the
 * treasury except an officer in the app, and the bot's role here is the
 * opposite - it answers `!budget` by *reading*. A reader needs no subscription.
 *
 * Revisit both of those when a club has years of history rather than a
 * semester's: the fold is linear in requests, which is nothing at club scale
 * and stops being free eventually. The fix then is to run the same
 * `summarizeFund` on the server, not to write a second one in SQL.
 */
export interface TreasuryRepository {
  /** Every fund the club holds, including closed ones. */
  listFunds(clubId: string): Promise<Fund[]>;

  createFund(clubId: string, draft: FundDraft): Promise<Fund>;

  /**
   * Edits a fund's identity, period, or rules. Never its balance - money
   * enters a fund only through `allocate`.
   */
  updateFund(clubId: string, fundId: string, patch: FundPatch): Promise<Fund>;

  /**
   * Every allocation entry across the club's funds, newest first.
   *
   * Returned for the club rather than per fund because the summary folds over
   * all of them at once, and one round trip is cheaper than one per fund.
   */
  listAllocations(clubId: string): Promise<FundAllocation[]>;

  /**
   * Records money entering a fund: the initial grant, a top-up, or a
   * reduction as a negative amount.
   *
   * Append-only. There is no `updateAllocation` or `removeAllocation`, and
   * that absence is the whole point - correcting an entry means recording the
   * correction, so the original stays visible in the history.
   */
  allocate(
    clubId: string,
    fundId: string,
    draft: FundAllocationDraft,
  ): Promise<FundAllocation>;

  /** Every request the club has filed, newest first. */
  listRequests(clubId: string): Promise<ExpenseRequest[]>;

  /**
   * Files a request.
   *
   * `status` exists because the common path is a treasurer recording something
   * they have *already* sent to the university rather than drafting it here
   * first. Defaulting to `draft` and making every caller immediately patch
   * would add a round trip to model a step that did not happen.
   */
  createRequest(
    clubId: string,
    draft: ExpenseRequestDraft,
    status?: RequestStatus,
  ): Promise<ExpenseRequest>;

  /**
   * Applies a partial update, including status transitions.
   *
   * Status moves through here rather than through a transition endpoint,
   * because every transition is the treasurer recording something that already
   * happened at the university. An API shaped like a workflow engine would be
   * describing a system that does not exist.
   */
  updateRequest(
    clubId: string,
    requestId: string,
    patch: ExpenseRequestPatch,
  ): Promise<ExpenseRequest>;

  /**
   * Deletes a request that was never submitted.
   *
   * Drafts only. Anything the club actually asked for is cancelled instead, so
   * that "we asked and withdrew" stays distinguishable from "we never asked" -
   * a distinction an audit cares about and a delete would destroy. The API
   * enforces it; the port documents it so no implementation invents a laxer
   * rule.
   */
  removeRequest(clubId: string, requestId: string): Promise<void>;
}
