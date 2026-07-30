# @cos/core

Domain types, validation, and shared logic used by every app and service.

Rules:

- No I/O and no framework imports; this package must run anywhere (web, mobile, server).
- Never imports from an app or a service.

## What lives here

- `club-event.ts` - the `ClubEvent` / `EventDraft` model and its Zod schemas, plus pure date-grouping helpers. Instants are ISO 8601 strings with an offset, never `Date`.
- `role.ts` - club roles and the capability map. Consumers ask `can(role, 'event:create')` rather than comparing roles, so adding a third role is a change in one file.
- `ports.ts` - the `EventRepository` interface the apps depend on instead of a transport. Its `subscribe` method is the realtime seam.
- `announcement.ts` - `draftAnnouncement()`, which turns upcoming events into GroupMe message text. Lives here because the officer previewing the message and the bot sending it must produce identical output.

## Consumed as TypeScript source

`exports` points at `src/`, not a build output, so consumers compile it themselves
(`apps/web` does this via Next's `transpilePackages`). That keeps the dev loop
free of a build step while `packages/core` is the only shared package.
When `services/api` needs to run this in Node, add a real build and switch
`exports` to the built artifacts.
