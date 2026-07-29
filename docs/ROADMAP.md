# Roadmap

Phases are ordered by what they prove, not by feature count.
Each phase should ship something a real club can use on day one.

## v0.1: GroupMe bot slice

The first vertical slice proves the integration story where members already live: the group chat.

- Club and member models in `services/api` (minimal: club, member, officer role).
- `services/groupme-bot`: register a bot in a club's GroupMe, receive webhooks, send messages.
- Officer posts an announcement in COS, it lands in GroupMe.
- Bot commands in GroupMe (starting point: `!links`, `!events`) answered from COS data.
- One club page in `apps/web` showing the announcement history.

Exit criteria: one real club runs its announcements through COS for two weeks without asking members to install anything.

## v0.2: Integration hub

The one-stop-shop core.

- Club dashboard with redirect tiles: Notion, Box, Canva, GroupMe, arbitrary links.
- Club activity feed (who posted what, live over WebSockets).
- Member-facing club page requires no account for public content.

## v0.3: Document hub

- Officer uploads, member downloads: waivers, forms, constitution.
- S3-compatible storage, per-club permissions.
- Document links surfaced through the GroupMe bot (`!waiver`).

## v0.4: Auditable treasury

The differentiator.

- Append-only expense ledger with correction entries, never in-place edits.
- Export formatted for university department audits.
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
