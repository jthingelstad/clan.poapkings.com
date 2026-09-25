# Guard the Door

Own the outcome: **the seams to Elixir, the public repository and the
session cookies hold to their stated boundaries, and nothing is
published.** An independent control: Run cannot waive a finding here, and
this objective never widens a scope, a cookie, a stored field or a public
route to make another objective's work easier.

## Every run

- **The scope is `cr:read`.** `/auth/login` sends `scope=cr%3Aread` and
  `resource=https://elixir.poapkings.com/api/v1` with PKCE S256 (the smoke
  script's read). No code path asks Elixir for more; `account:email` is
  never requested here.
- **Cookies.** Both cookies are `__Host-`, HttpOnly, Secure, SameSite=Lax,
  Path=/; the session cookie is `<id>.<hmac>`; the login cookie binds the
  OAuth state to the browser. The signing secret reaches the Lambda only
  through `{{resolve:secretsmanager}}`.
- **Every seam is a public door.** `services/api/src/{oauth,elixir-api,gate}.mjs`
  call `/.well-known`, `/oauth/*` and `/api/v1` with the person's own token
  and nothing else; no Elixir database, no service token, no admin route.
- **What is stored.** `AGENTS.md` §Sessions and §What is stored are the
  whole list: sessions (token pair, gate answer, roster cache), one
  remembered clan per person, and the per-clan ledger (policy, verdict
  snapshot with evidence summaries, cards, holds, notes, awards, grants)
  plus feedback. Anything else found in the table is a finding. Tags and
  summaries, never Elixir payloads.
- **Nothing is published** (Jamie, 2026-09-25). Every route under
  `/api/clans` answers 401 without a session (the smoke script's read);
  there is no public page, no public document and no cached CloudFront
  behavior that drops the cookie. A change that adds one is refused here.
- **No clan in the code.** The guard test
  (`services/engine/test/no-clan-specifics.test.mjs`) passes: no product
  source names a clan, a real player, one clan's awards or website, or the
  bot a process was first ported from.
- **The public repo.** `git ls-files` holds no member data, no token, no
  `.env`, no ledger export; `.gitignore` covers `.env*` and the copied
  font. Test fixtures use invented values.
- **Headers.** CSP, HSTS, nosniff, referrer and permissions policies on
  every response (the smoke script's read).
- **The maintainer lane.** `MaintainerTags` names the maintainer by
  VERIFIED tag; `/api/maintain/*` refuses everyone else (the test pins it).

## Sunday full sweep

Once per week: IAM in `infra/template.yaml` (the Lambda role's actions
against the table, the index and the feedback topic — nothing wider), the
CI user's policy and the CloudFormation execution role from
`infra/scripts/bootstrap.mjs`, the alarm wiring to `projects-ops-alerts`,
and a read of the distribution's behaviors against the template.

## Action

- A boundary drift is fixed in the run with the test that pins it.
- A widening anyone proposes (a scope, a stored field, a public field) is
  Jamie's decision, framed with what it exposes and to whom.

## Success

Every read above matches `AGENTS.md`; the repo is clean of anything
personal; nothing is published outside a signed-in session.
