# @cos/api

The COS API service: auth, clubs, members, documents, the append-only audit ledger, and the WebSocket activity feed.
TypeScript over Postgres; fully self-hostable.

Hono, Drizzle, and better-auth, with the REST contract documented as OpenAPI generated from the Zod schemas in `@cos/core`.
See [ARCHITECTURE.md](../../docs/ARCHITECTURE.md) for why each was chosen.

## Running it

```sh
docker compose up -d postgres    # from the repo root
cp .env.example .env             # then fill in BETTER_AUTH_SECRET
pnpm db:migrate
pnpm db:seed                     # optional: a demo club, an officer, a member
pnpm dev
```

The service listens on port 3200.
`openssl rand -base64 32` generates a suitable `BETTER_AUTH_SECRET`.

| URL | What |
|---|---|
| `/health` | Liveness; does not touch Postgres |
| `/health/ready` | Readiness; 503 when the database is unreachable |
| `/docs` | Browsable API reference |
| `/openapi.json` | The generated spec |
| `/api/auth/*` | Owned entirely by better-auth |
| `/api/session` | The signed-in user and their club memberships |

## Scripts

| Script | What |
|---|---|
| `pnpm dev` | Watch-mode server |
| `pnpm db:generate` | Write a migration from schema changes. Does not need a running database |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:studio` | Browse the database |
| `pnpm db:seed` | Development data; refuses to run in production |

## How auth is put together

better-auth owns identity and nothing else: users, credentials, and sessions.
It is mounted as a single handler over `/api/auth/*` rather than route by route, so upgrading it never turns into a routing exercise.
Sessions are an httpOnly cookie backed by a database row, so they can be revoked.

Authorization is **not** better-auth's.
`can(role, capability)` lives in `@cos/core` and is enforced here by `requireCapability()`, which reads the caller's role from `club_members` for the club a request names.
The same check runs in the browser to decide whether to render a control, but only the server-side one protects anything.

Clubs and membership are our own tables rather than better-auth's organization plugin, because that plugin tracks one active organization per session and members belong to several clubs at once.
The cost is that invitations, member removal, and role changes are ours to write.

### Regenerating the auth schema

`src/db/schema/auth.ts` is better-auth's, and should be treated as generated:

```sh
pnpm exec better-auth generate --config src/auth/auth.ts
```

Diff the output against the file on a better-auth upgrade rather than patching it by hand, then `pnpm db:generate` for the migration.

## Migrations

Migrations are plain SQL in `drizzle/`, committed and reviewed.
They run against self-hosters' databases, so they are generated and read rather than pushed as schema diffs.

`db:migrate` is a separate command rather than something the server does at boot: several API instances starting at once would race to migrate the same database.
