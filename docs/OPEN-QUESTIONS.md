# Open questions

Decisions that shape the product but are not yet made.
Each entry says why it matters and when it must be answered.
When a question is decided, move the decision (with reasoning) into [ARCHITECTURE.md](ARCHITECTURE.md) or the roadmap and delete it here.

## Product

**What is the real name?**
COS is a working title.
Needs answering before any public launch, domain purchase, or App Store listing.
Check trademark conflicts and domain availability before attaching to a name.

**Baylor-first or university-agnostic from day one?**
The audit-export feature is shaped by what Baylor departments accept.
Building Baylor-first gives a concrete customer and real validation; staying agnostic avoids baking one university's process into the data model.
Leaning: Baylor-first for validation, but keep university-specific bits (export formats, org verification) behind interfaces.
Must be answered by v0.4 (treasury).

**Who is the account holder: the club or the person?**
A member belongs to multiple clubs and eventually graduates into an alumni role.
If accounts are person-first, alumni support falls out naturally; if club-first, onboarding is simpler.
Leaning: person-first accounts with per-club membership and roles.
Must be answered in v0.1 (it is the member model).

**What exactly is paywalled?**
"Dashboards and some features" needs a concrete line before hosted billing exists (post-v0.4).
The line must not undermine the low-barrier mantra: the free tier has to be genuinely useful, not a demo.

**Do waivers need legally binding e-signatures?**
If yes, that likely means integrating a signature provider rather than building one, and possibly legal review.
If a stored PDF plus an acknowledgment click is enough for club trips, the document hub covers it.
Must be answered before trip planning ships.

## Technical

**API framework and data access.**
Fastify vs Hono vs NestJS; Drizzle vs Prisma vs plain SQL; tRPC vs REST vs both.
Decided by whoever writes the first API code in v0.1, recorded in ARCHITECTURE.md.

**Auth.**
Roll session auth in the API vs an open-source identity layer (e.g. better-auth, Lucia-style patterns) vs a hosted provider.
Constraints: must work self-hosted, must eventually support university SSO (SAML/CAS) because that is how universities verify students.
Must be answered in v0.1.

**GroupMe API limits.**
The bot API is free but rate limits, webhook reliability, and the OAuth story for club owners need verification against the real API before v0.1 is scoped in detail.
GroupMe's API has been stagnant for years; document a fallback position (SMS? Discord bridge?) if it degrades.

**Realtime scale model.**
Plain WebSockets from a single API instance is fine for a long time.
Decide the fan-out story (Postgres LISTEN/NOTIFY vs Redis pub/sub) only when a second API instance is actually needed.

**Where does the hosted instance run?**
Fly.io, Railway, a VPS, or a cloud provider.
Constraint: whatever is chosen, `docker compose up` must remain a first-class path so self-hosting never rots.
Must be answered before v0.2 has outside users.

## Legal and organizational

**Data privacy obligations.**
Club rosters of university students may touch FERPA depending on what data flows in, and definitely touch state privacy laws if this grows.
Needs a real read before storing anything beyond emails and names, and certainly before alumni data.

**Payment processing for fundraising.**
Handling money directly means Stripe (or similar) plus terms-of-service review; university clubs often have rules about who may collect funds.
Fundraising should likely start as tracking and links to existing processors, not payment custody.

**Contributor license posture.**
AGPL plus a CLA would let the project dual-license later; AGPL without a CLA locks the project itself to AGPL forever (every contributor holds copyright).
No CLA is the simpler, more credible default.
Must be consciously confirmed before accepting substantial outside contributions.
