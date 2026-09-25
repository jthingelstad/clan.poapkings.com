# AGENTS.md

Elixir Clan: being in a clan, on top of Elixir. `clan.poapkings.com`, one of
the Elixir family's verticals (`../elixir-family/MAP.md`). It signs people
in with Elixir's OAuth, requires a verified player, shows them their clan
with their own role, and runs each clan's own policy against the record:
Elder by participation or by hand, the removal clock, action cards leaders
decide, departures, notes, holds, awards, recruiting copy and scouting.
It is a general clan-management tool for any Clash Royale clan (Jamie,
2026-09-25): how a clan runs comes from its saved policy, never from code.

What it is for, who it serves, its principles and how the next step is
chosen: `docs/VISION.md`. Read it before proposing a feature.

`CLAUDE.md` is a symlink to this file. Do not fork them.

## What this is, in five rules

1. **In-game role is the app role.** Leader, co-leader, elder, member come
   from the clan roster (`clans_roster`), never from anything stored here.
   No invitations, no workspaces, no roles of our own.
2. **Elixir is the account system.** No passwords, no email login, no
   accounts. A person exists here only as an Elixir session.
3. **Every seam to Elixir is a public door.** OAuth 2.1 at `/oauth/*`, and
   Elixir's JSON API at `/api/v1` with the person's own bearer token for that
   audience, nothing privileged. Clan is a program, not an agent: it does not
   use MCP (Jamie, 2026-09-23). We never touch Elixir's database and never ask
   for more than `cr:read` and, to share what the clan chooses as attested
   facts (JSON API 2.2.0), `clans:attest`.
4. **Judgment lives here, never in Elixir.** Elixir records facts and has no
   opinions; this vertical owns the clan-management engine and leader
   action cards. Facts in, judgment in our code.
5. **Design is Elixir's, and so is the kit.** Same tokens, chrome, rail,
   chips and cards, and the same React components, data layer and clock
   vocabulary, imported from the pinned `elixir-mcp` dependency, never
   copied. Anything this app needs that the kit lacks is a kit addition
   there, then a pin bump here - never a local copy. The unofficial
   disclaimer is on every page.
6. **Any clan, and nothing until its policy.** No code, default, help text
   or copy is shaped by one clan: a clan's rules, awards and words live in
   its saved policy, awards and pitch. Until a leader or co-leader saves a
   policy, no clan-management function runs (members still see the roster
   and its statistics; Recruit and Scout work). Below **10 members** (as
   Clan Wars) Elixir Clan is a statistics view: no policy can be created,
   and a saved one pauses, kept, until the clan is back at 10. A test fails if product
   source names a clan, a real player, one clan's awards or website, or
   elixir-bot (`services/engine/test/no-clan-specifics.test.mjs`).
7. **An app, not a publisher.** Every route under `/api/clans` needs a
   session: no public pages, no public documents (Jamie, 2026-09-25). What
   members should see, they see signed in.

## Layout

```
apps/web/          React 19 + Vite SPA on Elixir's kit (TanStack Router + Query,
                   Tailwind v4 over Elixir's tokens): /, /clans, /clan/<TAG>,
                   /clan/<TAG>/actions[/<number>], /clan/<TAG>/standing, /clan/<TAG>/trophies,
                   /clan/<TAG>/recruit, /clan/<TAG>/manage/{board,history,policy,awards,scout,settings},
                   /you, /you/away, /feedback, /maintain/feedback, /refused/<reason>
services/engine/   the management engine, PURE: policy schema, facts, standing,
                   evaluate, render, awards, recruit, chat, words. No I/O, no clock.
                   Golden tests in test/.
services/api/      Node 24 arm64 Lambda behind one HTTP API: /auth/*, /api/*,
                   /api/clans/<TAG>/* (manage/ = ledger, service, awards, recruit,
                   scout, model); anthropic.mjs (a clan's own key, never ours)
scripts/           feedback.mjs (the Close-the-Loop owner's read of the queue),
                   actions.mjs (actions and their logs, read-only, for review)
infra/             one CloudFormation stack + scripts (bootstrap, deploy, smoke)
docs/NOTES.md      decisions, newest last; what is waiting on Jamie
```

## The seams to Elixir

| Seam | Where | What |
|---|---|---|
| Discovery | `GET {ElixirUrl}/.well-known/oauth-authorization-server` | endpoints, cached 300 s (`services/api/src/oauth.mjs`) |
| Client registration | `POST /oauth/register` | once, by `infra/scripts/register-client.mjs`; the `client_id` is the stack parameter `OAuthClientId`. Public client, PKCE, no secret. Lives 365 days from last use. |
| Authorize | `/oauth/authorize` | `scope=cr:read clans:attest` (`clans:attest` since 2026-09-25: only the family's own apps may ask for it), `resource=https://elixir.poapkings.com/api/v1` (required, RFC 8707), S256. An `/mcp` grant is refused at `/api/v1`. A session signed in before the change holds `cr:read` alone: its shares are logged as not shared until the person signs in again. |
| Tokens | `/oauth/token` | access 1 h, refresh 30 d rotating, family 90 d. Refreshed server-side; a rotated refresh token is STORED before any reuse (presenting it twice revokes the grant). |
| The door | `/api/v1/*` | Elixir's JSON API (`services/api/src/elixir-api.mjs`). It keeps the old MCP client's `initialize`/`callTool` interface: each tool name maps to one operation, answered with that tool's structured result, and a refusal comes back as problem+json carrying the tool's code. Plan: `../elixir-family/plans/clan-app-api.md` |

Elixir's contract is documented at <https://elixir.poapkings.com/docs>
(`integrations` for the JSON API Clan reads, `protocol` for OAuth discovery
and registration, `connections`, `verify`). Do not restate it here.

## The gate, in order (`services/api/src/gate.mjs`)

`GET /api/v1/me` (the principal block and the players; the client answers
`initialize` and then `elixir_my_players` from it, one request each); the
first refusal wins and each has its own page
(`apps/web/src/views/Refused.jsx`):

1. `/me`'s `principal.kind === "person"` (the block MCP's `initialize` used
   to carry in `_meta`; the docs say `person`, not `user`); an agent's or
   integration's grant → `not_a_person`, and NO session is created (Elixir's
   `/api/v1` already refuses a grant that is not a person's; this check
   stays behind it)
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

The roster is `GET /api/v1/clans/{tag}/roster` (`clans_roster`'s result),
the clan always named in the path. A
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

The same table holds the durable product records described below. It has
35-day point-in-time recovery, DynamoDB deletion protection, and CloudFormation
retain policies for deletion and replacement. Recovery always creates a
separately named table; a rehearsal compares table/index metadata, item counts,
size, and encryption without reading rows or connecting the restored table to
the application, then removes only that isolated rehearsal table.

**Session caches are bounded:** gate 2 min, roster 3 min per clan, bounded
to the verified clan set. No independent player profile or game-history
database is kept here. The remembered clan choice, management ledger,
recruiting facts cache, awards and feedback are described below; their
retention is separate from the session cache window.

## The engine's contract (`services/engine`)

`verdicts = evaluate({ participation, policy, now, decisions, holds,
trophies })`, a pure function of a SAVED policy: the service never evaluates
a clan without one. Inputs are Elixir's `clans_participation` answer
(columns per ISO week and per war week, the recording horizon), the
validated policy values, the instant, the decided cards, the holds, and,
only when the policy counts trophy road, each member's trophies today from
`clans_roster`. Nothing else is remembered between runs.

- **Categories**: a policy counts any of Clan Wars, ranked play, donations
  and trophy road (`countedCategories`), each with its own window and an
  optional minimum. Nothing is mentioned, measured or advised for a
  category the clan does not count.
- **Minimums** (`facts.minimums`): each minimum set above zero is met,
  missed or unknown; the clan chooses any one of them or all of them; none
  set means everyone meets them. They gate promotion, keep Elder
  (`abandoned` demotion) and earn removal grace.
- **Elder**: `elder_mode` is `manual` (leaders choose; no promotion or
  demotion cards, no band) or `categories`: members and Elders are ranked
  on a weighted mix of the counted categories (`elderWeights`, relative
  weights normalized to 1; each metric a participation percentile, zero is
  zero); the band is a share of the whole roster; swaps pair the weakest
  challenger with the strongest outranked Elder and a close call inside
  the margin goes to tenure (known on both sides). The promote and demote
  machines (`replayMachines`) replay over the weekly trail, so "three
  qualifying reviews" is computed from history every time.
- **Weekly reviews** are the observed finishes of the clan's war weeks
  (`war_weeks[].finished_observed_at`) when Clan Wars weighs in Elder, and
  the ends of whole ISO weeks otherwise: a clan that does not war is still
  reviewed.
- **Windows are in weeks**: minimums over the last N closed ISO weeks
  (ranked, donations) and N closed war weeks (war decks); the war rate is
  weekly decks played over decks asked across the last N closed war weeks.
- **An early finish makes later war days optional**: outside Colosseum,
  `finish_war_day` sets the number of required days and therefore the decks
  asked (four per day). Decks after the finish still add credit without
  adding to the ask. Colosseum always asks for all four days. War fidelity
  is `weekly` from the race's own `decksUsed`, or `unknown`; no battle is
  attributed to a war day.
- **Fail closed**: `judgment_status` per dimension is `ready`, `held` (no
  closed review yet, or the answer turns on something the record cannot
  show: an unrecorded battle log, an unknown war week, a missing trophy
  count, an unknown minimum), `unknown` (tenure predates the record), `off`
  (the policy does not do it) or `not_applicable` (leadership is never
  ranked; only an Elder is demotable). Held and unknown members are shown
  on the board and never carded.
- **Removal** (`removal_enabled`): the clock runs from the later of the last
  battle and the observed join; grace = round(grace_max × open_slots / cap)
  for a member meeting the minimums; leadership and an active hold stop at
  `at_risk`, and so do Elders unless `removal_includes_elders`; a member
  with no anchor is `held`.
- **Actions** (`reconcileCards`, still "cards" in code and storage): one open
  action per (member, type); raised when `actionable` (ready +
  eligible/recommended + past the cooldown), withdrawn with a reason when
  not. A completed action holds the same action for that member until its
  outcome window (`outcome_window_hours`) passes, unless its outcome was
  flagged first: a kick shows in the record only at Elixir's next roster
  poll, and without the hold the page's re-read after "Complete" raised
  the removal again (2026-09-25). Outcomes of completed promotions, demotions and removals are verified
  from the record on the next evaluation (removal: membership closed →
  `member_kicked`; promotion or demotion: the role moved) or flagged after
  `outcome_window_hours`. See §Actions for who may take each and its log.
- **Words** (`render.mjs`): card facts, the member-safe phrase, next steps,
  paste-ready in-game copy and `describePolicy` (the "How it works here"
  section of Standing) are all written from the clan's policy.

## Policy is versioned configuration, and nothing runs without it

`services/engine/src/policy.mjs` (schema 2, 2026-09-25) owns the fields:
label, unit, range, starting value, a `why` that says what the setting does
(never what a clan should believe), and `when`, the values under which a
field or group applies (the editor shows only those). Everything starts
off: no category counted, Elder by hand, no removal, no departure cards.
Every save is a new immutable version (`policy#<clan>#v<n>`), the pointer
moves, cards stamp the version that judged them. `validate()` refuses
nonsense in a leader's words. A clan with no saved version has no policy:
every management route answers `409 no_policy`, `/api/me` carries
`policy: { set: false }`, and the rail offers only the roster, Recruit,
Scout and (to leaders) the policy editor and clan settings, whose first
policy save is version 1.

**The editor is tabs along the top** (Jamie, 2026-09-25: one long page was
too much, and ticking a goal changed nothing on it). `TABS` in `policy.mjs`
places every group on exactly one tab: About; one tab per category (Clan
Wars, Ranked play, Donations, Trophy road), each switched on or off by its
`*_enabled` field and holding its own settings, its minimum included;
Elder (the mode, the weights, tenure, the minimums' window and rule, what
members see, and folded "fine tuning": how many Elders, promotion,
demotion, checking what was done, the groups marked `advanced`);
Inactivity (switched by `removal_enabled`); Arrivals and departures; and
Announcements. A tab that is off shows only its switch; turning one on
fills that tab from the clan's posture (`tabStart` in `goals.mjs`), to
tune. The tab bar marks each tab on or off, changed, or needing a fix, and
a refused save opens the tab that holds the problem.

**What the clan is for** (2026-09-25, `services/engine/src/goals.mjs`): the
measurable goals ARE the categories the clan counts (`declaredGoals`: Clan
Wars, climbing for ranked play or trophy road, donations); only playing
together, which the game cannot measure, is its own field
(`goal_together`), with a `posture` (relaxed, standard, strict). The
earlier `goal_war`, `goal_climbing` and `goal_donations` fields are
`RETIRED_FIELDS`: a saved version carrying them validates and they are
dropped on read. Goals judge nothing: `policyFromGoals(goals, posture)`
fills every tab as a starting point (the About tab's presets, "a war clan",
"a social clan" and so on, are goals plus a posture), "How it works here"
opens with them, and a leader writing the first recruiting pitch starts
from `pitchFromGoals`. The web app imports the engine for this, so presets
are computed in one place.

**The smallest clan a policy engages with is `MIN_MEMBERS` = 10** (Jamie,
2026-09-25: a clan takes no part in Clan Wars below 10, and a policy has
nothing to judge at 1, 3 or 5). Below it no policy can be created or
previewed, and a saved one pauses: every management and awards route
answers `409 too_few_members` with `{ members, min_members }`, nothing is
evaluated, carded or granted, and `/api/me`'s `policy.active` is false, so
the rail is the no-policy rail. The size is the clan's latest roster or
participation read, noted as one number (`clan_size#<clan>`) so the gate
costs no Elixir read; an evaluation re-reads it from its own participation
read, so a clan that grows back to 10 resumes on the next visit.

## Awards

Season recognition as per-clan configuration: a CATALOG OF KINDS, never a
rules engine (`services/engine/src/awards.mjs`). Each kind is one function
with a few parameters; every award a clan runs is an instance with the
clan's own name and description. Kinds: `season_points_podium` (war points
over the season, tiebreak donations or none), `perfect_attendance`
(pass/fail, decks per day, allowed misses), `donations_podium`,
`rookie_podium` (first season here = joined during this season, or during
the previous one without a war day in it; a join that predates the record
is never a rookie), and `leaders_pick` (by hand, with a note; who may
grant). Every clan starts with no awards (Jamie, 2026-09-25); leaders add
the ones it runs, each kind offered under its plain title.

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

Surfaces, all signed in: Manage ▸ Awards (elders read and grant what elders
may; leaders edit), the member sheet's trophy case, and **Trophies**
(`/clan/<TAG>/trophies`, `GET /api/clans/<TAG>/trophies`) for every member:
the awards the clan runs with their rules, the winners season by season,
and your own. Opening Trophies evaluates, so a closed season's grants are
written by whichever member looks first. Nothing is published outside the
app.

## Recruit

A page every member can use (`services/engine/src/recruit.mjs`), open before
a clan has a policy. Two inputs: the clan's **pitch** (a leader's words,
versioned like policy: `recruit#<clan>#v<n>`; tagline, about, up to six
points, who we want, website, how to get in; every clan starts with an
empty pitch and there is no copy until a leader writes one) and **facts**
from one live read of the clan (`GET /api/v1/clans/{tag}/live`,
`live_fetch`'s result for `/clans/{tag}`: required trophies, members and
open slots, clan score, war trophies, donations a week, top trophies and
donors), cached six hours in `recruit_facts#<clan>` so a member's page open
never spends a live read; a pending read is passed through with the
recorded roster standing in (its type, description, clan score and war
trophies when the record has them; no join floor, donations a week or
location until the live read lands); a leader's "read again" is floored at
ten minutes.

`recruitCopy` writes two formats deterministically (Jamie, 2026-09-25): a
**personal** note (subject and plain body) for one person by email or
message, and a public **post** for a recruiting forum (a Discord recruiting
channel, r/RoyaleRecruit) that carries the forums' requirements itself: the
required trophies in brackets in the title and as `Required Trophies: [N]`
in the body, and no invite link in the body. `validateCopy` checks an
edited copy still carries them. Every piece is editable before copying and
resets to the clan's words. `GET /api/clans/<TAG>/recruit` for every
member; `POST` for leaders. Live reads are first-party and spend no
person's Elixir quota; the cache still caps them at one per clan per six
hours. A leader can have the pitch drafted by the clan's own model (below):
`POST /api/clans/<TAG>/recruit/draft` with an optional note answers a
draft for the editor, never saved by itself.

## The clan's own model (2026-09-25)

Bring your own tokens (VISION, principle 8): Elixir Clan funds no model.
A leader or co-leader adds the clan's **Anthropic API key** in **Clan
settings** (Manage ▸ Settings, `/clan/<TAG>/manage/settings`; the old
`/manage/model` address lands there; `GET|PUT|DELETE
/api/clans/<TAG>/model`), for any clan, with or without a policy, like
Recruit. Clan settings is the leaders' page for what belongs to the whole
clan rather than to how it runs (Jamie, 2026-09-25); the model is its
first section, and what the doors bring (what the clan shares with Elixir,
its mail) belongs there next. Then the clan's
model may write **words, never judgments**:

- **What it may write** is a closed list (`PURPOSES` in
  `services/engine/src/words.mjs`): `recruit_pitch` and, since the second
  round (2026-09-25), `leader_message`: on an open action that ends in a
  Clan Leader Message (promotion, demotion, the season's awards, how the
  clan runs), a leader asks for it in the clan's voice (`POST
  /api/clans/<TAG>/actions/<id>/draft`, `manage/drafts.mjs`, "Draft in our
  voice" in the editor). The model writes `{name}` and `{winners}`, never a
  name; Clan puts the names back and applies the chat filter and the
  game's limits (`leaderMessageFromDraft`); the action's log says
  `drafted`. Each purpose's
  request is built in the engine from clan-level facts only (the game's
  numbers for the clan, its goals and posture, `describePolicy`, its own
  words, the leader's note), never a member's name or numbers, and its
  answer is one forced tool call, checked there (`pitchFromDraft`: links,
  markdown and bullets out, each field clipped, the clan's website and
  contact kept, a number the model was not given flagged). A person edits
  and saves; nothing a model writes is saved or sent by itself.
- **The key** (`services/api/src/manage/model.mjs`) is checked with
  Anthropic's model list before it is kept (spends nothing; an Admin key is
  refused), sealed with AES-256-GCM under a key derived (HKDF) from the
  app's `session_secret` for this use only and bound to the clan and the
  person who added it, and kept in its own item `model_key#<clan>`
  **outside the ByClan index**, so no listing of a clan carries it. Nobody
  sees it again: the page shows `sk-ant-…` and its last four, who added it
  and when. Rotating `session_secret` makes kept keys unreadable; the page
  then asks for the key again. No IAM, KMS key or secret was added for it.
- **Who and how much**: only leaders and co-leaders see, set or use it; it
  is used only while the person who added it is still a leader or
  co-leader on the roster (their Anthropic account pays; another leader
  may replace it with theirs); at most `USES_PER_DAY` (20) uses a day per
  clan; a key Anthropic stops accepting is marked and not used again until
  added again. The model is the first of `MODEL_PREFERENCE` the key
  reaches (Sonnet 5, then Opus 5.5, then Haiku 4.5), and a leader may pick
  any model the key lists.
- **Every use is recorded** (`model_call#<clan>#<at>#<id>`, 90 days, TTL):
  who, what for, the model, ok or the error, the tokens. The page lists
  today's count, the month's uses and tokens, and the last ten. The
  request's log line carries the call's time, status and tokens
  (`timedModel` in `trace.mjs`), never the key, the prompt or the answer.

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

## Departures, away, the timeline, in-game copy

**Departure cards** (`departures_enabled`): a `member_left` in Elixir's
roster events that no Done removal card explains raises a card only while
the member remains gone; a later rejoin raises nothing and withdraws an
open card; a leader answers Kicked / Left / Ignore, never declines; the
classification is the ledger's leave-vs-kick record and the timeline shows
it. Switched off, open departure cards are withdrawn. **Away** (when the
policy tracks inactivity and `away_max_days` > 0): a member marks themselves
away on `/you/away`; it is a hold of kind `away`, the clock pauses, leaders
see it on the board and can clear it, a leader's own hold is not the
member's to move. The **membership timeline** in History (joins, leaves,
role changes from `clans_roster.recent_events`). **Paste-ready in-game
copy** on cards and timeline rows (`inGameCopy`: plain sentences through
the game's filter rules, 200 characters, a welcome 120), naming nobody's
rules.
The rail is Elixir's console rail, groups and all.

Not features here, by decision (Jamie): premise-fingerprint re-nomination,
member shields, the weekly digest; **alt accounts are Elixir's knowledge**
(a fact request to Elixir if ever needed, never recorded here); Discord
webhooks are deferred. Scheduled evaluation: see "The morning
evaluation".

## Actions (2026-09-25)

What Elixir Clan suggests a person in the clan do is an **action** (Jamie:
"cards" did not resonate; code and storage keep `card`). Each action has an
**audience** (`services/engine/src/actions.mjs`): `leaders` (promote,
demote, remove, departure), `elders` (elders and up: welcome a newcomer) or
one `member` (going to be away?). Whoever the audience allows completes it
or declines it (a leader's decline says why; a welcome or an away may just
be no), and only they see it: nobody below co-leader ever sees a removal
action or who is on a clock, and a member's own away question is theirs
alone. Two kinds beyond the leaders' are policy switches, off to start:
`welcome_enabled` (a `member_joined` in the last three days raises a
welcome for elders and up, with the clan-chat line; it closes itself if
they leave or after a week) and `away_suggestions_enabled` (a member or
elder at risk is asked; marking away completes it, playing again
withdraws it).

**Words into the game.** An action that ends in words says where they go
(`ACTION_TYPES[type].channel`): a **clan chat** line (welcome, removal; for
anyone the action is for; 200 characters) or a **Clan
Leader Message** (`leaderMessage` in `render.mjs`: a title of at most 24
characters and a message of about 180, as observed in the game, since
nothing about in-game messages is in the API; leaders and co-leaders only;
it lands in every member's Inbox and stays). Promotions and demotions carry
their own Leader Message, one per person: promoting and announcing are one
atomic action, as clans have always done them (Jamie, 2026-09-25). Two
announcements are policy switches, off to start: `announce_awards_enabled`
(a season whose computed grants were just written raises "announce the
season's awards", once per season, naming the winners) and
`announce_rules_enabled` (a saved version raises "tell the clan how it
runs": how it runs the first time, what changed after; a newer version
withdraws the open one). A decline needs a reason only for actions that
judge a member (`JUDGING_TYPES`); completing a message action logs
`channel` so the log says it was sent. The action store
(`services/api/src/manage/actions.mjs`) raises, withdraws, logs and shapes
actions for both the manage and the awards service.

**The game's chat filter** (`services/engine/src/chat.mjs`) is one module
every in-game line goes through, chat and Leader Message alike: the
game silently blanks innocent text, often with the words beside it, and
each rule was learned from a real message that came out censored (the
dated observations are in cr-agent-api-docs' `wiki-api-crosswalk.md`).
`chatSafe` rewrites what it can ("&" → "and", "+" before digits dropped, a
hyphen joining word-parts, member names included, → a space, "phone" →
"device"); `clipChat` clips at a whole sentence, else a word and "...";
`chatWarnings` tells a leader editing a Leader Message what the game would
blank or garble (those, links, Discord formatting, emoji shortcodes,
blocked slang, and scores or ranks members never see). A new observation
goes into the crosswalk first, then here, with a test. An unexplained
blank ("Season 135 is underway", 2026-08-03) has no rule: a guess encoded
as a rule is superstition.

**Every action keeps its own log** (Jamie: "for the agent team to review
per action to improve the system"): append-only entries
(`action_log#<clan>#<card id>#<entry id>`, one item each, ordered by time
and a tie-breaking `seq`) for what raised it (the rule's headline, the
policy version and clauses, the facts, and the member's earlier actions of
the same kind with how they closed), a withdrawal and why, who completed
or declined it with their note and reason, what the record confirmed or
flagged, and anyone's comments, open or closed. An action raised before
logs existed has its log reconstructed from its own fields, marked so.

**Every action has a number** (Jamie, 2026-09-25: "take a look at action
37"), the clan's own sequence, never reused: `action_seq#<clan>` is an
atomic counter (DynamoDB `ADD`), stamped on the action when it is raised;
actions raised before numbers existed were numbered once, oldest first,
by a conditional write that never overwrites a number. **Each action has
its own page**, `/clan/<TAG>/actions/<number>` (`GET
/api/clans/<TAG>/actions/<number>`), the address people send each other:
the whole action with its log open, its buttons, the comment box and
"Copy link". Only those the action is for can open it; anyone else, and
a number the clan does not have, gets the same `404 no_action`, so an
address never tells anyone a removal exists. The page reads the ledger
and never evaluates.

Surfaces: **Actions** (`/clan/<TAG>/actions`, `GET /api/clans/<TAG>/actions`,
the rail's count is `/api/me`'s `open_actions`) for everyone in a clan with
an active policy: a list, one line per action (number, what, who, when,
comments), of what waits for you and what closed in the last 30 days;
each line opens the action's page. Opening the list evaluates. The
leaders' old Inbox address lands there. `POST .../actions/<id>/decide` and
`POST .../actions/<id>/comments` (by card id). History shows each closed
action's number, linked to its page, and its log.
The agent team reads logs from the host, read-only:
`node scripts/actions.mjs clans | list | show | review --clan <TAG>`
(`review` picks declines, quick withdrawals, flagged outcomes and anything
commented).

## You here (2026-09-25)

Every member's own page in a clan (`/clan/<TAG>/me`, `GET
/api/clans/<TAG>/me`, `memberWeeks` in `services/engine/src/member.mjs`):
this week so far and week by week (battles, ranked battles, donations, war
decks against those asked, points), trophies today, and time here (join and
role changes from the roster's events). These are statistics, so the page
works for any clan, with no policy or below 10 members. Once the policy is
active it adds what the clan makes of them: what it counts, the member's
status and evidence, what would move them, their minimums met or not, days
toward Elder, their own inactivity clock, their actions waiting, their hold
or away, and their trophies here. One participation read and one roster
read, judged on the spot with `evaluate`: opening it never raises an
action. Only the viewer's own lines: no one else's, no notes, no removal
action about them.

## Sharing with Elixir (2026-09-25, door 3)

What the clan did goes back to Elixir as **attested facts**, on the acting
person's own grant (`POST /api/v1/clans/{tag}/facts`, JSON API 2.2.0,
scope `clans:attest`; `services/api/src/manage/sharing.mjs`). Elixir keeps
them apart from the game record, labelled as that person's word through
Elixir Clan, and shows each only to the readers its type allows (a kick or
an away only to the clan's leaders, never to an agent, so a kick is never
narrated). **The clan chooses what leaves it**: one switch per type in
Clan settings (`GET|PUT /api/clans/<TAG>/sharing`, `sharing#<clan>`),
every one off to start, leaders and co-leaders only. What is shared, and
when (`factsOfAction`):

- a departure answered Kicked or Left, or a removal completed:
  `departure_classified` (kick or leave);
- a promotion or demotion completed: `role_change_made`, and its Clan
  Leader Message as `clan_message` in the words the leader edited and
  sent (the card sends them with the completion);
- a welcome completed: its clan chat line as `clan_message`;
- the season's awards announcement sent: its Leader Message, and each
  winner of that season as `award_granted`;
- the rules announcement sent: its Leader Message;
- a member marks themselves away: `member_away`, taken back when cleared.

A removal's chat line names an inactive member and is never shared as a
message. Sharing is best effort and never holds up the action; the
action's log says `shared` or `not_shared` and why. The ref Elixir keeps
is Clan's own (`action:<card id>`, `award:<season>:<award>:<tag>`,
`away:<tag>`), so a retry is the same fact. Manual award grants and their
revocation are not shared yet.

## Spreading the word (2026-09-25)

Clans arrive member-first, so the clan page carries one card for where the
clan is (`apps/web/src/components/SpreadWord.jsx`): below 10 members, a
pointer to Recruit; with 10 and no policy, **Invite your leaders** for a
member or elder (what setting up turns on, a clan chat line from
`inviteCopy("leaders")` and the link to copy for Discord or a message) or
**Set up how the clan runs** for a leader or co-leader; with an active
policy, **Bring your clanmates** (`inviteCopy("clanmates")`) for anyone.
The chat lines carry no link: the game's filter is wary of links, so the
link is its own copy.

## Roles in Manage

From the roster, as the gate resolves them. Leader and co-leader: Manage
(board, history, policy, clan settings, awards, scout), the leaders'
actions, holds, leader notes, and every note. Elder: the elders' actions, elder notes (write and
read), awards (read; grant what elders may), scout. Everyone in the clan,
once there is an active policy: Actions (their own), Standing ("How it works
here" and their own line, plus where everyone stands when Elder is ranked
and `members_see_standing` is on) and Trophies. Nobody below co-leader ever
sees a removal action or who is on a clock.

## What is stored, second push

The `elixir-clan` table gains, per clan, through the `ByClan` index:
the member count at the latest read (`clan_size#`), policy versions, the latest verdict snapshot (evidence summaries only,
overwritten each evaluation), actions (`card#`, kept: this ledger is how a
leave is told from a kick; each carries its `number`) and each action's
log (`action_log#`), holds,
and notes (tiered `leader` / `elder`), and the uses of the clan's model
(`model_call#`, 90 days). Tags and summaries, never Elixir payloads. The
clan's sealed model key (`model_key#`) and the action-number counter
(`action_seq#`) are the clan items outside the index. `ledger.deleteClan` removes the set, the key included; call it when
a clan's last verified leader disconnects. Evaluation runs on demand with
the signed-in person's token, cached five minutes per clan, and each
morning on Elixir Clan's own integration key (see "The morning
evaluation"); no person's token is ever stored for it.

## Elixir JSON API operations this app depends on

Each answers with the named Elixir tool's structured result, at the hub's
current JSON API version (see `packages/contracts/integration-api.openapi.json`
`info.version` in elixir-mcp; a removed or renamed field is a major there).

| Operation | Tool result | Used for |
|---|---|---|
| `GET /api/v1/me` | principal + `elixir_my_players` | the gate |
| `GET /api/v1/clans/{tag}/roster` | `clans_roster` | the clan page, departures, history, today's trophies when the policy counts trophy road |
| `GET /api/v1/clans/{tag}/participation?weeks=8` | `clans_participation` | every evaluation: one call, eight weeks, no agent-sized cap |
| `POST /api/v1/players/names` | `players_names` | name legacy departure cards whose roster event carried only a tag |
| `GET /api/v1/players/{tag}/profile?fresh=1`, `GET /api/v1/players/{tag}/battles?limit=25&fresh=1` | `players_profile`, `battles_query` | scouting an applicant; `live_pending` is passed through with `retry_after_s` |
| `GET /api/v1/clans/{tag}/live` | `live_fetch /clans/{tag}` | recruit facts |

Elixir returns facts; every threshold, score and verdict is here.

## Quota discipline

Clan is a first-party client (every redirect URI on a family origin), so its
reads spend no one's Elixir quota (Jamie, 2026-09-23). We are still frugal: the
gate answer and roster are cached per session; "check again" is floored at 30 s
server-side; ordinary record data never polls. A pending live read may retry at
Elixir's requested interval (Scout stops after six attempts). The page shows
`meta.freshness_seconds`/`as_of` the way Elixir does (`Fresh`).

## AWS and deploying

- `--profile cloud-engineer`, `us-east-1`, hobby-account rules from `~/Projects/AGENTS.md`.
  No em dashes in resource names.
- One stack `elixir-clan` (`infra/template.yaml`): 35-day PITR and deletion
  protection on the retained table, function, HTTP API
  (spelled out: integration, `$default` route and stage with an access log),
  private bucket + CloudFront, SNS `elixir-clan-alarms`, three alarms (Lambda
  errors, API 5xx, slow requests p90 > 8 s on Lambda Duration), 30-day logs.
  No billing alarm: an account-wide guard is not one product's to carry
  (removed 2026-09-24, Jamie).
- `infra/scripts/parameters.mjs` carries Drop's discipline: REQUIRED (code
  key) is always sent; PRESERVED (`AppUrl`, `ElixirUrl`, `OAuthClientId`,
  `AppSecretName`, `SiteCertificateArn`) rides
  `UsePreviousValue`. Set one with `--param=Key=Value`; omitting is never a
  reset. A test pins the template's parameter list to that set.
- Local: `AWS_PROFILE=cloud-engineer node infra/scripts/deploy.mjs` (build → upload →
  stack → web → smoke). `--create` for a first deploy, `--skip-web` for code
  only.
- CI: `validate` on every push/PR (no network, no spend); `deploy` on main
  after green, with the `elixir-clan-deploy` user's static keys and the
  `elixir-clan-cloudformation-execution` role, both from
  `infra/scripts/bootstrap.mjs`, exactly Drop's pattern.
- Deployment IAM is defined in `infra/scripts/iam-policies.mjs`. The existing
  execution role may edit only the application role, whose administrator-owned
  boundary is retained by the template. IAM repairs use the dedicated approved
  `secure-iam.mjs` flow in `infra/IAM.md`; general bootstrap also handles secrets
  and keys. Install the boundary before pushing a template that requires it.
- Alarms route to the sysadmin `projects-ops-alerts` queue via
  `infra/scripts/wire-alarms.mjs` (queue policy + raw subscription). No email.
- Secrets: load the `aws-secrets-manager` skill before touching any; never
  `get-secret-value`.
- Tests: `npm run verify` (prettier, oxlint, node:test + vitest). Every seam
  is injected; no test reaches the network.
- Deployment smoke uses only reads that cannot change live state. It never
  visits `/auth/login`, which creates a pending login even on GET; the
  handler tests cover the OAuth redirect and PKCE offline.

## Logging: one story per request

`services/api/src/trace.mjs` (2026-09-12, after slow pages and a log group
holding only START/END/REPORT). Every request runs inside a trace; every
Elixir call (`elixir-api.mjs`, `oauth.mjs`), every call to a clan's own
model (`anthropic.mjs`: `model_ms`/`model_calls` and `model: [{ call, ms,
ok, status|code, input_tokens, output_tokens }]`, and `model` in
Server-Timing) and every table operation (`store.mjs`, `ledger.mjs`) is
timed into it. The handler ends the request with:

- **one JSON line** in `/aws/lambda/elixir-clan-api`: `http` (the route with
  ids and tags as `*`), `status`, `ms`, `elixir_ms`/`elixir_calls`,
  `store_ms`/`store_ops`, `cold`, the clan and role for a clan route, and
  `elixir: [{ call, ms, ok, status|code, request_id, bytes }]` where
  `request_id` is Elixir's own `meta.request_id` for that call, the key to
  its call log. Level `warn` when the request took over 8 s or answered
  5xx; a single Elixir call over 5 s gets its own `slow_elixir_call` line.
  Never a token, a cookie or a body.
- no custom metrics: the `elixir-clan-slow-requests` alarm watches the
  Lambda's own `Duration` p90 (free), and a metric exists only to back an
  alarm (2026-09-24, the Elixir family's rule; no one reads CloudWatch by
  hand, so there is no dashboard).
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
| `clan.action_decided`, `clan.action_commented` | `<type>:<status or classification>` e.g. `removal:done`, `departure:leave`; the type |
| `clan.hold_set`, `clan.note_added` | `until` \| `open`; `leader` \| `elder` |
| `clan.policy_previewed`, `clan.policy_saved`, `clan.policy_preset` | (none); `v<n>`; the preset key or `goals` |
| `clan.awards_saved`, `clan.award_granted` | `v<n>`; the award kind |
| `clan.scout` | `answered` \| `pending` |
| `clan.away_set`, `clan.away_cleared` | (none) |
| `clan.feedback_sent`, `clan.feedback_answered` | the category; the status |
| `clan.copy_in_game` | (none), or `leader_message` for a Leader Message field |
| `clan.action_link_copied` | (none) |
| `clan.invite_copied` | `leaders` \| `clanmates` \| `link` |
| `clan.recruit_copied`, `clan.recruit_saved` | `personal` \| `post`; `v<n>` |
| `clan.model_key_set`, `clan.model_key_removed`, `clan.model_drafted` | (none); (none); the purpose (`recruit_pitch`) |
| `clan.sharing_saved` | the kinds switched on, comma-separated, or `none` |
| `web.api_timeout`, `web.api_network`, `web.api_bad_response`, `web.api_slow` (over 3 s) | the route key, ids as `*` |

No server-side events: Elixir's go through its email relay with an API
token; this product has no relay and sends nothing from the Lambda.

## Design dependency

`apps/web` depends on `elixir-mcp` as a **pinned git dependency** (a commit
SHA in `apps/web/package.json`) and imports from it as SOURCE - no build
step in either repo:

- `elixir-mcp/packages/design/src/{tokens,components}.css` into
  `apps/web/src/styles.css`, this app's Tailwind entry, which adds its own
  `@source` (this app and the kit) and compiles its own file through
  `@tailwindcss/vite`. Tailwind's palette, type scale and radii are reset
  there; the utility vocabulary is Elixir's tokens (`bg-ground`,
  `text-ink-faint`, `rounded-panel`, `wide:`/`max-wide:` at 900px).
- `elixir-mcp/packages/ui/src/index.ts` - Chrome, Rail, RailIdentity,
  Fresh, Markdown, Icon, ErrorBoundary, Disclaimer, and the clock
  (`ago`, `agoSeconds`, `freshCls`). What goes ON the rail is
  `src/lib/rail.js`; the rail itself is the kit's.
- `elixir-mcp/packages/client/src/index.ts` - the `{ ok, status, data }`
  envelope, `createClient()` (this app passes its route-aware label so no
  clan tag reaches analytics), `answered()`/`unwrap()`, and the query
  client. `src/lib/queries.js` is this app's keys and hooks; `useGated()`
  keeps the `{ loading, signedOut, forbidden, error, data }` shape the
  views read and owns the server-side `?refresh=1` re-read.

The kit's runtime dependencies (`react`, `@tanstack/*`, `lucide-react`,
`marked`, `tailwindcss`) are declared HERE, because a git dependency's
workspace packages bring none of their own. The Clash display font is
copied from the dependency at build time (`apps/web/scripts/fonts.mjs`,
gitignored). Bump the SHA to take a change; never copy a file.
Publishing the packages to npm is the durable answer and needs Jamie's
npm org (docs/NOTES.md). Foundation plan and rationale:
`../elixir-family/plans/console-clan-foundation.md`.

## The team

`AGENT-TEAM/` holds four objective owners (Run Elixir Clan, Judge Fairly,
Close the Loop, Guard the Door), the operating loop (`WORKFLOW.md`), the
reading map, the calendar (`automations.toml` → `SCHEDULE.md`) and the
checkout lease (`scripts/objective-lease.mjs`). Every mutating actor on
this checkout, an objective run or an interactive session, claims the
lease before the first edit and releases it clean. Feedback is Close the
Loop's daily duty.

## The morning evaluation (2026-09-25, door 1)

Every clan with a policy is evaluated daily at 11:00 UTC, after the war
day's reset, so actions wait for leaders and a closed season's awards are
granted without anyone visiting. EventBridge invokes the one function with
`{"scheduled":"evaluate"}` (`EvaluateSchedule` in the template;
`services/api/src/scheduled.mjs`); it reads Elixir on Elixir Clan's OWN
integration key (`elixir-clan`, permission `clans:read`, JSON API 2.3.0),
never a person's token, and runs the same `evaluateClan` a visit runs,
then the awards evaluation. Nothing is shared with Elixir (sharing is a
person's act). One clan's failure never stops the rest; the run writes
one JSON line (`scheduled: "evaluate"`, each clan's result, never the
key). The list is `schedule#<clan>` in the `schedule#clans` partition of
the index, put when a policy is saved or evaluated.

**Then the email (door 2, JSON API 2.4.0).** After each clan's
evaluation, `mailActionsWaiting` emails, through Elixir, each person who
can act on something that became theirs since their last email
(`actionsWaitingMail` in `services/engine/src/mail.mjs`: only people who
can act on an action are sent it, Jamie; the email lists everything
waiting for them by number, the new marked, and links the one action's
page when only one is waiting). Clan names each person by player tag
(`POST /api/v1/clans/{tag}/mail`, kind `clan_actions_waiting`, on the same
key, which holds `mail:send`); Elixir sends only to the account that
verified the player, while in the clan, with the kind on (on to start),
at most one a day per clan, and answers each message's outcome, never an
address. Clan remembers the answer (`mailed#<clan>#<tag>`), so the next
email waits for something new, and each action's log says it was
emailed. The Actions page says so and links Elixir's email settings.

The key is the NoEcho stack parameter `ElixirIntegrationKey` (PRESERVED,
env `ELIXIR_INTEGRATION_KEY`), minted locally and provisioned through
Elixir's `{integration}` migrate op with only its digest, then staged once
with `--param`; nobody reads it. Empty means the run does nothing and
says so. The rule exists only when `ScheduleEnabled` is `true`, which
needs the execution role's `events:*` statement on `rule/elixir-clan-*`
(`infra/scripts/iam-policies.mjs`): an administrator change
(`infra/IAM.md`), then `--param=ScheduleEnabled=true` once.

---

*This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*
