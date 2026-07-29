# @cos/groupme-bot

The GroupMe bridge and the first vertical slice of COS (v0.1).

- Pushes COS announcements into a club's GroupMe via the [bot API](https://dev.groupme.com/tutorials/bots).
- Receives group messages on a callback URL and answers commands (`!links`, `!events`) from COS data.
- Talks to `services/api`; owns no data of its own.

See [docs/INTEGRATIONS.md](../../docs/INTEGRATIONS.md) for the integration design and [docs/ROADMAP.md](../../docs/ROADMAP.md) for the v0.1 exit criteria.
