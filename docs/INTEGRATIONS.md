# Integrations

COS treats every third-party tool the same way: connect, never replace.
Each integration is classified as a redirect, a bridge, or an embed (see [ARCHITECTURE.md](ARCHITECTURE.md)), and every tool starts life as a redirect before earning anything deeper.

## GroupMe (bridge, v0.1)

The first and deepest integration, built as `services/groupme-bot`.

- **Outbound**: officers post announcements in COS; the bot posts them to the club's GroupMe via the [bot API](https://dev.groupme.com/tutorials/bots).
- **Inbound**: GroupMe delivers every group message to the bot's callback URL; the bot answers commands (`!links`, `!events`, `!waiver`) from COS data.
- **Setup**: a club officer connects their GroupMe account, picks the group, and COS registers the bot. No member has to install or sign up for anything.

Open items are tracked in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md): rate limits, webhook reliability, and the fallback if GroupMe's stagnant API degrades.

## Notion (redirect now, embed later)

- **Now**: dashboard tile linking to the club's Notion workspace or specific pages.
- **Later**: render selected public Notion pages inside the club page via the Notion API, so meeting notes and wikis are readable without leaving COS.

## Box (redirect now, embed later)

- **Now**: dashboard tile linking to the club's Box folders.
- **Later**: browse and fetch shared folder contents through the Box API, so the COS document hub and the club's existing Box coexist instead of competing.

## Canva (redirect)

Dashboard tile to the club's Canva team or template folder.
Canva's API surface for this use case is thin; redirect is likely the permanent form, and that is fine.

## Everything else

Any URL can be a dashboard tile.
A club's payment link, sign-up sheet, or league page gets the same treatment as the named tools above.
The bar for promoting a redirect to a bridge or embed: a real club asks for it, and the tool's API makes it maintainable.
