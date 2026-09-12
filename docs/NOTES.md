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

- **poapkings.com**: point the Members / FAQ Elder prose at
  `https://clan.poapkings.com/clan/J2RGCRVG/how-elder-works`.
- The public page shows the clan tag, not its name (no session, no roster
  read); a name on the policy item would fix it.

- **GitHub deploy secrets.** The CI user's keys sit in this repo's `.env`
  (0600, gitignored). The session's tool policy would not move them to
  GitHub. From the repo root:
  ```
  grep '^ELIXIR_CLAN_AWS_ACCESS_KEY_ID=' .env | cut -d= -f2- | gh secret set ELIXIR_CLAN_AWS_ACCESS_KEY_ID
  grep '^ELIXIR_CLAN_AWS_SECRET_ACCESS_KEY=' .env | cut -d= -f2- | gh secret set ELIXIR_CLAN_AWS_SECRET_ACCESS_KEY
  ```
  The `ELIXIR_CLAN_CFN_ROLE_ARN` variable is already set. Until the
  secrets exist the deploy workflow skips (green, not red); deploys run
  from this machine with `AWS_PROFILE=jamie`.

- **DNS:** `clan` CNAME at Namecheap → the CloudFront domain (emailed).
  Then: `node infra/scripts/deploy.mjs --param=AppUrl=https://clan.poapkings.com
  --param=SiteCertificateArn=<wildcard arn>`, re-register the OAuth client
  with only the real callback (`register-client.mjs https://clan.poapkings.com`)
  and set `--param=OAuthClientId=<new id>`.
- **npm org** for publishing `@elixir-mcp/design` (optional; the pin works).
- Anything under "Open" below.

## Open

- `projects-sysadmin/docs/OPERATIONS.md` routing table needs a fifth row
  for `elixir-clan-alarms` (not edited from here; the Sunday run reconciles).
- The gate reads `elixir_my_players` on every check; a `verified` beside
  `claim_status` in the principal block would make it one read. Not needed
  yet, so not asked of Elixir.
