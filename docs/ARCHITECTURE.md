# Architecture

This document records the stack decisions made at project start, the reasoning behind them, and the system shape they imply.
It should change when reality proves a decision wrong, not silently drift.

## Platform trajectory

COS ships in this order:

1. **Web app**: the primary product and the only target for v0.x.
2. **Desktop app**: a [Tauri](https://tauri.app) shell around the same web frontend.
3. **App Store (macOS/iOS)**: distribution of the above through Apple's store.
4. **Mobile app**: React Native via [Expo](https://expo.dev), reusing `packages/core` and the API client.

This ordering is why the repo is a monorepo from day one.
Retrofitting shared packages into a standalone Next.js app when the desktop phase arrives would mean a restructuring release; starting with the split costs almost nothing now.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One language across web, desktop shell, mobile, API, and bot maximizes code reuse and keeps contributor barrier low |
| Web frontend | Next.js (React) | First-class web experience, SEO for public club pages, largest contributor pool |
| Design system | [Astryx](https://github.com/facebook/astryx) (`@astryxdesign/core`) | 90+ accessible, themeable components so the UI is composed rather than hand-rolled; ships prebuilt CSS, so it adds no compiler to the build |
| API | Dedicated TypeScript service | Self-hostable with no vendor coupling; the API is a hard boundary so every future platform is just another client |
| Database | Postgres | Relational integrity for the audit ledger, row-level multi-tenancy, boring and proven |
| File storage | S3-compatible object storage | Document hub needs blob storage; S3 compatibility means AWS, R2, or MinIO (self-hosted) all work |
| Realtime | WebSockets from the API | Live updates feed; no third-party realtime dependency |
| Deployment | Docker Compose | `docker compose up` must bring up a complete self-hosted instance |

### Choices deliberately not made yet

Framework-level choices inside the API service (Fastify vs Hono vs NestJS, ORM vs query builder, tRPC vs REST vs both) are recorded in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) and get decided when the first API code lands, not before.

## Monorepo layout

```
apps/web            Next.js app; talks only to services/api
packages/core       Domain types, validation, shared logic; no I/O, no framework imports
services/api        The API: auth, clubs, members, documents, audit ledger, WebSocket feed
services/groupme-bot GroupMe webhook receiver and message sender; talks to services/api
```

Rules that keep this healthy:

- `packages/core` never imports from an app or service.
- Apps never import from services; they go through the API over HTTP/WS.
- Every service is independently runnable and independently deployable.

Workspace tooling is pnpm workspaces.
Task orchestration (Turborepo or plain pnpm scripts) is an open question until there are enough packages for it to matter.

### Apps depend on ports, not transports

`packages/core` declares interfaces for the data an app needs, and apps import only those interfaces.
`EventRepository` is the first: the calendar UI knows how to list, create, and subscribe to events, and knows nothing about where they live.

This is what makes the boundary rules above enforceable rather than aspirational.
It also lets a surface be built and reviewed before the transport behind it exists, which is how the club calendar shipped ahead of the API.
Ports carry a `subscribe` method where live updates matter, so one interface covers both a local store and a WebSocket feed.

The rule to hold to: swapping an implementation must not change a component.
If it would, the port is wrong and gets fixed rather than worked around.

### Permissions are capabilities, not roles

Components ask whether the current viewer *may do a thing* (`can(role, 'event:create')`), never what role they hold.
Roles are per-club and the set will grow past officer and member, so the role-to-capability mapping lives in exactly one place in `packages/core`.

## Integration philosophy

COS connects to the tools clubs already use rather than replacing them.
Concretely that means each integration is one of:

- **Redirect**: a link on the club dashboard (zero API work, always the starting point).
- **Bridge**: two-way sync through the tool's API (GroupMe bot is the first).
- **Embed**: the tool's content surfaced inside COS (Notion pages, Box folders) where their APIs allow.

Each integration lives behind an interface in `packages/core` so the dashboard renders them uniformly and new ones plug in without touching app code.
Details per tool live in [INTEGRATIONS.md](INTEGRATIONS.md).

## Multi-tenancy and the audit trail

Two requirements shape the data model more than anything else:

**Multi-tenancy.**
Every row that belongs to a club carries the club's id, enforced at the API layer.
A member can belong to many clubs; officers have per-club roles.

**Auditability.**
Expenses and official activity are append-only.
Corrections are new entries referencing the entry they correct, never updates in place.
This is what makes the export credible to a university department: the ledger shows what was recorded and when, including mistakes and their corrections.

## Open source and the paid layer

The whole repo is AGPL-3.0.
The commercial product is the hosted instance: managed dashboards, premium features, and zero-setup onboarding.
There is no proprietary `/ee` directory; the AGPL's network clause is what protects the hosted business from closed-source resellers.
Paid features are feature-flagged per tenant in the hosted deployment, but their code is in this repo and self-hosters get them by running it themselves.
