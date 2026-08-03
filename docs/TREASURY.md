# The treasury

What the expenses surface is for, what it has to model, and what it should never try to be.

This is a design note, not a built feature.
`/expenses` is currently a placeholder with an honest empty state.
The capabilities (`expense:create|edit|delete|view`) exist and are officer-only; no route consumes them yet, so the gating is client-side only.

The design below comes from a real treasurer's workflow at a university cybersecurity club, which is worth stating up front because it contradicts the obvious design.

## What a club treasurer actually does

The club was allocated $1,500 from a dean's fund, covering two semesters.
When the club wanted something, the treasurer filled in a qualitative form justifying the request.
A university administrator, not anyone in the club, reviewed it and bought the item directly.
The club then received a confirmation email with the order confirmation, or a follow-up asking for more detail.

Read that again for what is absent.
There is no bank account.
No money ever enters or leaves the club's control.
Nobody in the club holds a card, writes a cheque, or reconciles a statement.

## Why this is not expense tracking

Expense tracking assumes custody.
You hold funds, you spend them, you record what you spent, and you reconcile against a statement that some bank considers authoritative.
That is Mint, QuickBooks, Splitwise, and roughly every product with "expense" in the name.

A student club under a dean's fund has none of those things.
What it has is an **allocation** and a **request pipeline**.
The club's records are a shadow copy of a ledger the university owns, and the treasurer's real job is to know how much of the allocation is still askable-for, and to be able to prove where the rest went.

This distinction decides the data model.
Build a checkbook and you will model transactions that never happened, reconcile against a statement that does not exist, and have nowhere to put the three weeks between "we asked" and "it arrived".
That gap is where the whole feature lives.

## The three numbers

The single most useful thing this feature can do, and the thing a spreadsheet reliably gets wrong.

A treasurer looks at a sheet that says `spent: $400 of $1,500` and approves a $400 request, because $400 is obviously affordable against $1,100 remaining.
The problem is that two other requests are already sitting with the dean's office, unfulfilled, for $400 each.
The club has now asked for $1,600 of a $1,500 fund, and nobody will find out until an administrator declines the third one, usually the week of the event.

So the balance is not one number.
It is three:

| Number | Meaning |
| --- | --- |
| **Allocated** | What the club was given. $1,500. |
| **Committed** | Submitted or approved, not yet purchased. Spoken for, not yet gone. |
| **Spent** | Actually purchased, confirmed by evidence. |

And the number the treasurer actually needs is the derived one:

```
available = allocated - committed - spent
```

This is encumbrance accounting, and it is exactly what university finance offices themselves do.
It falls directly out of the workflow: there is a real delay between submitting a request and the purchase landing, and during that delay the money is neither available nor spent.
A model with only "spent" has nowhere to represent a request in flight, which is precisely the state that causes overspending.

**Nothing in the product should ever display a bare "remaining" figure without distinguishing committed from spent.**
A treasurer who sees `$1,100 remaining` and does not know that $800 of it is already promised has been actively misled by their own tool.

## The model

### Funds

A **fund** is one source of money with its own rules.

- Name and source. "Dean's Fund 2026-27", "Fall dues", "ACM sponsorship", "Department travel match".
- A period, as an explicit start and end date on the fund itself.
- Restrictions, as text. Dean's funds commonly forbid alcohol, gifts, and personal equipment; dues usually do not.
- Whether unspent money expires.

**There is deliberately no semester entity**, which corrects the earlier assumption in the backlog that an opening balance is "per club per semester".
The founding use case already breaks it: one $1,500 fund spanning two semesters.
Dues run per semester, a sponsorship might run a calendar year, and a conference travel grant is a one-off with a hard deadline.
A global semester calendar forces every fund into one shape and breaks on the first one that does not fit, whereas a date range on the fund handles all of them.

Clubs do think in semesters, and "what did we spend this fall" is a fair question.
That is a **reporting view over date ranges**, not a storage concept.

A club will have more than one fund, and the restrictions differ per fund, so "which fund does this come out of" is a real question a request has to answer.

### Requests

A **request** is the unit of work, not a transaction.
An expense in this world has a life before it is an expense.

- Which fund it draws against.
- Title and the qualitative justification. This is the university's form, and it is the part that takes a treasurer the longest.
- Requested amount, and separately the **actual** amount once known.
- Category: food, supplies, printing, travel, equipment, fees.
- **The event it is for**, as a real link to the calendar.
- Needed-by date, since administrators need lead time.
- Who submitted it, and when.

Requested and actual are two fields on purpose.
The request says $50 for pizza and the administrator spends $47.83.
Collapsing them into one field means either the books drift from reality or the original ask is destroyed, and the original ask is what the club is held to.

The link to a calendar event is the most product-specific idea in this document.
COS already owns the club's calendar, so "$120, food, for the October 14 general meeting" can be a real relationship rather than a string someone typed.
It makes the audit export self-explanatory, it lets an event show what it cost, and it is the thing a spreadsheet structurally cannot do.
This is what "connective layer" is supposed to mean in practice.

### The lifecycle

```
draft ──> submitted ──> approved ──> purchased ──> settled
   │           │            │
   │           └──> denied  └──> denied
   └──> cancelled
```

How each state maps onto the three numbers:

| State | Effect |
| --- | --- |
| `draft` | None. Not yet asked for. |
| `submitted` | **Committed** at the requested amount. |
| `approved` | **Committed**, still at the requested amount. |
| `purchased` | Moves to **spent**, at the actual amount. |
| `settled` | **Spent**, evidence attached, closed. |
| `denied` / `cancelled` | Released. No effect on the balance. |

Every transition is recorded by the treasurer, because **the university administrator is outside the system** and always will be.
COS sends nothing to the dean's office and receives nothing back.
It tracks what the club did, holds the evidence, and does the arithmetic.

That constraint is a decision, not a limitation to route around.
A feature that requires a university finance office to adopt a student club's software is a feature that never ships.

There is no internal approval state.
At the founding club, the decision to ask for something happened verbally in a meeting.
Modelling that as an enforced workflow step would invent ceremony nobody performs and produce a queue of requests permanently stuck awaiting an approval that already happened out loud.
An optional note field captures it honestly.

### Evidence

The confirmation email is the receipt, and it is the whole audit story.

A request holds attachments: order confirmations, forwarded emails, screenshots, invoices, receipts.
Each records what kind of evidence it is and when it arrived.

This reuses the object store built for the document hub, which is already S3-compatible and already handles versioned keys and an upload allowlist.
Evidence is append-only for the same reason document revisions are: replacing the proof of a purchase is exactly the operation an audit has to be able to rule out.

### The ledger

The append-only spine, and the part `docs/ARCHITECTURE.md` already commits to.

**No balance is ever stored as an editable field.**
Every number the treasury displays is a fold over append-only entries: allocations, state transitions, amount corrections.
A fund's allocation being cut mid-year is a new entry, not an edit to the fund.
A corrected amount is a new entry referencing the one it corrects.

This is what makes an export credible to a department.
The ledger shows what was recorded, when, and by whom, including the mistakes and their corrections.
A number that can be quietly edited proves nothing about anything, and a club under scrutiny is exactly when it matters.

## What the tab shows

- **The three numbers, per fund and in total.** Available, committed, spent, against allocated. This is the top of the page and the reason someone opened it.
- **Requests in flight**, sorted by how long they have been waiting. A request submitted three weeks ago with no response is the item that needs a human.
- **What is coming**, joined to the calendar. Events in the next month with no funding request against them, and requests whose needed-by date is approaching.
- **The ledger**, filterable and exportable.
- **Time remaining on each fund**, next to how much is unspent.

## Features, by priority

### The core

1. Funds with an allocation, a period, and restrictions.
2. Requests with a justification, an amount, a category, and a fund.
3. The lifecycle above, every transition recorded by hand.
4. **Committed versus spent**, and an available figure derived from both.
5. Evidence attachments on a request.
6. The append-only ledger, with corrections as new entries.
7. Audit export: CSV and a printable summary, per fund and per date range.

### High value, once the core works

8. **Link requests to calendar events.** The connective-layer play described above.
9. **Deadline and staleness tracking.** Needed-by versus today, and "submitted 21 days ago, no response". Chasing an administrator is a real part of the job and nothing currently reminds anyone to do it.
10. **Use-it-or-lose-it warnings.** "$600 unspent, fund closes in 3 weeks." Dean's offices cut next year's allocation for clubs that underspend, so this has a direct financial consequence.
11. **Turnover and handoff.** Treasurers change annually and the spreadsheet leaves with them, usually onto a personal drive they lose access to at graduation. A club-owned record that survives the person is the quiet reason this feature matters, and it needs no new work beyond the data living here in the first place.
12. **Request templates.** Pizza for a general meeting is the same request eleven times a year.
13. **Spending by category and by event**, which is the shape of the argument for next year's allocation.

### Later

14. **`!budget` through the GroupMe bot.** The remaining figure where officers already talk.
15. **Reconciliation against the university's own statement.** The treasurer records what the dean's office says the balance is, and the product shows the delta. Cheap to build, and the disagreement it surfaces is the expensive kind.
16. **Multi-year trends.** "We used 100% of our allocation across four documented events" is the case for a larger one.
17. **A member-visible summary.** Deferred deliberately: the treasury stays officer-only, including read. If it changes, it is a narrower new capability (`expense:summary`), not a loosening of `expense:view`, because `expense:view` is what the navigation gates on.
18. **Reimbursements.** Not part of the founding workflow, where the administrator bought everything. If a club fronts money personally, the club owes a person, which is a liability rather than a draw-down and needs its own request type.

### Deliberately not building

- **Payment custody.** Taking dues or donations means Stripe, terms-of-service review, and university rules about who may collect funds. Already flagged in `docs/OPEN-QUESTIONS.md`; fundraising should start as tracking and links to existing processors.
- **Double-entry accounting.** The club is not a business and no member will maintain a chart of accounts.
- **Bank reconciliation.** There is no bank account. This is the whole point.

## Capabilities

The existing four (`expense:create|edit|delete|view`) cover the core, and the treasury stays officer-only including read.

Worth restating because it will look wrong to someone reading the UI: **Treasurer is a position, and positions grant nothing.**
Any officer can file and record requests.
This is deliberate, and it is the same argument that settled invitations - a club whose treasurer stops answering messages in the middle of a semester still needs its president able to submit a request before the deadline.

An `expense:approve` capability only becomes meaningful if internal approval ever becomes a real workflow step, which today it is not.

## Open questions

- **Which export format a department actually accepts.** `docs/OPEN-QUESTIONS.md` says this must be answered by v0.4, and v0.4 is this. It is the one part of the design that cannot be settled by reasoning, only by asking a real university. It also determines how Baylor-specific the export is allowed to be.
- **Whether the qualitative form has structure worth modelling.** Baylor's fields are not necessarily anyone else's. Leaning: one free-text justification plus a category, with per-university templates deferred until a second university exists.
- **Partial fulfilment.** An administrator buys three of the five things requested. Probably a purchased request whose actual amount is lower plus a note, rather than a state of its own, but this needs a real example before it is settled.
- **Whether a request can span two funds.** Real, but it may be rare enough to handle as two requests.

## What lands first

**Phase 1 is the ledger, the full status set, and the arithmetic.**

An earlier draft of this document scoped phase 1 as "the ledger, with no lifecycle", and that was wrong on its own terms.
Without the committed statuses there is no committed figure, so phase 1 would ship `remaining = allocated - spent` - which is exactly the misleading number this document forbids two sections above.
The statuses are cheap; the arithmetic that reads them is the feature.
What phase 1 leaves out is everything around the request rather than the request's shape: no evidence uploads, no event links in the UI, no templates, no staleness warnings, no export.

That is enough to replace the spreadsheet, and it is where the append-only guarantees have to be right, because everything later is a fold over them.

**Phase 2** is evidence, the calendar link surfaced in the UI, staleness and deadline warnings, and templates.

**Phase 3** is the export, which is blocked on a real answer from a real department and should not be guessed at.
