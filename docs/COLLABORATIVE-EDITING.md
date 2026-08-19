# Simultaneous editing

How two or more people edit one document at the same time, and what has to exist before they can.

This is a design note, not a built feature.
Phase 1 of the document hub ships storage, CRUD, and a concurrency control that makes multi-user editing *safe* without making it *simultaneous*.
This document explains the difference, why the phase 1 choice is the right floor to build on, and what the next step actually costs.

## Where phase 1 leaves us

A document carries a `version` that increments on every content change.
An edit sends the version it was based on, and the API refuses the write if the stored version has moved.

```
officer A reads v3 -> edits -> saves with expectedVersion=3 -> becomes v4
officer B reads v3 -> edits -> saves with expectedVersion=3 -> 409, told it is now v4
```

**What this solves:** the lost update.
Without it, B's save silently overwrites A's work and neither person ever learns that it happened.
That is the failure mode worth eliminating first, because it is silent, and silent data loss in a club's bylaws is the kind of thing discovered a year later.

**What this does not solve:** B still has to do something about the refusal.
Today the honest answer is "reload and reapply your changes", which is fine when two officers edit the same document a few times a semester and unacceptable when they are both typing into meeting notes during the meeting.

That second case is the real goal, and it is a different problem.
It is not a stricter version check - no amount of version checking turns a refusal into a merge.

## Why the obvious approaches do not work

**Last write wins.**
What we do not do, and the reason `expectedVersion` exists.

**Locking the document while someone edits it.**
Locks have to be released, so they need timeouts, and a timeout is either short enough to steal a lock from someone who is thinking or long enough to block a club for an hour after someone closed a laptop.
Locking also answers the wrong question: two people editing different paragraphs is the common case and should simply work.

**Polling the whole body, like the calendar does.**
`EventRepository.subscribe` re-sends the full ordered snapshot every 15 seconds, which is correct for a small list nobody is typing into.
For a document it is wrong twice over: it ships the entire body repeatedly, and a snapshot cannot express "insert three characters at offset 412" - so it either clobbers what the reader is typing or has nothing to merge with.
This is why `DocumentRepository` deliberately has no `subscribe` method.
Copying the calendar's seam here would have looked consistent and been wrong.

**Diff and three-way merge on save.**
Better than clobbering, and still batch-shaped: it resolves at save time rather than as people type, and it produces conflict markers a club officer is not going to reason about.

## The two real options

Both work by exchanging *operations* rather than documents.

### Operational Transformation (OT)

Clients send operations ("insert 'x' at 412"), and a central server transforms each incoming operation against the ones it has already accepted so that every client converges.
This is what Google Docs uses.

The transformation functions are the hard part: they must be correct for every pair of operation types, and getting one pair subtly wrong produces divergence that shows up rarely and cannot be reproduced.
OT also requires a central server to order operations, which is fine here since we have one.

### CRDTs

Conflict-free replicated data types make operations commutative by construction, so any order of delivery converges to the same document with no transformation step and no authoritative ordering server.
The cost is metadata: every character carries identity, so the document representation is larger than its text, and deleted characters leave tombstones that need periodic compaction.

**Recommendation: a CRDT, specifically [Yjs](https://github.com/yjs/yjs).**

The reasoning, in the order it matters for this project:

1. **The correctness burden is in a library rather than in our code.**
   A solo-maintained AGPL project cannot own a set of hand-written transformation functions.
   With a CRDT the merge rules are the data structure's, and they are exercised by every other user of that library.
2. **It survives the server being unavailable.**
   Offline edits merge when the client reconnects, with no special-case path.
   A student editing notes on campus wifi is the ordinary case, not an edge case.
3. **It has real editor bindings.**
   `y-prosemirror` and `y-codemirror` exist and are used in production; this is the difference between a month and a year.
4. **It does not require the server to understand the document.**
   The API relays and persists opaque updates, so the server stays simple and the editor can change without a protocol change.

Alternatives worth naming: [Loro](https://loro.dev) and [Automerge](https://automerge.org) are both credible and have better-documented internals; Yjs wins today on ecosystem maturity and editor bindings, which is what actually determines whether this ships.
Revisit if Yjs's binding for whichever editor we pick turns out to be the weak one.

## How it fits the schema that already exists

The phase 1 tables were built so this is additive, not a rewrite.

**`document_revisions` stays exactly as it is, and stays the audit ledger.**
It holds full snapshots, one per meaningful save, attributed to a person.
This is what answers "who changed the bylaws and what did they say before", and it is the thing a university department would be shown.
A CRDT update log cannot serve that purpose - it is a stream of character operations, not a sequence of readable versions.

**A new table holds the live editing state**, at a completely different write frequency:

```
document_crdt_updates
  id            text pk
  document_id   text not null -> documents(id) on delete cascade
  update        bytea not null      -- an opaque Yjs update
  authored_by   text -> user(id)
  created_at    timestamptz
```

Updates append as people type, and are periodically compacted: many small updates merge into one, and the resulting document state is materialised as text and written to `document_revisions` as a new version.
Compaction is what keeps the two models coherent - the ledger keeps getting readable versions, at human-meaningful intervals rather than per keystroke.

**`documents.version` keeps its current meaning** and continues to guard non-collaborative writes: the REST `PATCH` path, the GroupMe bot, and any future importer.
A document being edited live simply gets its version bumped by the compaction step rather than by a save button.
Nothing that exists today has to change its contract.

**Text stays materialised in `document_revisions.content`.**
Search, export, the announcement drafter, and every non-browser reader want text, not a CRDT.
Keeping the materialised form is what stops the CRDT from becoming the only way to read a document.

## Transport

A WebSocket per open document, carrying two channels:

- **Document updates**, which are persisted and broadcast to everyone else on that document.
- **Awareness** - cursor position, selection, display name, colour - which is broadcast and never persisted.
  Awareness is what makes collaboration feel collaborative, and it is also the part that must not touch the database.

Hono supports WebSockets natively through `@hono/node-server`'s `upgradeWebSocket` (not the older `@hono/node-ws`, which is deprecated), so this lives in `services/api` rather than becoming a fourth service.
That matters for the self-hosting story: `docker compose up` should not grow another container for this.
The canvas's live presence feature (shipped 2026-08-19) is the first real use of this mechanism in the repo, for exactly the "awareness, broadcast and never persisted" half of this design - a real reference to work from once this feature is built.

**Authorization is checked at connection time and is the same check as everywhere else.**
`document:edit` for a writable connection, `document:view` for a read-only one, resolved from `club_members` exactly as `requireCapability` does today.
Two things are easy to get wrong here and should be written down before anyone implements it:

1. A capability check at connect time is not enough on its own, because membership can be revoked while a socket is open.
   Re-check on a timer, and close sockets for a member who has been removed.
2. Draft visibility must hold on the socket as well.
   `canSeeDraftDocuments` gates the REST read; a socket that streams a draft to a member would route around it.

## What it would take, in order

1. **Pick the editor.** ProseMirror via Tiptap is the likely answer, because the hub wants real rich text and `y-prosemirror` is the most exercised binding.
   This is the decision everything else depends on, and it is a product decision as much as a technical one.
2. **Add the update log and the WebSocket endpoint.** Relay and persist opaque updates; no server-side document understanding yet.
3. **Add awareness.** Cursors and presence, broadcast only.
4. **Add compaction.** Merge updates, materialise text, write a revision. This is where the ledger and the live state reconcile, and it is the step most likely to be deferred and most likely to be regretted if it is.
5. **Reconcile the REST path.** Decide what `PATCH .../documents/{id}` means for a document with a live session - most likely: it still works, and its result is folded in as an update by whichever client holds the document.

## Open questions

- **Does every document need this, or only some sections?**
  Meeting notes obviously want it.
  The constitution is edited twice a year by one person and arguably wants the opposite - deliberate, single-writer, heavily audited edits.
  Making collaboration a per-document property rather than a global mode is probably right and is not free.
- **How long is the update log kept after compaction?**
  Keeping it forever makes undo across sessions possible and grows without bound.
- **What happens to a file document?**
  Nothing: a PDF cannot be co-edited, and the answer for those stays "upload a new revision".
  Worth stating so nobody tries to unify the two paths.
- **Is a self-hoster required to run this?**
  If the WebSocket endpoint is optional, the hub has to degrade to phase 1's version check cleanly rather than appearing broken.
