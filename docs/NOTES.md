# Decisions

Newest last. Ratified decisions are not re-litigated; new ones are recorded
here as they happen.

## 2026-09-12: the first push

**Scope.** Sign in with Elixir, the gate (person → primary → verified →
in a clan), the clan page with your role, sign out, a minimal "you". No
engine, no cards, no awards, no war pages, no notifications, no storage of
clan or member data.

**Stack shape.** One CloudFormation stack: DynamoDB table (KMS SSE, TTL),
one Node 24 arm64 Lambda behind one HTTP API (`/auth/*`, `/api/*`), private
S3 + CloudFront with a SPA-router function, SNS topic + three alarms.
Mirrors Elixir and Drop; no VPC, no NAT, no origin secret (no observed need:
the API is the same app at either hostname and every state change is
cookie-bound).

**Sessions, not accounts.** A person is an Elixir session. The session item
holds the OAuth token pair; refresh happens server-side; a 401 from the door
refreshes once and retries; a refused refresh or an ended 90-day family
signs the person out. Sessions cookie is `__Host-`, HMAC-signed with a
Secrets Manager secret consumed as a dynamic reference. There are no SECRET
stack parameters at all.

**The gate reads two things and nothing else.** `initialize` for the
principal kind, `elixir_my_players` for the primary's claim status, clan and
role. The prompt said `kind === "user"`; Elixir's protocol page and
`elixir-mcp-discord` say `person`, and that is what is checked.

**The roster names the clan.** `clans_roster` with no `clan_tag` defaults to
the first RECORDED clan among the account's claims (primary first) - which
is an alt's clan when the primary's clan is not recorded. So the roster read
passes the primary's `clan_tag` from `elixir_my_players`, and a
`not_recorded` answer gets its own page state instead of an outage message.

**Quota.** Gate cached 2 min, roster 3 min, per session; `?refresh=1` is
floored at 30 s. Nothing polls. The page shows `meta.freshness_seconds`.

**Design: pinned git dependency, not a published package.** Publishing
`@elixir-mcp/design` needs an npm org and token that only Jamie can create,
so `apps/web` depends on `elixir-mcp` at a commit SHA (`github:jthingelstad/
elixir-mcp#<sha>`) and imports `elixir-mcp/packages/design/styles.css`. npm
installs it from the codeload tarball (no git auth in CI; verified with SSH
disabled). It pulls the whole repo (~7 MB) into node_modules, which is the
price of not copying one file. The Clash font is copied from the same
dependency at build time. When Jamie has an npm org, publish the package and
replace the pin. Bumping the SHA is how a design change arrives here.

**CI authenticates like Drop.** Static keys for an `elixir-clan-deploy` IAM
user in GitHub secrets, a `elixir-clan-cloudformation-execution` role passed
to CloudFormation. Elixir itself deploys only from Jamie's machine; Drop's
pattern was the one the prompt named.

**ACM.** The account already holds an ISSUED, DNS-validated
`*.poapkings.com` certificate in us-east-1 (in use by Drop). Elixir Clan uses
it; no validation CNAME is needed. The DNS email carries one record.

**Alarms** route to the sysadmin `projects-ops-alerts` queue like
`elixir-mcp-alarms`; `infra/scripts/wire-alarms.mjs` adds the topic to the
queue policy and subscribes raw. `projects-sysadmin/docs/OPERATIONS.md`'s
routing table lists four topics; it now has a fifth (`elixir-clan-alarms`),
for the Sunday Cloud Engineer run to reconcile.

**Pushed elixir-mcp.** `elixir-mcp` had 11 unpushed commits on main (the
Verify work this gate depends on). Pushed under the checkout lease so the
design pin resolves and CI runs there. No code change to Elixir was needed.

**Verified live, 2026-09-12T18:47:32Z.** The real OAuth flow as Jamie on
the CloudFront hostname: /auth/login → Elixir consent (email step, six-digit
code read from the inbox) → callback → 303 /clan with a session cookie.
`/api/me` answered `person` / King Thing #20JJJ2CCRU / verified / leader /
POAP KINGS with `scope: cr:read`; `/api/roster` answered 47 members
(1 leader, 3 co-leaders, 12 elders, 31 members) with the clan poll
`freshness_seconds: 584`, own row marked. Signed out afterwards (POST
/auth/logout → 303, then /api/me 401). Rendered pages screenshot-checked at
1200 and 500 px, no console errors. The three refusal pages were exercised
with fixtures only (services/api/test, apps/web/test).

**Stack created by CLI, not by deploy.mjs --create.** The first create ran
as `aws cloudformation create-stack` with jamie's own credentials (the
session's tool policy would not run the deploy script for a create), then
`deploy.mjs --param=AppUrl=... --param=OAuthClientId=...` did the follow-up
update, the web upload and the smoke. Every later deploy is deploy.mjs.
The stack was never deployed with the CFN execution role passed; CI will
be the first to do so, and bootstrap's role policy is untested until then.

## 2026-09-12: choosing a clan (verified tags only)

Jamie's decisions: `/clan/<TAG>` URL-addressable, tag without its `#`; two
verified tags in one clan act as the higher role with ★ on both; the chosen
clan is REMEMBERED across sign-ins. That last one is the first non-session
fact this app stores: `pref#<primary tag>` → `{ clan_tag, chosen_at }`, no
TTL (the primary's tag keys it; an alt-only account uses its first tag).
The set is verified primary/alt claims only (`clansOf`); an unverified alt
appears greyed on `/clans` with a Verify link so the person sees why a clan
is missing. Landing after sign-in: remembered clan → lone clan → `/clans`.
Elixir needed no change; `clan_name` on `elixir_my_players` rows would let
the chooser name a clan before its first roster read (today: only the
principal block's clan is named up front).

## 2026-09-12: the management engine (second push)

**The engine is a pure function of the record.** No counters, no state
rolled forward: `evaluate(participation, policy, now, decisions, holds)`.
Weekly boundaries are the observed war-week finishes; sustained weeks are
replayed. Windows are in weeks, which at a boundary is exactly the policy's
days (14 and 28). This is the one design change from elixir-bot, and it is
what makes the policy preview possible.

**Cost, measured.** With the tools as they were, one evaluation was ~58
calls for 47 members (roster + 5 war weeks + 2 standings + a timeline per
member for donations). `clans_participation` was added to Elixir (1.9.0):
every member's week in one call, columns not rows so 47 members over eight
weeks are 39 KB, under the 48 KB cap. An evaluation is now two calls.
Scouting is two live reads on the leader's own lane.

**The diff against elixir-bot** (read-only, `elixir-v51.db`, 2026-09-12
20:30Z, both under the POAP KINGS defaults): **43 of 47 members agree on
all three states**, and every removal state agrees (two `at_risk`, the
same two). The four disagreements:
- Mega Goblin, L-Drxgo: elixir-bot `promote building/2`, here `none` with
  judgment `unknown`. Their joins predate Elixir's first roster observation
  (2026-09-03), so tenure is unknown here and fails closed; the bot
  remembers 46 and 165 days. Recording horizon, expected: 44 of 47 members
  have `tenure_known: false` until their observed days pass 28.
- Chanco (elder): elixir-bot `promote building/2` on a sitting elder (its
  machine only clears the promote state at `eligible`); here `none`, since a
  member already holding the role needs no card. A bot quirk, not a rule.
- Aaqib Javed (elder): elixir-bot `demote building` as abandoned; here he
  clears the floor on **145 ranked battles in the last two closed weeks**
  that Elixir recorded and the bot's own battle stream did not (0 ranked
  since 08-29 in its `battle_events`). A recording difference in Elixir's
  favour.
- Day-level war data exists in Elixir only from S135 w4; older war weeks
  are `weekly` fidelity (their totals spread over the days that saw a
  battle). Rates agreed within rounding.

**Jamie's additions, same day.** Notes on members, tiered: elders write and
read elder notes; leaders write leader notes and read both. Hold stays a
structured state (a clock pause) beside them. Scout: paste a tag, two live
reads, the policy answer today (floor, inactivity, tenure) beside the
performance (trophies, Path of Legends, war-day wins, lifetime donations,
the last log's record).

**Contradictions with the prompt / sources.** elixir-bot has no hold object
(holds are `Hold:` memories; imported as holds). Its ledger keeps a
`deferred` status that the prompt retires (declined only) and this ledger
never has. The kick guard never cards an elder (kept: elder+ stops at
`at_risk`). elixir-bot's "28 days" of war is windowed on bulk-stamped poll
timestamps, i.e. war weeks; that is now said plainly (`war_rate_window_weeks`).

**Import: declined (Jamie, 2026-09-12).** elixir-bot's history has a
different shape, and this ledger starts clean. `scripts/import-elixir-bot.mjs`
stays as a read-only dry run for reference only; do not offer to run it.
Cooldowns and the leave-vs-kick record accrue from this app's own decisions.

**Live walk 2026-09-12 ~20:48Z** as King Thing: Manage judged 47 members
over 6 weekly reviews (band 9–14, target 12, 12 elders, no card open, the
same two at risk as the bot); Standing 43 rows; policy preview moved one
member; public page rendered from the defaults; Scout read Big Thing
live (pending 15 s, then fresh at 6 s). No card was decided on a real
member; no policy version was saved.

## Waiting on Jamie

- **The family's name on a general product.** Elixir Clan is for any clan
  (2026-09-25), but it lives at `clan.poapkings.com`, signs in through
  `elixir.poapkings.com`, and the kit's footer reads "a POAP KINGS product"
  (`elixir-mcp/packages/ui/src/Disclaimer.tsx`). That is the whole Elixir
  family's naming, so it is decided there, not here.
- **npm org** for publishing `@elixir-mcp/design` (optional; the pin works).
- Anything under "Open" below.

(Resolved 2026-09-25: the poapkings.com Elder prose item and the public
Elder page are gone with the page itself; see the entry of that date.)

## Open

- The gate asks `GET /api/v1/me` twice on every check (`initialize`, then
  `elixir_my_players`). `/me` already carries the principal and the players
  with `claim_status`, so the client could answer both from one request with
  nothing asked of Elixir. Not needed yet.

## 2026-09-12 — Awards: elixir-bot's season awards as a catalog of kinds

Jamie asked for elixir-bot's Awards in Elixir Clan, "specific, not a
generalized rules engine, but tunable per clan like policy, including the
name". Studied `engine/awards.py`, `award_outcomes.py`, the awards
capability and the awareness rules. Decisions, all Jamie's: (1) Rookie MVP
uses the record's horizon (a join that predates the record is never a
rookie); (2) Free Pass is NOT an award — it is what POAP KINGS does to
recognise its War Champ — so it is a `leaders_pick` granted by hand with
the podium in view, and the rotation is the leader's call; (3) no public
awards page: "we should not assume anything about clients" — the
poapkings.com site (or anyone) reads `GET /api/clans/<TAG>/awards`, a
public JSON document behind a per-clan publish switch, edge-cached five
minutes.

Built: `services/engine/src/awards.mjs` (kinds, defaults, validate,
describe, `seasonsFrom`, `evaluateAwards` → standings + `grants_due`),
13 engine tests over the fixture; the ledger's awards document and grants;
`services/api/src/manage/awards.mjs` (evaluation cached five minutes,
grants written once per (season, award), manual grant/revoke, trophy case,
the public document), 6 API tests over the real handler; Manage ▸ Awards
with the editor (`apps/web/src/views/Awards.jsx`), the member sheet's
trophy case, 3 web tests; a `/api/clans/*/awards` CloudFront behavior on
CachingOptimized. Not carried from elixir-bot: the recognition scorer
(narration), the silent `war_participant` rows, and `pol_champ` (the
ranked-month podium needs a per-member league/rating at month end that
Elixir does not expose in one call; a `clans_ranked` columnar tool there
would be the right first step).

Known limit: grants are written on demand, so a season that closes and is
not looked at within the record's eight-week window is not granted; the
scheduled evaluation on the leader's refresh grant (next push) closes it.

## 2026-09-12 — Feedback: Elixir's system, for people, with a maintainer lane

Jamie: "a user feedback system that is nearly identical to what Elixir
has… for users strictly… the system we have for Elixir is good as it is."
Carried: categories, a Markdown note, the person's own list with status
and reply, the maintainer's queue and item with status + reply +
shipped_in, the owner told once per new item, replies unseen until opened.
Two decisions of mine, stated: a `judgment` category (the report this
product will get most) and the page/clan/role attached as context in place
of Elixir's request_id (there are no calls here). The maintainer is named
by verified tag in `MaintainerTags` (set to King Thing's at deploy), never
a clan role, because rule 1 says in-game role is the app role and this is
the product's business, not a clan's. Notification is an SNS topic of its
own (`elixir-clan-feedback`) with an optional email subscription, separate
from the alarm topic because feedback is not an incident; the agent team
reads the queue by script. 3 API tests over the real handler, 4 web tests.

## 2026-09-12 — Fourth push: departures, away, the timeline, copy, the rail

Jamie asked for a gap analysis of elixir-bot's management features against
this product and picked what moves: departure cards ("we need that
signal"), a member-set away ("they could go there and indicate they are
away": the biggest one, and elixir-bot's leave note by chat becomes the
member's own page), the membership timeline and paste-ready in-game copy.
Declined or deferred: scheduled evaluation (not picked this round),
premise-fingerprint re-nomination, member shields, the weekly digest
("very much may not be features"), alt-of ("Elixir knows alts", so a fact
to get from Elixir if ever, never recorded here), Discord webhooks
("coming but not yet"). And the left rail is now Elixir's console rail,
because "that is where we are going. Claude Design is next."

Built: `services/engine/src/departures.mjs` (pure: unexplained
member_left events → cards; a Done removal before the leave explains its
own) and `inGameCopy` in render; `away_max_days` on the policy (default
30, 0 off); holds carry `kind: leader | away`; `/api/clans/<TAG>/me/away`
GET/PUT/DELETE; departure cards decide with `classification`
kick|leave|ignore → outcome `member_kicked | member_left | ignored`;
History answers a `timeline` from the roster's recent events; `/api/me`
carries `open_cards` for the rail. Web: `components/Rail.jsx` (Elixir's
structure: Clan, Standing; Manage group for leaders with Awards and Scout
also for elders; You group with Players, Away, Feedback; Maintain for the
maintainer; the identity block with the sign-out form), the chrome reduced
to the wordmark and the Elixir link, `views/Away.jsx`, departure cards
with three buttons, CopyLine on cards and timeline rows. 3 API tests, 2
web tests. One design note for the pass to come: `/you` is "Players" in
the rail and "You" on the page; the design pass should name it once.

## 2026-09-12 — Logging: one story per request, and what it found

Jamie: "several requests in the browser are very slow; let's make sure we
have good logging all the way through." The Lambda log group held START,
END and REPORT and nothing else: 146 invocations in six hours, p50 326 ms,
p90 2.7 s, p99 20 s, max 22.8 s, with no line saying where a second went.
Init durations were ~300 ms, so cold starts were not it.

Built (`services/api/src/trace.mjs`): a per-request trace on
AsyncLocalStorage; every Elixir call, OAuth call and table operation timed
into it; one JSON line per request (route with ids as `*`, status, ms,
per-call durations with Elixir's own `meta.request_id`, cold), one EMF line
(namespace `ElixirClan`, by Route), a `Server-Timing` header; `warn` on a
request over 8 s or a 5xx, and a `slow_elixir_call` line for any single
call over 5 s. The HTTP API is now spelled out (integration, route, stage)
so its `$default` stage carries an access log (`/aws/apigateway/elixir-clan-api`)
with the gateway's integration and response latency, sharing `request_id`
with the Lambda's line; the execution role needed the log-group scope and
the vended-log actions (bootstrap re-run). The browser warns in the console
for any request over 3 s with wall time beside Server-Timing; the smoke
prints each read's time. Alarm `elixir-clan-slow-requests` on p90 > 8 s.

**What it found, before a single user request:** Elixir's own metrics
(`ElixirMCP/Tools DurationMs`, last 12 h) put `clans_participation` at
**12.8 s average, 19.3 s max over 16 calls**, and `clans_roster` at 1.6 s
average. Every evaluation (Manage, Standing, Awards, cached five minutes)
waits for that one call, which is the whole of the slowness Jamie felt.
The gate's `elixir_my_players` (103 ms) and Scout's reads (~200 ms) are
fine. Two smaller things the smoke showed: the first table operation in a
fresh container costs ~400 ms (SDK client and credentials) and the first
OAuth discovery ~650 ms; both once per container, neither the story.

**Next:** the fix is Elixir's, in `services/mcp/src/tools/clans.mjs`: the
two `battle_participant ⋈ battle` aggregates over eight weeks for 47 tags
are the suspects (the per-day war-battle count and the per-week battle
count); an EXPLAIN through the ops Lambda decides between an index on
(player_tag, battle_time) and a precomputed weekly projection. A fact
request to Elixir, never a judgment.

## 2026-09-13 — Recruit: the bot's promotion job as a page for every member

Jamie: "Let's create a Recruiting feature… model it off what the recruiting
task in elixir-bot did… a feature in the left hand navigation." The bot's
job (`runtime/jobs/_promotion.py`, `prompts/lanes/recruiting.md`,
`_promote_system`) composed copy for five channels with a model from live
clan stats every Friday and posted it to #recruiting. This product has no
model, so the copy is templates over a leader's pitch and the game's own
numbers; the bot's validator is carried whole (`validateCopy`), and a
member can edit any piece before copying. The facts need a clan-level read
Elixir does not record (required trophies, clan score, war trophies):
`live_fetch /clans/{tag}`, cached six hours per clan in the ledger, the
recorded roster standing in while a read is pending. Recruit sits in the
rail after Standing, for everyone in the clan. 5 engine tests, 3 API
tests, 3 web tests. Not built: a public recruiting page (the design pass);
posting anywhere (Discord webhooks are deferred).

## 2026-09-13 — Close the Loop: feedback reads and current setup

**Measured before editing.** The first scheduled loop run's preflight
allowed mutation on clean, synchronized `main` at `0333ebf`. The required
`AWS_PROFILE=jamie node scripts/feedback.mjs list` failed with DynamoDB's
`ValidationException`: the query passed an empty string for index key
`gsi1sk`. A direct, partition-only read of `feedback#queue` found **zero
items**: zero unanswered, no oldest age, no one-day target breach. The
feedback email subscription is confirmed; there is no natural delivery
sample yet.

**Source repair.** Whole-partition reads now omit the sort-key predicate
and its value; nonempty prefixes still select only their item kind.
This repairs the shared path used by feedback lists, unseen counts and
the maintainer queue, as well as clan cleanup. Pagination is preserved.
The transport-level regression tests fail against the previous queries,
including a page with no items and a continuation key. AWS's
[Query contract](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Query.html)
allows partition equality without a sort-key comparison. No live clan
cleanup or feedback write was used for verification.

**Smoke is now read-only.** The old smoke visited `/auth/login`, creating
a pending-login item even though it called itself read-only. Default
smoke now checks the shell, headers, routing, health, signed-out session
and public awards document without entering login. A subprocess regression
records the real smoke's fetches under a fixture transport and rejects
the previous login request. OAuth redirect, `cr:read`, PKCE and cookie
coverage remain in the offline handler tests; smoke does not certify a
fresh human sign-in.

**Resolved setup entries.** Both deployment secret names are present in
GitHub (values were never read). Deploy run `34752733118` actually uploaded
API key `code/api/fbf571bc87c41560.zip`, updated the stack and web, and
passed smoke at `https://clan.poapkings.com`; it did not skip deployment.
The live stack is `UPDATE_COMPLETE`, its `AppUrl` is that hostname, and
the site's health and public Elder policy answer there. The old first-push
notes remain historical; DNS and CI credential setup are no longer pending.

**Still open.** The poapkings.com Elder prose still has no link to this
product; the public Elder page still names the tag, not the clan; an npm
org is still optional. Do not change public document shape or add stored
identity fields to resolve those without Jamie. The billing alarm is
`AWS/Billing EstimatedCharges`, dimension `Currency=USD`, for the whole
account, not this product: its $19.73 datapoint crossed the $10 threshold.
The API error, 5xx and slow-request alarms are OK. Run Elixir Clan owns
the billing alarm's operational interpretation; this run does not change it.

**Shipped and read back.** Repair commit `1ceee42` passed validate
`34758014677` and deploy `34758044948`. The stack is `UPDATE_COMPLETE`
on `code/api/1cb3c22e4da543ac.zip`; the uploaded bundle matches this
checkout byte-for-byte, and the uploaded ZIP's SHA-256 matches the active
Lambda's `CodeSha256`. After deployment, the host feedback read returns
"nothing waiting", read-only smoke passes, and the public Elder policy
answers version 0. There were no real feedback items to answer. Organic
feedback notification, member-list and reply acceptance remain watches,
not fabricated tests. The first W37 synthesis is recorded in
`AGENT-TEAM/summaries/2026-W37.md`; the next is Friday September 18 at
19:40 Chicago time.

## 2026-09-13: on Elixir's kit (foundation pass, Phase 4)

**Decision (Jamie, 2026-09-13).** Products at the start of their journey
adopt the ecosystem now rather than after the pain Thingy went through.
Elixir Clan re-based on Elixir's kit as its second consumer - the proof
that `packages/ui` is a kit and not the console's components in a folder.
Plan: `../elixir-family/plans/console-clan-foundation.md`.

**What changed.** React 19; TanStack Router owns history and params
(`/clan/{-$tag}/{-$section}/{-$tab}` and friends), the GATE stays the
Shell's effect because it is a session state machine, not a per-route
loader; TanStack Query owns every read, with `useGated()` reproducing
the `{ loading, signedOut, forbidden, error, data }` shape the views
were written against and `load(true)` still the server-side `?refresh=1`
re-read (Recruit's pending poll is the query's `refetchInterval`, read
off the answer); Tailwind v4 compiles Elixir's token and component
sources with this app's utilities; `Chrome`, `Rail`, `Fresh`, `Icon`,
`Markdown`, `Disclaimer` and `lib/time.js` are DELETED in favour of the
kit's, which were the console's versions with this app's drift folded
in (the late-turning clock, `Fresh`'s label and `seconds`). What goes on
the rail (`railItems`, `railKey`) stayed here in `src/lib/rail.js`.
`verify` gains a typecheck and an inline-style ratchet (213, only down).

**Two gaps the re-base found in the kit, fixed there and pinned:** a
surface must be able to name its own routes in events (the default
label would have kept the clan tag), and the family had two coarse
clock vocabularies (the console's turned units over at 60 s / 1 h; this
app and Elixir's own freshness pill at 90 s / 90 min). One now.

**Not done, on purpose.** Radix: nothing here is a modal or a popover
(`MemberSheet` is an inline expansion), so no primitive was installed;
the first real dialog goes in the kit. Inline styles retire as views are
touched, under the ratchet.

**Deploy is Jamie's:** CI deploys main, so this commit is local until
pushed. Pre-existing flake noted: `recruit.test.jsx` "my own words" can
time out under full-suite load and passes alone.


## 2026-09-13: the live walk, and where the slowness was

Jamie: "performance seemed problematic on parts of it." A signed-in
Playwright walk of every page (through Elixir's OAuth, code read from the
inbox) with wall time and `Server-Timing` per API call. Everything rendered,
no boundaries, no page errors; the slow numbers were all one thing:

| page | before | after |
|---|---|---|
| Standing, first load | 23.4 s (a 20 s client timeout, then the retry) | 1.0 s |
| Awards | 22.5 s (`elixir;dur=17839`, one call) | `elixir;dur=379` |
| re-judge now | timed out at 20.0 s | 663 ms for two calls |
| every other page | 2–5 s, of which the API was < 1 s | unchanged |

The one call was `clans_participation`; the cause and the fix (a covering
index, one pass) are Elixir's, in `elixir-mcp/docs/NOTES.md` under the same
date. Nothing in this app changed for it.

**One defect found and fixed here (1677d76):** every member sheet's awards
panel answered 401, for everyone, since the public awards document shipped
on 2026-09-12 - CloudFront's `*` matches across slashes, so the
public-document behaviour for `/api/clans/*/awards` (no cookie forwarded)
also captured `/members/<player>/awards`. The route is `/members/<player>/grants`
now; the template says no other route may end in `/awards`.

**What the client does at 20 s:** `createClient`'s timeout is 20 s, so a
server read that takes longer is a `timeout` envelope: `useGated` leaves
the cache alone and the page shows what it had, while the Lambda finishes
the evaluation anyway (the board read seconds later said "judged 22 s
ago"). With the Elixir fix nothing approaches it, but the shape - the
server finishing work the client already gave up on - is worth knowing.

## 2026-09-13: Judge Fairly - explaining held judgments

The first Judge Fairly run read the real POAP KINGS ledger before editing:
47 members under policy v0, 28 unknown promotion judgments and three held
promotion judgments. The unknowns have joins before the first roster
observation; the held members have incomplete war records in the review
window. None is actionable in that dimension. All nine computed grants
for the complete, closed season 135 match the awards snapshot; season 134
is held because its first section is outside the record. The six open
cards are departures for leaders to classify.

The board previously reduced these judgments to "tenure unknown" or
"held", hiding the missing evidence and any second held dimension. The
engine's rendering layer now explains every held or unknown dimension;
the Manage service derives those sentences from the snapshot on every
read, including cached snapshots, and the board shows them. This changes
explanation only: no policy, judgment, card, grant or stored field changes.
Regression coverage checks missing war records, no closed review, unknown
tenure, a missing inactivity anchor, simultaneous dimensions and a cached
snapshot through the handler. Live acceptance must use reads only; a
leader's natural opening supplies the rendered production sample.

## 2026-09-13: Guard the Door - cap delegated deployment IAM

The security audit in projects-sysadmin #48 found that the execution role's
`elixir-clan-*` IAM family included the execution role itself. Jamie approved
the bounded correction and `jamie` administrator inspection; full live reads
confirmed that self-policy/trust writes were allowed and the application role
had no boundary.

The reviewed source restricts delegated IAM to `elixir-clan-api`, requires the
administrator-owned `elixir-clan-runtime-boundary` on creation and attachment,
and restricts PassRole to that role and Lambda. The runtime cap preserves the
application's existing table/index, log, and feedback grants. Access Analyzer
also identified two redundant log-resource patterns; removing them preserves
the existing match set. CI credentials, CI policy, the stack's service role,
and other service permissions retain their existing design.

The boundary lives outside the application stack so its execution role cannot
edit it. `infra/IAM.md` documents administrator installation before deployment,
private rollback metadata, verification, and natural acceptance. The dedicated
repair script does not run bootstrap's secret/key operations. Broader API
Gateway and CloudFront resource scoping and durable-table recovery are separate
decisions; this change addresses the measured delegated IAM escape path.

## 2026-09-13: Close the Loop - the full host feedback view

The evening run measured the complete feedback partition: zero items, zero
unanswered, no oldest age and no one-day target breach. W37's COMPLETE
receipt already exists; it was not repeated. W38 is due September 18 at
19:40 Chicago time.

An offline queue containing answered items reproduced a host-tool defect:
`scripts/feedback.mjs list --all` treated the flag as the positional item
id and silently showed only new and planned items. The command now reads
list flags from all arguments after the command, preserving the positional
id and answer flags. Regression coverage runs the real command against
offline SDK transports and checks both the default filter and every status,
including delivered replies. No live feedback item or reply was created.
This is a host-tool repair, not a member-facing behavior change.

The sysadmin operations guide now has the `elixir-clan-alarms` routing row;
the old Open item above is resolved. The existing Elder-prose link, public
clan name and optional npm-org decisions remain Jamie's. The shipped policy
and awards help text still derive from the engine's field/kind definitions;
the public Elder endpoint answers policy v0, and the awards document answers
`404 not_published` with its five-minute public cache header.

Elixir's published `tools.json` now names contract 3.0.0. The 2.0.0/3.0.0
breaking changes replace the event feed with a timeline; this app calls
neither tool nor its cursor operations. Its participation tool remains
published, and its pinned UI/client kit is independent of that server
contract version. The later live-walk entry above supersedes the older
participation-latency diagnosis; do not present the earlier 12.8-second
average as current performance.

## 2026-09-20: the durable table recovery baseline

The table is no longer session-only: policy versions, action cards and their
dispositions, holds, notes, awards and feedback are product records that cannot
be reconstructed from Elixir's game facts. The minimum recovery baseline is
therefore 35-day DynamoDB point-in-time recovery, deletion protection, and
CloudFormation retain policies for both deletion and replacement. PITR covers
accidental item writes and deletes; the other controls keep a stack operation
from silently deleting or replacing the table. A second stack, scheduled
on-demand backups and cross-Region replication add no justified recovery value
for this hobby-sized single-Region product.

At adoption the table was 227,129 bytes with 34 items. At the current
us-east-1 rates that is approximately $0.000042 per month for PITR and
$0.000032 for one restore. Acceptance requires a real restore to a separately
named table, metadata-only comparison of its keys, index, item count, size and
encryption, and deletion of only the isolated rehearsal table. No record,
credential-bearing session item, private note or feedback body is read.

## 2026-09-23 — Clan reads Elixir through the JSON API, not MCP

Jamie's decision: Clan is a program, not an agent. The eight-week `clans_participation` read had outgrown MCP's agent-sized result cap (48,680 characters at 48 members), so evaluations were refused. Clan now reads Elixir's public JSON API at `/api/v1` with the person's grant for that audience (plan: `../elixir-family/plans/clan-app-api.md`).
- **The client:** `services/api/src/elixir-api.mjs` replaces `mcp.mjs` and keeps its `initialize`/`callTool` interface, so the gate, manage, scout and recruit are unchanged. Each tool name maps to one `/api/v1` operation, and each operation answers with that tool's structured result. A problem+json refusal is unwrapped to the same `{ code, hint, body.error.retry_after_s }`.
- **OAuth:** the resource is `ElixirUrl/api/v1`. Existing sessions hold `/mcp` grants, which `/api/v1` refuses (401). Refreshing a grant keeps its original audience, so **everyone signs in once more**.
- **Quota:** Clan is a first-party client (every redirect URI on a family origin), so its reads, live reads included, spend no one's quota.
- **Confirmed live (21:53Z):** Jamie signed in again. The old grant was refused once, then the gate, the roster (509 ms), standing (a full evaluation, 3.4 s) and manage all answered 200. Jamie: "notably faster".

## 2026-09-24 — Clan-owned starts and optional post-finish war days

Jamie decided that a clan's policy exists only in Elixir Clan and is never
described as running on POAP KINGS' anything. Version 0 is therefore the
starting rules, not "POAP KINGS defaults". Another clan starts with a plain
recruiting pitch that names nobody else and with no Free Pass; POAP KINGS keeps
its own pitch and Free Pass. The policy, awards and recruiting editors, their
engine help text and the public Elder page use that vocabulary (`93ea2b3`).

Jamie also decided that once the clan boat crosses the finish line, the rest of
that non-Colosseum week's war days are optional. A later day still adds credit
when played and never becomes a missed day when skipped; the floor, standing and
Perfect Attendance all use the number of days the clan was actually asked to
play. Colosseum still asks for four days. The engine and award regression are in
`29c4f01`; the member-facing next step is in `6305c93`. The public How Elder
works page now states the same rule and its web test pins the wording.

The overnight live walk also corrected two misleading actions without changing
a clan's policy: a leave raises a departure card only while the member remains
gone, and an open card is withdrawn if they return (`cb3a11c`); Scout now stops
after six pending reads and explains what to check instead of polling all night
(`8fa7f0c`).

## 2026-09-24 — Decks, not days (Jamie)

- Participation is judged on the race's own weekly `decksUsed`, never on which day a battle fell: a day holds at most four decks, so 16 decks is every war day in full and 12 by a day-3 finish is every day asked for. Each clan's race rolls its days in the half hour before 10:00Z at its own slot, and the API tags no battle with a day, so any per-day attribution was fragile; weekly decks remove the question.
- War rate = decks played / decks asked (4 x war days up to the finish; Colosseum 4 days), capped at 1; post-finish decks count as played and are never asked for. The floor is `floor_war_decks`; Perfect attendance asks `decks_per_day` x days up to the finish per week, `allowed_misses` is days' worth of decks. `full_day_bonus` is retired.
- Saved policy versions read through `fromLegacy`: `floor_war_days` N becomes `floor_war_decks` N (never stricter); `full_day_bonus` is dropped.
- The public Elder explanation and the product contract now describe weekly decks played over decks asked; neither carries the retired claim that finishing a day earns bonus credit.
- Also today: war days after an early finish are optional; departures skip rejoiners; a clan policy is Elixir Clan's own (no POAP KINGS provenance anywhere; other clans' starting pitch and awards are neutral).

## 2026-09-24 — The slow-request alarm reads Lambda Duration; no custom metrics

- The `ElixirClan` EMF line never reached CloudWatch from production: the handler called `log.metric?.(emf(summary))`, and the production logger (`console`) has no `metric`, so the namespace held no datapoints for the week before (414 invocations) and `elixir-clan-slow-requests` watched nothing. Found in the Elixir hosting and cost review.
- Fixed the Elixir family's way (Jamie, 2026-09-24: no one reads CloudWatch by hand, so a custom metric exists only to back an alarm, and no dashboard): the alarm now reads the API Lambda's own `Duration` p90 (free, the request's time) and the EMF line is gone. The request-story JSON line and `Server-Timing` are unchanged; Logs Insights reads the per-route numbers from the story line.

## 2026-09-25 — Cost-neutral API traffic ceiling

- Fourteen days of API Gateway access logs measured a one-second peak of 6 requests (p99 4). The stack-owned `$default` stage now allows 10 requests/second with a 20-request burst: above measured natural traffic, but finite if a client loops.
- The Lambda's existing reserved concurrency of 10 was already present in source and live. A focused infrastructure test now pins the stage throttle and function ceiling together; no paid capacity or monitoring was added.

## 2026-09-25 — Elixir Clan is for any clan (Jamie)

Elixir Clan was bootstrapped by porting POAP KINGS' elixir-bot management
process, and carried that clan's process as everyone's. Jamie's decisions,
one by one:

- **No web publishing.** Elixir Clan is an app a clan's members use; it
  publishes nothing. The public "How Elder works" page (it answered for any
  clan tag, signed in or not, with the starting rules and the removal
  clock) and the public awards document (its publish switch, CORS header
  and edge-cached CloudFront behaviour) are deleted (`dddd3ca`). Every
  route under `/api/clans` needs a session; the smoke checks one is
  refused without.
- **Nothing runs until a leader sets a policy.** Members can still sign in
  and see every member's statistics; no clan-management function is
  invoked until a leader or co-leader saves a policy. Every management
  route answers `409 no_policy`; the rail offers only the roster, Recruit,
  Scout and the policy editor. Recruit and Scout stay open (Scout shows an
  applicant's statistics, with a policy verdict only once there is a
  policy).
- **The policy decides how Elder works.** Policy schema 2 (`0db0b44`) is
  built from categories the clan chooses to count (Clan Wars, ranked play,
  donations, trophy road), each with its own settings and an optional
  minimum (any one, or all). Elder is by hand, or a weighted mix of the
  counted categories (relative weights; any category alone can carry it).
  Removal, departure cards and Elders' inclusion in removal are switches.
  Everything starts off; the help text says what a setting does. Weekly
  reviews fall at war-week finishes only when Clan Wars weighs in Elder,
  otherwise at ISO week ends, so a clan that does not war is reviewed.
  Trophy road reads today's trophies from the roster (the record serves no
  trophy history, so a replayed review reads today's count). Members see
  "How it works here" on Standing, written from the policy.
- **Awards start empty** (`aec081f`); the named starting set and the
  POAP KINGS-only Free Pass branch are gone. Members see awards in the app
  on Trophies; opening it writes a closed season's grants.
- **Recruit is two formats** (`5d4ff84`): a personal note for email or a
  message, and a public post that carries the recruiting forums' bracket
  requirement and leaves invite links out. The pitch starts empty; there is
  no copy until a leader writes one.
- **POAP KINGS keeps its setup as its own versions.** It had never saved a
  policy, awards or pitch (it ran on the starting values, which were its
  own), so version 1 of each was seeded for it before the deploy, labelled
  as carried over: its awards (War Champ, Iron King, Donation Champ, Rookie
  MVP, Free Pass) and pitch exactly; its policy mapped onto the category
  model, with its old score shape (ranked filling the war gap) replaced by
  the closest weights (Clan Wars 55, ranked 15, donations 30: rank
  correlation 0.994 on its last evaluation, the same 14 members under the
  ceiling). Elixir Kings and Ship It! were never set up and now wait for a
  leader's policy.
- `scripts/import-elixir-bot.mjs` is deleted; tests use an invented clan;
  a test keeps product source free of any clan's specifics (`1b531c4`).
  Judge Fairly measures each clan against its own policy, not against
  elixir-bot.

## 2026-09-25 — Below 10 members, Elixir Clan is a statistics view (Jamie)

A clan takes no part in Clan Wars until it has 10 members, and a policy
has nothing to engage with at 1, 3 or 5. So below `MIN_MEMBERS` = 10 a
clan is visible (the roster and every member's statistics; Recruit and
Scout, which judge nobody in the clan) but none of clan management or
awards applies: no policy can be created or previewed, and a saved one
pauses, kept, answering `409 too_few_members`, and resumes when the clan
is back at 10 (the next evaluation re-reads the size). The size is the
latest roster or participation read, kept as one number per clan
(`clan_size#<clan>`), so the gate costs no Elixir read. Recruit and Scout
staying open below 10 is this session's call, easy to flip.

## 2026-09-25 — The vision, agreed (Jamie)

`docs/VISION.md` is the page every proposal is weighed against; each round
of the build loop brings one recommendation with a runner-up. Jamie's
answers on the draft:

- **"Cards" become "actions".** What Elixir Clan suggests a member, elder or
  leader do is an action, assigned to you or available to your role (any
  leader, any elder), completed or declined. The product's words follow;
  `card` stays in code and storage until renamed on purpose.
- **Reaching people:** email, through Elixir (which already sends and holds
  the address): a weekly clan report and the actions waiting for you. A
  webhook may come later.
- **Models:** never funded by us. A clan may bring its own Anthropic key to
  have words written (reports, recruiting copy), never judgments; open until
  a feature needs it, and the key is a per-clan secret to design first.
- **Arrival:** only through Elixir, and member-first: a verified member can
  use Elixir Clan without a leader acting, and can suggest it to them.
- **Measure:** actions suggested and taken; members signing in and engaging.
- **Write-back (Jamie's question):** what the clan did (a kick confirmed, a
  promotion made, an award granted, a member away) should reach Elixir, so
  the family's other products, elixir-mcp-discord above all now that
  elixir-bot is being retired, know it. Principle 6 now says so: facts
  attested by a person go back; judgments never do. It needs an Elixir
  contract first (a plan for that team).

## 2026-09-25 — Round 1: actions for everyone, each with its own log (Jamie)

"Cards" are **actions** in every word a person reads (code and storage keep
`card`). Each has an audience: leaders (promote, demote, remove,
departure), elders and up (welcome a newcomer), or one member (going to be
away?); only they see it and take it, completing or declining. Welcome and
away are policy switches, off to start. Actions is one page for everyone
with a rail count; the leaders' Inbox address lands there.

Jamie added the log: every action keeps its own append-only log of what
raised it (headline, policy version and clauses, facts, and the member's
earlier actions of that kind), who completed or declined it and why, what
the record confirmed or flagged, and anyone's comments, before or after it
closes, so the agent team can review action by action and improve the
rules. `scripts/actions.mjs` reads them from the host (read-only); Judge
Fairly reads the week's `review` every Monday. The 15 actions raised before
logs existed show a log reconstructed from their own fields.

Also: outcome verification now covers only promotions, demotions and
removals (a welcome or an away has no record change to wait for), and
request logs and analytics mask action ids as they did card ids.

## 2026-09-25 — Separate backends, doors into Elixir; round 2: what the clan is for (Jamie)

- **Elixir Clan keeps its own backend and storage** (Jamie agreed): it
  reads Elixir through the public JSON API on a person's grant, and what it
  needs beyond that becomes a small first-party door in Elixir, not a
  shared database. `docs/plans/elixir-doors.md` proposes three to the
  Elixir team: a first-party read grant with no person present (scheduled
  evaluation), mail to a person (the weekly clan report, actions waiting),
  and facts people attested written back (Clan's departures, role changes,
  awards, away; Elixir Drop's personal records), so the Timeline, the events
  feed, future email and elixir-mcp-discord know them. Only facts cross,
  never judgments, each with its provenance.
- **Elixir Ladder is a concept, not a plan.** Elixir Drop is real, and is the
  other app the write-back door serves.
- **Round 2 built:** a policy starts from what the clan is for. Goals (Clan
  Wars, climbing, donations, playing together) and a posture (relaxed,
  standard, strict) are declared in the policy and fill every setting as a
  starting point; presets are goals plus a posture ("a war clan": wars and
  donations, strict; "a social clan": playing together, relaxed, Elders by
  hand). How it works here opens with them; a leader's first recruiting
  pitch starts from a draft of them. Goals judge nothing on their own.

## 2026-09-25 — The doors, settled; Clan Leader Messages (Jamie)

- **Door 1** is an Elixir integration (Admin → Integrations, an admin-issued
  key with named permissions; Drop is the first): Elixir Clan becomes the
  second, with a `clans:read` permission for scheduled evaluation.
- **Door 2**: email is Elixir's (kinds, preferences, one-click unsubscribe,
  the account's activity log); Elixir Clan is a client of it, and Elixir
  Drop can be later.
- **Door 3**: the five fact types, plus `clan_message`, a message sent to the
  clan.
- **Clan Leader Messages** are a kind of action Jamie wants targeted: the
  game's "Clan Leader Message" (a title and a message, sent by a leader or
  co-leader only, landing in every member's Inbox, more durable than clan
  chat). Actions completed by saying something in the game therefore have two
  channels: a clan chat line (anyone the action is for) and a leader
  message (leaders and co-leaders only). Its length limits are not in the
  game's API or our reference; to be read in the game before copy is sized.

## 2026-09-25 — Round 3: say it in the game (Jamie)

- **Clan Leader Messages** (Jamie measured them in the game: a title of 24
  characters, a message of about 180; nothing in the API; recorded in the
  game reference, `cr-agent-api-docs` `6f8383d`) are actions for leaders
  and co-leaders only.
- **Promotions and demotions each carry their own Leader Message**, one per
  person, in the same action: promoting and announcing are atomic, as clans
  have done them. (Not a weekly group message: Jamie's revision.)
- **Two announcements, policy switches off to start** (the goal presets turn
  them on): the season's awards when a season closes and its computed
  grants are written, and the rules when a policy version is saved (how the
  clan runs the first time, what changed after).
- Every action that ends in words says its channel (clan chat or Leader
  Message) and carries the words, editable before copying, counted against
  the game's limits and kept filter-safe (whether the Leader Message has
  chat's filter is not yet observed). Welcome and removal keep their clan
  chat line. Completing a message action logs that it was sent; once
  Elixir's door 3 exists it can also become a `clan_message` fact.

## 2026-09-25 — Round 4: You here (Jamie)

Every member gets their own page in each clan: this week so far and the
last weeks (battles, ranked, donations, war decks of those asked, points),
trophies today, and their time here. It is statistics, so it works for any
clan, even with no policy or below 10 members; with an active policy it adds
what the clan makes of the numbers (status, what would move them, minimums,
days toward Elder, their clock), their actions waiting, their hold or away,
and their trophies. It reads the record once and judges on the spot, so
opening it never raises an action, and it holds only the viewer's own lines.

## 2026-09-25 — Round 5: spread the word (Jamie)

The clan page carries one card for where the clan is: below 10 members, a
pointer to Recruit; with 10 and no policy, "Invite your leaders" for a
member or elder (what setting it up turns on, a chat line, the link) or "Set
up how the clan runs" for a leader; with an active policy, "Bring your
clanmates" for anyone. Chat lines carry no link (the game's filter is wary
of links); the link is copied separately for Discord or a message. Leaders
already get "How our clan runs" as a Leader Message on the first save.
Jamie: Elixir's current effort is wrapping up, so the doors can start
soon, as their own work in elixir-mcp.

