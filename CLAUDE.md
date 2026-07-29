# COS project instructions

COS is an open-source connective layer for student clubs.
Read README.md and docs/ for the product and architecture; this file covers how to work in this repo.

## Session protocol (mandatory)

The gitignored `memory/` folder is the project's private working memory.
It is the source of truth for session-to-session continuity and must be maintained at every session open and close.

**On session start, before any other work:**

1. Read all four files in `memory/`: CHANGELOG.md, BACKLOG.md, ARCHITECTURE.md, DECISIONS.md.
2. If the user's request conflicts with something recorded there, surface the conflict instead of silently overriding it.

**On session close (when work wraps up, the user says goodbye, or asks to close out):**

1. Append a dated entry to `memory/CHANGELOG.md` describing what actually happened this session.
2. Update `memory/BACKLOG.md`: move finished items out, add newly discovered work, reorder priorities.
3. Update `memory/ARCHITECTURE.md` if the system's real state changed (new code, new packages, new infra).
4. Append to `memory/DECISIONS.md` for any decision made this session, with reasoning and revisit conditions.

Also perform the close protocol proactively at the end of any session that changed code or made decisions, without waiting to be asked.

Enforcement: hooks in .claude/settings.json flag any 5+ minute session that ends without updating memory/CHANGELOG.md by appending to memory/UNCLOSED.md, and surface that file at the next session start.
If memory/UNCLOSED.md exists, reconstruct the missing memory updates (git log, recent file changes) and delete it.

## The two ARCHITECTURE files

- `memory/ARCHITECTURE.md`: private working state, current reality, rough notes. Update freely.
- `docs/ARCHITECTURE.md`: public, polished record of settled decisions. Promote stabilized items from memory into it deliberately.

The same relationship holds for `memory/DECISIONS.md` (raw log) vs `docs/OPEN-QUESTIONS.md` (public open items): when an open question gets decided, log it in memory/DECISIONS.md, remove it from docs/OPEN-QUESTIONS.md, and record the settled choice in docs/ARCHITECTURE.md.

## Repo conventions

- `memory/` is gitignored and must never be committed or referenced from public docs.
- Monorepo rules: packages/core imports nothing from apps or services; apps talk to services only over the API.
- Every doc in docs/ follows one-sentence-per-line Markdown.
- License is AGPL-3.0 for all code in this repo; there is no proprietary directory.
