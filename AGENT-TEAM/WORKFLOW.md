# AGENT-TEAM operating model

Elixir Clan is maintained by four objective owners. An owner is accountable
for an outcome, not a job type or a directory, and follows evidence through
diagnosis, code, tests, deployment and natural acceptance instead of handing
each step to another role.

Read `AGENTS.md`, this file, `AGENT-TEAM/README.md`, `AGENT-TEAM/READING.md`
and the selected objective before acting. The entry point never replaces
the product docs it points at.

## Operating loop

1. Run `AGENT-TEAM/scripts/preflight.sh`. A dirty, behind, diverged,
   detached or unexpectedly-ahead checkout makes the run read-only. Never
   publish a pre-existing commit.
2. Measure current state: the live site and API (`/api/health`, the smoke
   script's reads), CI (`gh run list`), the
   stack and its alarms (`--profile cloud-engineer`, read-only), the ledger through
   the host scripts, `docs/NOTES.md` since the last reviewed revision, and
   Elixir's contract version against the pinned dependency.
3. Decide whether a real objective gap exists. Healthy is a complete result.
4. Only when a safe, authorized gap requires mutation, claim the checkout:
   `node AGENT-TEAM/scripts/objective-lease.mjs claim <run|judge|loop|guard>`.
   Keep the returned `leaseId`. A held lease leaves the run read-only;
   never clear one merely because it looks old (`clear-stale` records the
   proof), and use `abort` with a reason when a run cannot finish.
5. Fix the gap at the source in the same run, with the regression test that
   would have caught it. A warning, a guard or a ticket chain is not a fix.
6. Recheck the lease (`check <objective> --lease-id <id>`), then
   `git switch -c <objective>/<slug>` from the clean, synced `main` before
   the first edit. Recheck the lease and the worktree before push. Stop if
   the state changed.
7. `npm run verify` before every commit. Commit only this run's work on
   its branch and land it as a pull request on a green `validate`
   (AGENTS.md, "Landing changes"): `git push -u origin HEAD`,
   `gh pr create --fill`, `gh pr merge --auto --rebase --delete-branch`,
   `gh pr checks --watch --fail-fast`. `main` refuses a direct push (GH013);
   never work around it. Once merged, `git switch main && git pull
   --ff-only`. CI deploys `main` after its `validate`; the smoke script runs
   after every deploy. Work that cannot merge in the run stays an open PR,
   recorded in the report, and the checkout goes back to `main`.
   `AWS_PROFILE=cloud-engineer node infra/scripts/deploy.mjs` is for a
   deploy CI cannot make (a parameter change), from the up-to-date `main`,
   and is said so in the run's report.
8. Verify the deploy (`gh run list`, the smoke output, one live read of the
   changed surface). Verify semantic success from natural evidence: a
   verdict on the real roster, a real feedback item answered, a real grant.
   Never manufacture an action decision, a comment, a hold, a note, a grant or a feedback
   item for acceptance; never write to Elixir; reads only against live data.
9. Release only this run's lease after the repository is clean. If safe
   cleanup is impossible, leave the lease and report it.

## Ownership and acceptance

- The originating objective verifies CI and the live surface for its own
  commit; Run Elixir Clan owns failed-pipeline recovery and continuing
  health. A failure that spans runs becomes an `objective:run` issue.
- Judge Fairly owns semantic acceptance of anything that judges: a changed
  rule is accepted against the golden tests AND one real evaluation read
  back from the ledger.
- Close the Loop owns the response to every feedback item and the truth of
  the docs; `done` means shipped, with the merged PR or its merge commit named.
- A clean deploy never substitutes for natural evidence.

## Issues are the exception ledger

Do not open an issue to authorize, claim, route, deploy or close same-run
work. Keep one only when work spans runs, an external dependency blocks it
(usually Elixir), Jamie must decide, or the arc needs a durable record.
One objective label each; no dispatch or handoff labels.

## Human boundary

Jamie decides: any change to what the engine judges or how (a new policy
field, a new award kind, a changed starting value), anything that touches a
member's in-game standing outside the leader's own decision on an action,
anything published outside a signed-in session (nothing is, by decision), the
OAuth scope, anything stored about a person beyond what `AGENTS.md` lists, and
broad communication to a clan. Ask one concrete yes/no
question with the evidence and the smallest useful version.

Autonomous when they preserve that boundary: bug and reliability fixes, a
misleading label or help text, a docs gap, test coverage, observability, the
Elixir dependency re-pin when Elixir's design changes, and answering feedback
whose answer is already decided.

Leaders decide their own clan's policy and awards through the product.
This team never edits a clan's policy, awards, actions, holds, notes or
grants on a clan's behalf.

## Automation memory

Automation memory holds only `Current state`, `Active watches` and one
replace-in-place `Latest run`. Remove resolved watches. Git, issues, CI,
AWS and the ledger hold history.

## Reporting

End as `HEALTHY`, `CHANGED`, `WATCHING`, `BLOCKED` or `NEEDS JAMIE`:

```text
Outcome: HEALTHY | CHANGED | WATCHING | BLOCKED | NEEDS JAMIE
Objective: <objective name>
Evidence: <most decision-relevant facts>
Action: <what changed, or None>
Next check: <natural event/date, or None>
Jamie: <one yes/no question, or None>
```

Report the measured outcome and the remaining risk, not workflow ceremony.

## Calendar and due work

`automations.toml` owns the calendar; `SCHEDULE.md` is its generated view
(`projects-sysadmin/scripts/render_automation_schedules.py --repo . --write`).
Weekly subtasks keep last successful evidence and the next due date in
current state; a retry checks that receipt before repeating work; a blocked
due subtask remains due at the next eligible invocation.
