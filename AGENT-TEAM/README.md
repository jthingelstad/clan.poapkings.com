# AGENT-TEAM — objective owners for Elixir Clan

Four objective owners maintain Elixir Clan. Each owns a durable outcome, not
a task type, and follows evidence through diagnosis, implementation,
verification, deployment and acceptance itself. There is no dispatcher and
no Build Manager; building and testing are capabilities of every owner.

Elixir Clan is small and its stakes are personal: it judges real clan
members from Elixir's record and puts cards in front of real leaders. Two
things therefore matter more here than on a bigger product: the judgment
must stay faithful to the rules a clan chose, and a member who says "this
is wrong about me" must be answered.

## The team

| Objective | File | Primary question |
|---|---|---|
| **Run Elixir Clan** | `run-elixir-clan.md` | Is the product up, deployed from `main`, cheap, and still speaking Elixir's current contract? |
| **Judge Fairly** | `judge-fairly.md` | Do the verdicts, cards, standing and awards follow the clan's policy and the record — and does the record cover what they claim? |
| **Close the Loop** | `close-the-loop.md` | Is every piece of feedback answered, acted on or framed for Jamie, and do the docs still describe the shipped product? |
| **Guard the Door** | `guard-the-door.md` | Are the seams to Elixir, the public repo and the session cookies holding to their boundaries, with nothing published? |

Calendar cadence: [generated schedule](SCHEDULE.md), sourced from
`automations.toml`.

Guard the Door is an independent control: Run cannot waive its findings,
and it never widens a scope, a cookie or a public route to make another
objective's work easier. Do not add a Growth, Analyst or Cost role: cost
belongs to Run, judgment quality to Judge Fairly, product signal to Close
the Loop.

## How Jamie engages the team

Start with the outcome instead of choosing a role or preparing a ticket:

- `Run <objective> now and own the highest-impact measured gap.`
- `Investigate <symptom>; choose the owner by the failed outcome, not the file.`
- `Show me team status only; make no changes.`
- `What across this team needs Jamie?`

Choose **Run Elixir Clan** for deploys, alarms, cost, the Elixir dependency
pin or the OAuth client; **Judge Fairly** for a verdict, card, standing line
or award grant that looks wrong, or a season that closed without grants;
**Close the Loop** when feedback sits unanswered or the docs lie; **Guard
the Door** for scopes, cookies, secrets, the public repo, or the public
documents. Cross-cutting work keeps one originating owner through
acceptance.

## Boundaries with the neighbors

- **Elixir (`../elixir-mcp`)** records facts and has no opinions. A fact this
  product needs and Elixir lacks is a request to Elixir's team (its
  `elixir_feedback` tool or its AGENT-TEAM), never a judgment moved
  upstream. Never touch Elixir's database; every seam is a public door.
- **Elixir Clan is for any clan** (Jamie, 2026-09-25). It was bootstrapped
  from one clan's Discord bot; that history is in `docs/NOTES.md` and is
  not a reference for how the product should behave. Each clan's own saved
  policy is. No team work saves a clan's policy, awards or pitch.
- **Nothing is published.** Every route under `/api/clans` needs a session;
  no other site reads a document from this product.
- **projects-sysadmin AGENT-TEAM** drains the shared alarm queue daily.
  This team owns *this stack's* operational truth: the Operator sees that
  `elixir-clan-api-errors` fired, Run Elixir Clan owns why and the fix.
- **Interactive Claude sessions** (Jamie-directed feature work) share this
  checkout. Every mutating actor serializes through the checkout lease
  (`scripts/objective-lease.mjs`). The daily feedback duty belongs to
  Close the Loop; interactive sessions stop draining it once the team's
  first runs are confirmed.

## Project map

- `AGENTS.md` (= `CLAUDE.md`): the five rules, the gate, sessions, the
  engine's contract, policy, awards, feedback, roles, quota, AWS. `docs/NOTES.md`
  is the decision ledger, newest last.
- `services/engine/` — the pure engine (policy, facts, standing, evaluate,
  render, awards) and its golden tests.
- `services/api/` — one Lambda: auth, the gate, sessions, the roster,
  Manage (ledger, service, awards, recruit, scout), feedback.
- `apps/web/` — the SPA. `infra/` — one stack, deploy/smoke scripts.
- `scripts/feedback.mjs` — the feedback queue from the host.
