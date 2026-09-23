# Run Elixir Clan

Own the outcome: **the product is up, deployed from `main`, cheap, and
still speaking Elixir's current contract.** One Lambda, one table, one
distribution, one dependency that matters. Most of what can go wrong here
is a deploy that did not land, an Elixir change this product did not
follow, or a client registration that quietly expired.

## Every run

- **Alive.** `GET https://clan.poapkings.com/api/health` is `{ ok: true }`;
  the app shell serves; `/api/me` signed out is a 401 JSON. The smoke
  script's reads (`node infra/scripts/smoke.mjs`) are the checklist; run
  them, do not re-derive them.
- **Deployed.** `gh run list --limit 5`: the latest `validate` and
  `deploy` on `main` are green and the deployed commit is `origin/main`.
  A red deploy is this objective's to fix in the run. A green deploy whose
  smoke failed after the AppUrl flip was the first day's lesson: read the
  smoke output, not just the status.
- **Alarms.** `elixir-clan-api-errors`, `elixir-clan-api-5xx`,
  `elixir-clan-estimated-charges` state and history (`aws cloudwatch describe-alarms
  --profile cloud-engineer`). An alarm the Operator saw is one this objective
  explains: read the Lambda log group for the window, name the cause.
- **Cost.** The stack's estimated charges stay near zero; the reserved
  concurrency of 10 and the 30-day log retention are the ceilings. Every
  page view spends the person's Elixir quota, not ours; a change that
  polls or loops is a defect whatever it costs here.
- **Elixir's contract.** Compare the contract version Elixir answers
  (`initialize` result, or the `elixir_changelog` tool) with the version
  `AGENTS.md` §Elixir tools this app depends on names. A minor bump with a
  changed shape of `clans_participation`, `clans_roster` or
  `elixir_my_players` is a gap: read the changelog entry, adapt, test, ship.
  Re-pin `apps/web/package.json`'s `elixir-mcp` SHA when Elixir's design
  changed (`packages/design/styles.css`); never copy the file.
- **The OAuth client.** A registration lives 365 days from last use. Read
  the stack's `OAuthClientId` and the date of the last successful sign-in
  (the sessions in the table, read-only); within 30 days of expiry, warn
  Jamie with the re-register command from `AGENTS.md`.
- **The table.** Sessions and logins carry TTLs; the ledger items do not.
  An item count that grows without a matching product reason is a leak.
- **Secrets.** Only through `{{resolve:secretsmanager}}` in the template;
  never `get-secret-value`. The `aws-secrets-manager` skill first for any
  secret task.

## Action

- A failed deploy, a broken smoke, an alarm with a cause in our code, a
  contract adaptation, a re-pin: fix in the run, with the test, push,
  watch CI, read the smoke.
- A parameter change (`--param=Key=Value`) is a local deploy and is said so.
- Anything Elixir must change goes to Elixir (`elixir_feedback` or its
  AGENT-TEAM) as one concrete fact request; never a judgment.

## Success

The site answers, CI is green on `origin/main`, no alarm is unexplained,
the Elixir contract this product reads is the one Elixir serves, and the
client registration has months left.
