# AGENTS.md

Elixir Clan: being in a clan, on top of Elixir. `clan.poapkings.com`, one of
the Elixir family's verticals (`../elixir-family/MAP.md`). It signs people
in with Elixir's OAuth, requires a verified player, shows them their clan
with their own role, and (second push, 2026-09-12) runs a clan's own
management policy against the record: standing, the Elder band, the
removal clock, action cards leaders decide, notes, holds, and scouting.

`CLAUDE.md` is a symlink to this file. Do not fork them.

## What this is, in five rules

1. **In-game role is the app role.** Leader, co-leader, elder, member come
   from the clan roster (`clans_roster`), never from anything stored here.
   No invitations, no workspaces, no roles of our own.
2. **Elixir is the account system.** No passwords, no email login, no
   accounts. A person exists here only as an Elixir session.
3. **Every seam to Elixir is a public door.** OAuth 2.1 at `/oauth/*`, tools
   at `/mcp` with the person's own bearer token, nothing privileged. We never
   touch Elixir's database and never ask for more than `cr:read`.
4. **Judgment lives here, never in Elixir.** Elixir records facts and has no
   opinions; this vertical will hold the clan-management engine and leader
   action cards (next push). Facts in, judgment in our code.
5. **Design is Elixir's.** Same tokens, chrome, chips and cards, imported
   from the pinned `elixir-mcp` dependency, never copied. The unofficial
   disclaimer is on every page.

## Layout

```
apps/web/          React 18 + Vite SPA with Elixir's left rail: /, /clans, /clan/<TAG>,
                   /clan/<TAG>/standing, /clan/<TAG>/manage/{inbox,board,history,policy,awards,scout},
                   /clan/<TAG>/how-elder-works (public), /you, /you/away, /feedback,
                   /maintain/feedback, /refused/<reason>
services/engine/   the management engine, PURE: policy schema, facts, standing,
                   evaluate, render, awards. No I/O, no clock. Golden tests in test/.
services/api/      Node 24 arm64 Lambda behind one HTTP API: /auth/*, /api/*,
                   /api/clans/<TAG>/* (manage/ = ledger, service, awards, scout)
scripts/           import-elixir-bot.mjs (read-only dry run of elixir-bot's ledger;
                   importing was DECLINED 2026-09-12, never offer to run --write)
infra/             one CloudFormation stack + scripts (bootstrap, deploy, smoke)
docs/NOTES.md      decisions, newest last; what is waiting on Jamie
```

## The seams to Elixir

| Seam | Where | What |
|---|---|---|
| Discovery | `GET {ElixirUrl}/.well-known/oauth-authorization-server` | endpoints, cached 300 s (`services/api/src/oauth.mjs`) |
| Client registration | `POST /oauth/register` | once, by `infra/scripts/register-client.mjs`; the `client_id` is the stack parameter `OAuthClientId`. Public client, PKCE, no secret. Lives 365 days from last use. |
| Authorize | `/oauth/authorize` | `scope=cr:read`, `resource=https://elixir.poapkings.com/mcp` (required, RFC 8707), S256 |
| Tokens | `/oauth/token` | access 1 h, refresh 30 d rotating, family 90 d. Refreshed server-side; a rotated refresh token is STORED before any reuse (presenting it twice revokes the grant). |
| The door | `POST /mcp` | JSON-RPC over fetch, JSON only, no sessions (`services/api/src/mcp.mjs`, the pattern is `../elixir-mcp-discord/src/mcp.js`) |

Elixir's contract is documented at <https://elixir.poapkings.com/docs>
(`protocol`, `connections`, `agents`, `verify`). Do not restate it here.

## The gate, in order (`services/api/src/gate.mjs`)

Two reads, `initialize` then `elixir_my_players`; the first refusal wins
and each has its own page (`apps/web/src/views/Refused.jsx`):

1. `_meta["elixir.poapkings.com/principal"].kind === "person"` (the docs say
   `person`, not `user`); an agent's or integration's grant → `not_a_person`,
   and NO session is created
2. at least one player on the account → else `no_primary_player` (Elixir →
   Tracking)
3. at least one claim with `claim_status === "verified"` → else `unverified`
   (Elixir → Verify, one battle with a named deck); the page lists the
   players
4. at least one verified claim in a clan → else `no_clan`

**The identity set and the clan set (2026-09-12).** `identities` is every
claim; `clans` is the distinct clans of the verified primary/alt claims
(`clansOf`), each with `acting_as` (the tag you hold there; two verified
tags in one clan are one clan acting as the higher role, `your_tags` both).
Friends and watching never act. **Selection** is `{ clan_tag, player_tag }`
on the session: a remembered preference (`pref#<primary tag>`, the ONE
non-session item this app stores) wins, then a lone clan, else the chooser
at `/clans`. `POST /api/select` picks and remembers; `/api/roster?clan=<TAG>`
refuses any clan outside the set (`not_your_clan`); a session with no
selection and no `?clan=` gets `409 no_selection`. Arriving at
`/clan/<TAG>` for another of your clans selects it.

The roster is read with `clans_roster` naming the clan explicitly (the
tool's default is the first RECORDED clan among the account's claims). A
`not_recorded`/`no_subject` answer is its own page state: "Elixir isn't
recording your clan yet".

## Sessions (`services/api/src/store.mjs`, `cookies.mjs`)

One DynamoDB table `elixir-clan`, KMS-encrypted, two TTL'd item kinds:
`login#<state>` (PKCE verifier, 10 min, single use) and `session#<id>`
(the token pair, family end, the last gate answer, a roster cache). Cookie
`__Host-elixir_clan_session=<id>.<hmac>`; HttpOnly, Secure, SameSite=Lax;
the signing secret is `elixir-clan/app:session_secret` in Secrets Manager,
consumed by the template as `{{resolve:secretsmanager:...}}` and never read
by a person or an agent. A second cookie `__Host-elixir_clan_login` binds the
OAuth `state` to the browser that started it. `POST /auth/logout` deletes the
session.

**What is deliberately not stored:** player, clan or member data beyond the
session's cache window (gate 2 min, roster 3 min per clan, bounded to the
set). No profile, no history, no awards. Sessions, plus one remembered
clan choice per person, and nothing else.

## The engine's contract (`services/engine`)

`verdicts = evaluate({ participation, policy, now, decisions, holds })`, a
pure function. Inputs are Elixir's `clans_participation` answer (columns per
ISO week and per war week, the recording horizon), the validated policy
values, the instant, the decided cards and the holds. Nothing else is
remembered between runs.

- **Weekly boundaries** are the observed finishes of the clan's war weeks
  (`war_weeks[].finished_observed_at`, the game's Monday reset as the record
  saw it), oldest first. The band is replayed at each; elixir-bot's promote
  and demote machines (`replayMachines`) run over that trail. "Three
  qualifying reviews" is computed from history every time.
- **Windows are in weeks**: the floor over the last N closed ISO weeks
  (ranked) and N closed war weeks (war days); the war rate over the last N
  closed war weeks; ranked and donations over N closed ISO weeks. At a
  boundary, that is exactly the policy's days.
- **War fidelity**: a war week with polled days is exact; one without is
  `weekly` (its total spread over the days that saw a battle); a null week
  is `unknown`. Every fact says which.
- **Fail closed**: `judgment_status` per dimension is `ready`, `held` (no
  war record or no closed review yet), `unknown` (tenure predates the
  record: `tenure_known: false`), `off` (the policy switched it off) or
  `not_applicable` (leadership is never ranked; only an elder is demotable).
  Held and unknown members are shown on the board and never carded.
- **Standing** (`standing.mjs`): participation percentiles (zero is zero,
  participants ranked among themselves), `competitive = war% +
  ranked_weight × ranked% × (1 − war%)`, `score = war_weight × competitive +
  donation_weight × donation%`; the band is a share of the whole roster,
  rank and median over members + elders; swaps pair the weakest challenger
  with the strongest outranked elder and a close call inside the margin
  goes to tenure (known on both sides).
- **Removal**: the clock runs from the later of the last battle and the
  observed join; grace = round(grace_max × open_slots / cap) when the floor
  is cleared; elder+ and an active hold stop at `at_risk`; a member with no
  anchor is `held`.
- **Cards** (`reconcileCards`): one open card per (member, type); raised when
  `actionable` (ready + eligible/recommended + past the cooldown), withdrawn
  with a reason when not. Outcomes are verified from the record on the next
  evaluation (removal: membership closed → `member_kicked`; promotion or
  demotion: the role moved) or flagged after `outcome_window_hours`.

## Policy is versioned configuration

`services/engine/src/policy.mjs` owns the fields: label, unit, range,
default (POAP KINGS), and `why` from elixir-bot's POLICY.md, grouped as the
policy reads. There is no policy markdown in this repo; the editor's help
text is the documentation. Every save is a new immutable version
(`policy#<clan>#v<n>`), the pointer moves, cards stamp the version that
judged them. `validate()` refuses nonsense in a leader's words. Version 0
means "the defaults, unsaved".

## Awards (third push, 2026-09-12)

elixir-bot's season awards as per-clan configuration: a CATALOG OF KINDS,
never a rules engine (`services/engine/src/awards.mjs`). Each kind is one
function with a few parameters; every award a clan runs is an instance
with the clan's own name and description. Kinds: `season_points_podium`
(War Champ: war points over the season, tiebreak donations or none),
`perfect_attendance` (Iron King: pass/fail, decks per day, allowed misses),
`donations_podium`, `rookie_podium` (first season here = joined during
this season, or during the previous one without a war day in it; a join
that predates the record is never a rookie), and `leaders_pick` (by hand,
with a note; who may grant). **Free Pass is not an award**: it is what
POAP KINGS does to recognise its War Champ, so it is a `leaders_pick`
granted with the podium in view (Jamie, 2026-09-12).

Periods are war seasons as the record saw them (`war_weeks` grouped by
`season_id`); a season is judged only when CLOSED (every week finished
and its Colosseum week last or a later season begun) and COMPLETE (its
first section in the record). Facts come from the same
`clans_participation` read (weeks 8); grants are written on the first
evaluation after a season closes (`award#<clan>#<season>#<award id>#<tag>`,
idempotent per (season, award)) and stamp the awards document version.
The document is versioned like policy (`awards#<clan>#v<n>`). The open
season's standings are provisional and say so. A computed grant is the
record's and cannot be taken back; a manual one is a leader's and can.

Surfaces: Manage ▸ Awards (elders read and grant what elders may; leaders
edit), the member sheet's trophy case, and the PUBLIC document
`GET /api/clans/<TAG>/awards` (no session; JSON; `cache-control: public,
max-age=300`; edge-cached on its own CloudFront behavior; `404
not_published` until the clan switches publish on). Nothing here narrates
an award; poapkings.com or any site reads the document. No public HTML
page, by decision.

## Feedback (2026-09-12)

Elixir's feedback system, carried nearly verbatim (`services/api/src/feedback.mjs`,
`apps/web/src/views/{Feedback,Maintain}.jsx`): a person files a category and
a Markdown note from anywhere (the page, clan and role ride along as
`context`), sees their own list with every status and reply, and opening a
reply marks it seen (`feedback_unseen` on `/api/me` drives the chrome's
mark). The MAINTAINER answers from `/maintain/feedback` with a status
(`seen | planned | done | declined`), a Markdown reply and a free-text
`shipped_in`. **The maintainer is not a clan role**: it is the product's,
a verified player tag in the stack parameter `MaintainerTags`. People only:
agents do not use Elixir Clan. A person the gate refuses can still file.
Two differences from Elixir, both because of what this product is: a
`judgment` category, and no `request_id`. Storage: `feedback#<id>` items in
ONE partition (`feedback#queue`) of the `ByClan` index; the queue is small
and a person's list is a filter over it. New feedback publishes one message
on the SNS topic `elixir-clan-feedback` (`FeedbackNotifyEmail` subscribes an
address; the agent team's Close-the-Loop owner reads by script,
`scripts/feedback.mjs`). Feedback is not an incident: it never goes to the
alarm topic.

## Fourth push (2026-09-12): what was carried from elixir-bot, and what was not

Reviewed elixir-bot's whole management surface against this product. Carried:
**departure cards** (every `member_left` in Elixir's roster events that no
Done removal card explains raises a card; a leader answers Kicked / Left /
Ignore, never declines; the classification is the ledger's leave-vs-kick
record and the timeline shows it); **away** (a member marks themselves away
on `/you/away` for up to `away_max_days`; it is a hold of kind `away`, the
clock pauses, leaders see it on the board and can clear it, a leader's own
hold is not the member's to move); the **membership timeline** in History
(joins, leaves, role changes from `clans_roster.recent_events`); **paste-ready
in-game copy** on cards and timeline rows (`inGameCopy`: plain sentences,
200 characters, no "&" or "+digits", the game's filter). The rail is
Elixir's console rail, groups and all.

Not carried, by decision (Jamie): scheduled evaluation stays a next-push
item; premise-fingerprint re-nomination, member shields and the weekly
digest are not features here; **alt accounts are Elixir's knowledge** (a
fact request to Elixir if ever needed, never recorded here); Discord
webhooks are deferred, coming later. The bot's narration lanes never move.

## Roles in Manage

From the roster, as the gate resolves them. Leader and co-leader: Manage
(inbox, board, history, policy, scout), holds, leader notes, and every note.
Elder: elder notes (write and read), scout. Everyone in the clan: Standing
and their own line, when `members_see_standing` is on. Nobody below
co-leader ever sees a removal card or who is on a clock.

## What is stored, second push

The `elixir-clan` table gains, per clan, through the `ByClan` index:
policy versions, the latest verdict snapshot (evidence summaries only,
overwritten each evaluation), cards (kept: this ledger is how a leave is
told from a kick), holds, and notes (tiered `leader` / `elder`). Tags and
summaries, never Elixir payloads. `ledger.deleteClan` removes the set; call
it when a clan's last verified leader disconnects. Evaluation is on demand
with the signed-in leader's token, cached five minutes per clan; no
background job and no stored credential.

## Elixir tools this app depends on

| Tool | Since contract | Used for |
|---|---|---|
| `initialize`, `elixir_my_players` | 1.0.0 | the gate |
| `clans_roster` | 1.0.0 | the clan page |
| `clans_participation` | 1.9.0 | every evaluation: one call, eight weeks |
| `players_profile({ live: true })`, `battles_query({ live: true, verbosity: "compact" })` | 1.7.0 | scouting an applicant; `live_pending` is passed through with `retry_after_s` |

Elixir returns facts; every threshold, score and verdict is here.

## Quota discipline

Every page view spends the signed-in person's Elixir daily budget. The gate
answer and roster are cached per session; "check again" is floored at 30 s
server-side; nothing polls. The page shows `meta.freshness_seconds`/`as_of`
the way Elixir does (`Fresh`).

## AWS and deploying

- `--profile jamie`, `us-east-1`, hobby-account rules from `~/Projects/AGENTS.md`.
  No em dashes in resource names.
- One stack `elixir-clan` (`infra/template.yaml`): table, function, HTTP API
  (spelled out: integration, `$default` route and stage with an access log),
  private bucket + CloudFront, SNS `elixir-clan-alarms`, four alarms (Lambda
  errors, API 5xx, slow requests p90 > 8 s, estimated charges), 30-day logs.
- `infra/scripts/parameters.mjs` carries Drop's discipline: REQUIRED (code
  key) is always sent; PRESERVED (`AppUrl`, `ElixirUrl`, `OAuthClientId`,
  `AppSecretName`, `SiteCertificateArn`, `MonthlyCostAlarmUsd`) rides
  `UsePreviousValue`. Set one with `--param=Key=Value`; omitting is never a
  reset. A test pins the template's parameter list to that set.
- Local: `AWS_PROFILE=jamie node infra/scripts/deploy.mjs` (build → upload →
  stack → web → smoke). `--create` for a first deploy, `--skip-web` for code
  only.
- CI: `validate` on every push/PR (no network, no spend); `deploy` on main
  after green, with the `elixir-clan-deploy` user's static keys and the
  `elixir-clan-cloudformation-execution` role, both from
  `infra/scripts/bootstrap.mjs`, exactly Drop's pattern.
- Alarms route to the sysadmin `projects-ops-alerts` queue via
  `infra/scripts/wire-alarms.mjs` (queue policy + raw subscription). No email.
- Secrets: load the `aws-secrets-manager` skill before touching any; never
  `get-secret-value`.
- Tests: `npm run verify` (prettier, oxlint, node:test + vitest). Every seam
  is injected; no test reaches the network.

## Logging: one story per request

`services/api/src/trace.mjs` (2026-09-12, after slow pages and a log group
holding only START/END/REPORT). Every request runs inside a trace; every
Elixir call (`mcp.mjs`, `oauth.mjs`) and every table operation (`store.mjs`,
`ledger.mjs`) is timed into it. The handler ends the request with:

- **one JSON line** in `/aws/lambda/elixir-clan-api`: `http` (the route with
  ids and tags as `*`), `status`, `ms`, `elixir_ms`/`elixir_calls`,
  `store_ms`/`store_ops`, `cold`, the clan and role for a clan route, and
  `elixir: [{ call, ms, ok, status|code, request_id, bytes }]` where
  `request_id` is Elixir's own `meta.request_id` for that call, the key to
  its call log. Level `warn` when the request took over 8 s or answered
  5xx; a single Elixir call over 5 s gets its own `slow_elixir_call` line.
  Never a token, a cookie or a body.
- **one EMF line** (namespace `ElixirClan`, dimension `Route` and none):
  `DurationMs`, `ElixirMs`, `StoreMs`, `ElixirCalls`, `Errors5xx`,
  `ColdStarts`. The `elixir-clan-slow-requests` alarm watches p90.
- a **`Server-Timing`** header (`total`, `elixir`, `store`, `own`, `cold`) so
  the browser's wall clock can be read against the server's: the
  difference is time in front of the edge.

In front of the Lambda, the HTTP API's access log
(`/aws/apigateway/elixir-clan-api`) writes one JSON line per request with
the gateway's `integration_ms` and `response_ms`, sharing `request_id` with
the Lambda's line. In the browser, `apps/web/src/api.js` warns in the
console for any request over 3 s with the wall time and the Server-Timing.
The smoke script prints each read's time and timing. Reading a slow
report: gateway `integration_ms` ≈ Lambda `ms`? then the time is Elixir's
(`elixir` entries) or ours (`own`); the browser's `wall_ms` far above
`total`? then it is the edge or the network.

## Analytics: Tinylytics, the way Elixir loads it

`apps/web/src/analytics.js` (2026-09-12; site `J4GMM7Mti-Quk1gfx6zQ`). The
embed records the document load; the route bridge records pushState
navigation as virtual hits with the page collapsed (`/clan/<TAG>/manage/board`
reports as `/clan/manage/board?clan=#TAG`; `/feedback/<id>` as
`/feedback?id=`). localhost never tracks. The CSP allows `tinylytics.app` for
script, connect and img and no other third party (the smoke pins it).
Events are counted the Tinylytics way, a hidden `data-tinylytics-event`
node clicked once (`trackEvent`), or the attribute on a real link. The
taxonomy, and it is REAL (add here when adding there):

| Event | Value |
|---|---|
| `clan.signin_started` | `landing` \| `chrome` (the link clicked) |
| `clan.card_decided` | `<type>:<status or classification>` e.g. `removal:done`, `departure:leave` |
| `clan.hold_set`, `clan.note_added` | `until` \| `open`; `leader` \| `elder` |
| `clan.policy_previewed`, `clan.policy_saved` | (none); `v<n>` |
| `clan.awards_saved`, `clan.award_granted` | `published` \| `private`; the award kind |
| `clan.scout` | `answered` \| `pending` |
| `clan.away_set`, `clan.away_cleared` | (none) |
| `clan.feedback_sent`, `clan.feedback_answered` | the category; the status |
| `clan.copy_in_game` | (none) |
| `web.api_timeout`, `web.api_network`, `web.api_bad_response`, `web.api_slow` (over 3 s) | the route key, ids as `*` |

No server-side events: Elixir's go through its email relay with an API
token; this product has no relay and sends nothing from the Lambda.

## Design dependency

`apps/web` depends on `elixir-mcp` as a **pinned git dependency** (a commit
SHA in `apps/web/package.json`) and imports
`elixir-mcp/packages/design/styles.css`; the Clash display font is copied
from the same dependency at build time (`apps/web/scripts/fonts.mjs`,
gitignored). Bump the SHA to take a design change; never copy the file.
Publishing `@elixir-mcp/design` is the durable answer and needs Jamie's npm
org (docs/NOTES.md).

## The team

`AGENT-TEAM/` holds four objective owners (Run Elixir Clan, Judge Fairly,
Close the Loop, Guard the Door), the operating loop (`WORKFLOW.md`), the
reading map, the calendar (`automations.toml` → `SCHEDULE.md`) and the
checkout lease (`scripts/objective-lease.mjs`). Every mutating actor on
this checkout, an objective run or an interactive session, claims the
lease before the first edit and releases it clean. Feedback is Close the
Loop's daily duty.

## Next push

Scheduled evaluation on the leader's refresh grant so cards are waiting in
the morning (the ledger needs no migration for it); the goodbye routine
reading `member_kicked` from the cards; the poapkings.com Elder prose
replaced by `/clan/J2RGCRVG/how-elder-works`. Read `../elixir-family/MAP.md`
§5 first.

---

*This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*
