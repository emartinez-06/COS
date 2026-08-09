# Deployment, scale, and what production actually requires

This document answers three questions that were asked together and are usually answered together badly: how COS runs when it is deployed, what breaks first as it grows, and what stands between the current code and something a real club could depend on.

It is written to be acted on rather than admired.
Where something is not built, it says so.

## 1. What COS is, as a deployable thing

Four processes and two stateful services.

| Piece | What it is | State |
|---|---|---|
| `apps/web` | Next.js 15, App Router. Renders every screen. | None |
| `services/api` | Hono. Owns the database, sessions, and object storage. | None |
| Postgres 17 | Every club's real data. | **All of it** |
| S3-compatible storage | Uploaded document bytes. MinIO locally, R2 or S3 in production. | **Bytes** |
| `services/groupme-bot` | Not built. A stub `package.json` and a README. | - |

The important property is that **only Postgres and the object store hold anything**.
Both web and API are stateless, so scaling either is running more of them behind a load balancer, and losing one costs nothing but the in-flight requests.

### The one piece of shared state that is not in Postgres

Sessions are database-backed, not JWTs.
That was chosen so they can be revoked, and the cost lands here: every request that needs a session does a database read.
It is a cheap indexed read, and it means a second API instance needs no sticky sessions and no shared cache to work.

## 2. The recommended target

**A single small VPS running the existing `docker-compose.yml`, behind Caddy or nginx for TLS.**

This is not the most impressive answer and it is the right one, for a specific reason: the product's distribution story is self-hosting under AGPL, and the deployment a university club can actually run is one box with a compose file.
If the hosted service and the self-hosted path diverge, the self-hosted path is the one that rots, and it is the one the licence exists to protect.

Concretely, per host:

- `docker compose up -d` brings up Postgres and MinIO (or point `STORAGE_*` at R2 and drop MinIO).
- `pnpm --filter @cos/api db:migrate` applies the committed SQL migrations.
- The API runs `node dist/index.js`, not `tsx watch`.
- The web app runs **`next start`**, not `next dev`. This matters more than it sounds: `next dev` recompiles per request, ships no optimised bundles, and exposes a dev overlay.

### What was considered and rejected

**Cloudflare Workers.** Hono runs there beautifully and it was the tempting answer.
It fails on data: the schema is Drizzle-pg with real Postgres types and enums, D1 is SQLite, and moving would be a rewrite of the storage layer rather than a deploy target.
Hyperdrive plus a hosted Postgres would work, but then the "one box a club can run" story is gone and nothing has been gained.

**A Cloudflare tunnel.** Worth naming because it has come up twice and it is not hosting.
A tunnel reverse-proxies to processes already running on somebody's laptop.
It is fine for showing someone the product and it is not a service - when the laptop sleeps, the club's calendar is down.

## 3. What breaks first, in order

This is the part worth being concrete about, because "how does it scale" is usually answered with architecture when the real answer is arithmetic.

The unit that matters is **clubs**, and a club is roughly 30 members, a few hundred events a year, a few dozen documents, and one or two funds.
This is a small-data product. The scaling risks are not about data volume.

### First: the polling, and it is the only near-term one

Three things poll today.

| What | Period | Requests per member per hour |
|---|---|---|
| Event subscription (calendar open) | 15s | 240 |
| Presence heartbeat | 30s | 120 |
| Presence roster | 60s | 60 |
| Invitation check | 60s | 60 |

A member with the calendar open costs roughly **480 requests an hour**, nearly all of which return data identical to the previous one.
At 30 members that is 14,400 requests an hour per club, and it grows linearly with membership whether or not anything is happening.

All of it pauses while the tab is hidden, which is the single biggest mitigation and is already implemented.

**The fix, when it is needed, is not more instances.** It is replacing the transport with one that pushes: SSE for the calendar and presence, which is a change confined to `HttpEventRepository#poll` and the presence store because both were deliberately built behind a seam.
The trigger to do it is not a member count - it is when the API's request volume is dominated by responses that changed nothing.

### Second: presence writes

Every heartbeat is an `UPDATE` on `user_presence`.
That is one row per person per 30 seconds, and unlike every other write in this product it is not append-only - it rewrites the same row forever, which produces dead tuples at a steady rate.
Postgres autovacuum handles this fine at club scale.
At a scale where it does not, presence is the textbook case for Redis rather than a table, and the resolution rule already lives in a pure function (`resolvePresence`) so moving where the row is stored does not change what a status means.

### Third: the client-side folds

Two things are computed in the browser over the club's full data: the treasury balance (`summarizeFund`) and the search index.
Both load every relevant row for the club.
Both are correct and cheap for a semester of data, and both are linear.
The recorded plan for the treasury is to run *the same* function server-side rather than write a second implementation in SQL, and that plan holds.

Search additionally caches records for the session, so a record created elsewhere is not findable until reload - stated in the code, and the thing to fix first if search ever feels wrong.

### What is not a scaling risk

Document storage, because bytes go to object storage and only metadata is in Postgres.
The number of clubs, because every query is already filtered by `club_id` and the indexes exist.
Read volume on documents and the treasury, because those load once per navigation rather than on a timer.

## 4. What stands between this and production

Ordered by what would hurt soonest.

### Blocking

1. **`next dev` is not a production server.** See above. Nothing enforces this yet; it is a deployment discipline.
2. **No email delivery.** Password reset, email verification, and invitation delivery all depend on a transactional email provider that does not exist. Today an invitation to somebody with no account sits until they happen to sign up.
3. **Rate limiting is in-memory.** It now exists and works (below), but each API process keeps its own counter and a restart clears it. Correct for one instance, wrong for two. The fix is `storage: 'database'`, one line, to be done when a second process is - not before.

### Should be decided before exposure

5. **`/docs` and `/openapi.json` answer anonymously.** Fine for an open-source project, worth being a decision rather than an accident.
6. **Backups.** There is no backup story at all. For a product whose stated value is being a club's durable record across officer turnover, this is the gap that most contradicts the pitch. `pg_dump` on a schedule to object storage is enough to start.
7. **No error tracking or uptime monitoring.** Nobody would know the API was down except a member who tried to use it.

### Landed in this session

- **CI exists** (`.github/workflows/ci.yml`): typecheck, tests, and a production `next build` on every push and pull request, with Postgres and MinIO service containers pinned to the compose versions. This was the documented trigger for reconsidering direct-to-`main`, and it is now met.
- **Sign-in is rate limited**, explicitly and in every environment rather than only in production: 10 attempts a minute on `/sign-in/email`, 5 sign-ups an hour. Verified by running 15 consecutive failed sign-ins - ten `401`s then `429`. The same check before this change returned fifteen `401`s and no `429`.
  The API test suite is unaffected because it calls `auth.api.signUpEmail()` directly rather than over HTTP, so the limiter's request middleware never sees it.
- **The seed's guard is now an allowlist.** It previously refused only when `NODE_ENV === 'production'`, and `NODE_ENV` defaults to `development` - so deploying without setting it would have seeded a public database with credentials published in this repository. It now requires `development` or `test` explicitly.
  The credentials themselves are still in the repository and still public; what changed is that forgetting an environment variable no longer installs them.

## 5. Environments

Two `.env` files, per the existing per-service convention, with real values filled in by hand and never pasted through chat.

What changes between development and production:

| Variable | Development | Production |
|---|---|---|
| `NODE_ENV` | `development` | `production` (turns on better-auth's rate limiting) |
| `DATABASE_URL` | compose Postgres | managed or host Postgres, TLS required |
| `BETTER_AUTH_SECRET` | anything | a real generated secret, rotated if leaked |
| `BETTER_AUTH_URL` / `WEB_ORIGINS` | localhost ports | the real origins, exactly - this is the CORS boundary |
| `STORAGE_*` | MinIO | R2 or S3 |

**One cross-origin note that will come up.** The session cookie is issued by the API on its own origin, and the web app runs on another.
That is why `/` cannot redirect a signed-in visitor server-side, and it is why `WEB_ORIGINS` has to be exact.
Serving both under one origin - the API proxied under the web app at `/api` - would remove that whole class of problem and is worth doing before public launch rather than after.

## 6. The honest summary

The application layer is in good shape: authorization is enforced at the API on every route, the failure modes have been reasoned about, and there are 465 tests that now actually run.

What is missing is not application code.
It is the operational shell around it - credentials, rate limiting, backups, email, monitoring - and none of it is hard.
It has simply never been done, because until now nothing was deployed.
