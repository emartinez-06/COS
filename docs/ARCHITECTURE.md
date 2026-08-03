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
| API | Dedicated TypeScript service on [Hono](https://hono.dev) | Self-hostable with no vendor coupling; the API is a hard boundary so every future platform is just another client. Web-standard `Request`/`Response` keeps the server portable and lets auth mount without adapter glue |
| API contract | REST, with OpenAPI generated from the `packages/core` Zod schemas | A self-hosted product needs a discoverable, documented contract; the schemas that already validate the domain generate it |
| Database | Postgres | Relational integrity for the audit ledger, row-level multi-tenancy, boring and proven |
| Data access | [Drizzle](https://orm.drizzle.team) | SQL-shaped, so the append-only ledger and `club_id` filtering stay legible; generates plain-SQL migrations that can be reviewed in a diff before they run against a self-hoster's database |
| Auth | [better-auth](https://better-auth.com) for identity; authorization stays in `packages/core` | A library, not a service, so self-hosting is inherent and its tables live in our Postgres. Sessions are cookie plus database row, so they are revocable |
| File storage | S3-compatible object storage | Document hub needs blob storage; S3 compatibility means AWS, R2, or MinIO (self-hosted) all work |
| Realtime | WebSockets from the API | Live updates feed; no third-party realtime dependency |
| Deployment | Docker Compose | `docker compose up` must bring up a complete self-hosted instance |

### Why not tRPC

tRPC and Hono's RPC client both deliver end-to-end type safety by coupling the client to the server's TypeScript types.
That contradicts the hard-boundary rule above: it produces no contract an Expo app, a Tauri shell, a self-hoster, or a third-party integrator can read.
Generating OpenAPI from the Zod schemas costs a little more ceremony per route and yields a documented API plus a generated typed client.

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

The same rule is applied one level down for anything else a surface could become coupled to.
The marketing site's scroll animation, for instance, sits behind a single module so the page asks for the behaviour it wants and never names the library providing it.
That is what makes the animation engine a replaceable detail rather than a decision baked into every component that moves.

### The public site is a route group, not a second app

`apps/web` serves both the marketing site at `/` and the product behind it.
The landing page is a Next route group, which adds no path segment, so the two share one theme, one build, and one deployment.

The reason is that the theme is a generated artifact compiled from a single source file.
A separate marketing app would have to duplicate that pipeline, or the tokens would have to be extracted into another package, to buy an independent deploy cadence that nothing currently needs.

This is deliberately *not* the mechanism that keeps the frontend decoupled for future platforms.
That job belongs to `packages/core` and the API: a desktop or mobile client reuses the domain model and the HTTP contract, and a marketing page is not something it would ever ship.
Splitting the marketing site out would answer a question nobody asked while leaving the real coupling untouched.

One consequence worth stating, because it looks like an oversight otherwise: visiting `/` while signed in shows the marketing page rather than redirecting to the dashboard.
The session cookie belongs to the API's origin, so the web origin cannot read it during server rendering, and resolving it on the client means showing the landing page first and replacing it a moment later.
The navigation adapts its call to action instead, which costs nothing and flashes nothing.

### Permissions are capabilities, not roles

Components ask whether the current viewer *may do a thing* (`can(role, 'event:create')`), never what role they hold.
Roles are per-club and the set will grow past officer and member, so the role-to-capability mapping lives in exactly one place in `packages/core`.

The capabilities themselves are declared as a statement object of resources and actions:

```ts
export const STATEMENT = {
  event: ['create', 'edit', 'delete', 'view'],
  announcement: ['draft'],
} as const;
```

This is plain data with no library import, so `packages/core` stays dependency-free and the mapping can be consumed by anything.

### Identity and authorization are separate systems

The line between them is deliberate, because only one of the two is genuinely hard.

**better-auth owns identity**: users, credentials, and sessions.
It is a library rather than a service, so its tables live in our own Postgres and self-hosting needs no extra container.
Sessions are a cookie plus a database row rather than a JWT, so they can be revoked and so server rendering can read them directly.

**`packages/core` owns authorization**: `can(role, capability)` and nothing else.

This follows from the member model rather than being an independent preference.
better-auth's access control is part of its organization plugin: it reads a role from that plugin's `member` table, scoped to a single active organization per session.
Because clubs are our own tables (see below), there is no such table for it to read, so its access control was never available to us.

The deeper reason it belongs here anyway is that authorization is domain logic.
"An officer may draft an announcement" is a rule about clubs, and it will grow into rules like "a treasurer may approve expenses under a threshold".
Those belong with the domain model, not in a session library's configuration.

Separating authentication from authorization is the ordinary practice, not a deviation from it.
The parts that are genuinely dangerous to implement yourself - password hashing, session issuance and revocation, cookie attributes, CSRF - all belong to better-auth.
What stays here is a lookup from a role to a set of capabilities, with no cryptography and no subtle failure mode.

Authorization is enforced in the API, against the role on the requesting user's membership row for the club the request touches.
The client-side check exists to hide controls a viewer may not use, never to protect anything.

The failure mode to guard against is not which module owns the permission map; it is a route that forgets to ask.
That risk is the same whatever library is used, so enforcement belongs at the router and is worth testing directly.

### The member model is person-first

A person holds one account and belongs to many clubs, with a role in each:

```
users         better-auth's; identity only
clubs         ours
club_members  ours; (user_id, club_id, role)
```

This is the shape where multi-club membership and the eventual alumni role fall out of the schema instead of requiring a migration.

Clubs are deliberately **not** modelled as better-auth organizations.
That plugin tracks a single active organization per session, which suits a workspace switcher and fights a student who wants one merged calendar across four clubs.
The cost of owning these tables is that invitations, member removal, and role changes are ours to write.

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
