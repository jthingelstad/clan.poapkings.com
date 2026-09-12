# AGENTS.md

Elixir Clan: being in a clan, on top of Elixir. `clan.poapkings.com`, one of
the Elixir family's verticals (`../elixir-family/MAP.md`). This push signs
people in with Elixir's OAuth, requires a verified player, and shows them
their clan with their own role. Nothing more yet.

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
apps/web/        React 18 + Vite SPA (routes: /, /clan, /you, /refused/<reason>)
services/api/    Node 24 arm64 Lambda behind one HTTP API: /auth/*, /api/*
infra/           one CloudFormation stack + scripts (bootstrap, deploy, smoke)
docs/NOTES.md    decisions, newest last; what is waiting on Jamie
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
2. a primary player exists → else `no_primary_player` (Elixir → Tracking)
3. `claim_status === "verified"` → else `unverified` (Elixir → Verify, one
   battle with a named deck)
4. `clan_tag` and `clan_role` present → else `no_clan`

The roster is not part of the gate. It is read with `clans_roster` naming the
primary's `clan_tag` explicitly (the tool's default is the first RECORDED
clan among the account's claims, which can be an alt's clan). A
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
session's cache window (gate 2 min, roster 3 min). No profile, no history, no
awards. This push stores sessions and nothing else.

## Quota discipline

Every page view spends the signed-in person's Elixir daily budget. The gate
answer and roster are cached per session; "check again" is floored at 30 s
server-side; nothing polls. The page shows `meta.freshness_seconds`/`as_of`
the way Elixir does (`Fresh`).

## AWS and deploying

- `--profile jamie`, `us-east-1`, hobby-account rules from `~/Projects/AGENTS.md`.
  No em dashes in resource names.
- One stack `elixir-clan` (`infra/template.yaml`): table, function, HTTP API,
  private bucket + CloudFront, SNS `elixir-clan-alarms`, three alarms (Lambda
  errors, API 5xx, estimated charges), 30-day logs.
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

## Design dependency

`apps/web` depends on `elixir-mcp` as a **pinned git dependency** (a commit
SHA in `apps/web/package.json`) and imports
`elixir-mcp/packages/design/styles.css`; the Clash display font is copied
from the same dependency at build time (`apps/web/scripts/fonts.mjs`,
gitignored). Bump the SHA to take a design change; never copy the file.
Publishing `@elixir-mcp/design` is the durable answer and needs Jamie's npm
org (docs/NOTES.md).

## Next push

Port `engine/management.py` and the leader-action cards from `../elixir-bot`
as a leader-only view (role from the roster, verified claim from the gate).
The clan page's audience column (member / elder / leader) is the MAP's
re-mapping of the Tower table. Read `../elixir-family/MAP.md` §5 first.

---

*This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*
