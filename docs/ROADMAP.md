# Roadmap

Phases are ordered by what they prove, not by feature count.
Each phase should ship something a real club can use on day one.

## Where things actually are

The phases below were **not built in order**, and this section records that rather than tidying it away.
The dashboard was pulled ahead deliberately: the calendar produces the events the GroupMe bot will announce, so building it first gives the bot something real to read instead of a fixture.
What followed used the same test - build the thing that makes the next thing worth having.

Built and running:

- Accounts, sessions, and per-club roles.
  Identity is better-auth; authorization is a capability check in `packages/core`.
- Club membership, officer positions, and invitations.
  Positions are job titles and deliberately grant nothing.
- A shared club calendar, live across members without a refresh.
- The document hub: authored text and uploaded files in one model, with append-only revisions and refusal of conflicting edits.
- The treasury, phase 1: funds, allocations, and a request pipeline with real encumbrance.
- A public landing page at `/`.

Not built yet, named here so the gap stays visible:

- The GroupMe bot service.
  A bot exists as a registered GroupMe entity and outbound posting is confirmed by hand, but nothing in this repo sends or receives a message.
- The integration hub's redirect tiles.
- Email delivery.
  Invitations are durable records delivered in-app, so an invitation to an address with no account waits until that person signs up.
- The treasury export, blocked on a real answer from a real university department rather than on engineering.
- Continuous integration.
  There are 380 tests and none of them run automatically.

## v0.1: GroupMe bot slice

The first vertical slice proves the integration story where members already live: the group chat.

- Club and member models in `services/api` (minimal: club, member, officer role). **Done.**
- `services/groupme-bot`: register a bot in a club's GroupMe, receive webhooks, send messages.
- Officer posts an announcement in COS, it lands in GroupMe.
- Bot commands in GroupMe (starting point: `!links`, `!events`) answered from COS data.
- One club page in `apps/web` showing the announcement history.

Exit criteria: one real club runs its announcements through COS for two weeks without asking members to install anything.

## v0.2: Integration hub

The one-stop-shop core.

- Club dashboard with redirect tiles: Notion, Box, Canva, GroupMe, arbitrary links.
- Club activity feed (who posted what, live).
- Member-facing club page requires no account for public content.

## v0.3: Document hub

**Shipped**, except for the bot integration, which waits on v0.1.

- Officer uploads, member downloads: waivers, forms, constitution. **Done.**
- S3-compatible storage, per-club permissions. **Done.**
- Append-only revisions covering authored text and replaced files alike. **Done.**
- Document links surfaced through the GroupMe bot (`!waiver`).

Simultaneous editing is specified but not built.
The version counter makes concurrent edits *safe* by refusing them; it does not make them *simultaneous*.

## v0.4: Auditable treasury

The differentiator, and partly shipped.

- Append-only allocation entries with corrections, never in-place edits. **Done.**
- A balance that is three numbers - allocated, committed, spent - so money already promised is visible before it is spent. **Done.**
- Evidence attachments against a request.
- Export formatted for university department audits.
  Deliberately not designed yet: the format has to come from a real department, and guessing produces a document nobody accepts.
- Activity log with the same append-only guarantees.

## Later, in no committed order

- Desktop app (Tauri shell over the web app).
- iOS / App Store, then mobile via Expo.
- Notion and Box API bridges (beyond redirects).
- Alumni support: directory, communication channel that survives officer turnover.
- Fundraising campaigns and tracking.
- Trip planning with waiver collection.
- Community service hour tracking.
- Hosted-service billing and per-tenant feature flags.
