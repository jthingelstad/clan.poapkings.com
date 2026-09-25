# Judge Fairly

Own the outcome: **every verdict, action, standing line and award grant
follows the clan's own policy and Elixir's record, and says how well the
record supports it.** This product's whole promise is that judgment lives
here, is versioned, and can be explained to the member it is about. A
wrong action costs a real person their role or their place; a missed grant
robs someone of an award they earned.

Fair means **consistent with each clan's saved policy and the product's
rules**: nothing judged before a clan has a policy, no action raised on held
evidence, every verdict explainable in the member's terms, and nothing
counted, mentioned or advised that the clan's policy does not count. It
never means "the way one clan, or the bot a process was first ported from,
did it". Elixir Clan is for any clan (Jamie, 2026-09-25).

## Every run

- **The golden tests are the rules.** `services/engine/test/` states what
  the engine does under a policy, case by case. They pass on `main`; a
  change to the engine lands with its test. The guard test keeps product
  source free of any one clan's specifics.
- **No policy, no judgment.** A clan whose leaders have not saved a policy
  has no verdict snapshot written after that rule shipped, no new action, no
  new grant. Any sign otherwise is a defect.
- **Fail-closed is honoured, for every clan with a policy.** Read each
  clan's latest verdict snapshot from the ledger (read-only; sample the
  clans that have a policy). Every member with `judgment_status` `held` or
  `unknown` has a reason the page states; nobody held or unknown gets
  an action; nobody below co-leader can see a removal action. Fidelity
  (`daily` / `weekly` / `unknown`) is carried into every fact an action shows,
  and an action's facts name only the categories that clan counts.
- **Actions match the policy and the record.** Open actions are still
  actionable under the current policy version; withdrawn ones name why;
  completed ones were verified from the record or flagged inside
  `outcome_window_hours`, and a flagged one is looked at, not left. A
  policy that switches a dimension off withdraws its open actions.
- **Weekly review.** Each clan's review boundaries follow its policy: the
  observed war-week finish when Clan Wars weighs in Elder, the ISO week's
  end otherwise. After a boundary, the next evaluation shows it: the band
  replays, the trail moves. A verdict that surprises is explained from the
  record and the clan's own policy, never from another clan's.
- **Seasons and awards.** When Elixir's `war_weeks` show a season closed
  (its Colosseum week finished, or a later season begun), the first
  evaluation must write the grants for each clan's enabled computed awards:
  read `award#` items for that season. Grants are on demand (Manage ▸
  Awards or any member's Trophies), so a season that closes and is not
  looked at inside the record's eight-week window is never granted; until
  scheduled evaluation ships, this objective is the look, every Monday. A
  leaders' pick is never granted by this team.
- **Read the action logs.** `node scripts/actions.mjs review --clan <TAG>
  --days 7` for each clan with a policy: every decline with its reason, every
  action withdrawn soon after it was raised, every flagged outcome, every
  comment. A pattern (the same rule declined for the same reason, a clock
  that raises and withdraws) is evidence a rule misfires; the finding names
  the action ids and the rule.
- **Rookie and tenure honesty.** `tenure_known: false` never becomes a
  tenure, a rookie or a removal clock; `first_roster_observed_at` bounds
  every "since".

## Action

- An engine defect: fix with the golden test that would have caught it,
  ship, re-evaluate (a leader's "re-judge now" or the next open of Manage),
  read the verdict back.
- A new policy field, a changed starting value or a new award kind is
  Jamie's: one decision, with the affected members' lines under the clans
  that would feel it attached.
- A clan's own settings are its leaders'; this team never saves a policy,
  awards document or pitch for a clan.
- A fact Elixir does not expose that a rule needs (trophy history, ranked
  league at month end, say) is a request to Elixir, fact-only.

## Success

Golden tests green; no clan without a policy is judged; every clan with a
policy has no held member without a stated reason and no action that
contradicts its policy; every closed season has its grants; the week's
action logs are read and what they teach is written down.
