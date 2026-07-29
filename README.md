# COS

![License](https://img.shields.io/badge/license-AGPL--3.0-green)
![TypeScript](https://img.shields.io/badge/typescript-5.x-blue)
![Status](https://img.shields.io/badge/status-early%20development-orange)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)

**Club Organizational Software** (working title): an open-source connective layer for student clubs.

Clubs already run on GroupMe, Notion, Box, and Canva, and those tools are good at what they do.
COS does not replace them.
It connects them into one place: a single dashboard where members find every link, see live club activity, download the documents they need, and where officers get the features those tools never cover, like auditable expense trails, waivers, alumni relations, and fundraising.

Built from real problems encountered while serving as president, VP, and treasurer of student clubs.

## Why

Every club officer inherits the same mess:

- Ten tools, none of them connected, and new members who can't find any of them.
- Expense records that can't survive a university department audit.
- Waivers, forms, and documents scattered across drives and group chats.
- Institutional knowledge that graduates with the officer who held it.

COS is the one-stop shop that sits on top of the existing stack instead of fighting it.
Low barrier of entry is the mantra: if a club only uses it as a page of redirects, that's already a win.

## Planned capabilities

| Area | What it does |
|---|---|
| Integration hub | One club page linking Notion, Box, Canva, GroupMe, and anything else the club already uses |
| GroupMe bot | Announcements pushed to chat, activity pulled back into COS (first vertical slice, see [roadmap](docs/ROADMAP.md)) |
| Live updates | Real-time feed of who is working on what |
| Document hub | Upload once, members download forever: waivers, forms, constitutions |
| Auditable records | Expense and activity trails exportable for university department audits |
| Club life | Trip planning, community service tracking, fundraising, alumni support |

## Architecture

A TypeScript monorepo targeting web first, then desktop (Tauri), then iOS/App Store and mobile (Expo), all reusing the same core packages.
The backend is a dedicated TypeScript API over Postgres, fully self-hostable.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full picture and the reasoning behind each choice.

## Project structure

```
apps/
  web/            Next.js web app (first platform)
packages/
  core/           Domain types and shared logic
services/
  api/            TypeScript API over Postgres
  groupme-bot/    GroupMe bot bridge (first vertical slice)
docs/
  ARCHITECTURE.md Stack decisions and system design
  ROADMAP.md      Phased plan, v0.1 onward
  INTEGRATIONS.md How each third-party connection works
  OPEN-QUESTIONS.md Decisions not yet made, and why they matter
```

## Status

Pre-alpha.
The structure and documentation exist; the code is being built in the open, starting with the GroupMe bot slice.
Watch the [roadmap](docs/ROADMAP.md) or the issues tab to follow along.

## Contributing

Contributions are welcome, from issue reports to pull requests.
Read [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

## License

[AGPL-3.0](LICENSE).
The entire codebase is open source.
The hosted service (dashboards and premium features run by us) is the paid product; the AGPL keeps that model honest by requiring anyone who hosts a modified COS to open their changes too.
