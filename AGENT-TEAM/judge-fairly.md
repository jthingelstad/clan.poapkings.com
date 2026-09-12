# Judge Fairly

Own the outcome: **every verdict, card, standing line and award grant
follows the clan's own policy and Elixir's record, and says how well the
record supports it.** This product's whole promise is that judgment lives
here, is versioned, and can be explained to the member it is about. A
wrong card costs a real person their role or their place; a missed grant
robs someone of an award they earned.

## Every run

- **The golden tests are the rules.** `services/engine/test/` is the
  contract with elixir-bot's engine, ported case by case. They pass on
  `main`; a change to the engine lands with its test. A rule that exists
  in `../elixir-bot/engine/management.py` or `engine/awards.py` and not
  here is either a documented non-carry (`docs/NOTES.md`) or a gap.
- **Fail-closed is honoured.** Read the latest verdict snapshot for POAP
  KINGS from the ledger (read-only). Every member with `judgment_status`
  `held` or `unknown` has a reason the page states; nobody held or unknown
  is carded; nobody below co-leader can see a removal card. Fidelity
  (`daily` / `weekly` / `unknown`) is carried into every fact a card
  shows.
- **Cards match the record.** Open cards are still actionable under the
  current policy version; withdrawn cards name why; done cards were
  verified from the record or flagged inside `outcome_window_hours`, and a
  flagged card is looked at, not left.
- **Monday review.** After the war week finishes (observed Mondays ~09:34Z),
  the review boundary appears in the next evaluation: the band replays,
  the trail moves. Compare this product's verdicts for POAP KINGS with
  elixir-bot's ledger read-only (`node scripts/import-elixir-bot.mjs`, dry
  run only) for the same week. A disagreement is evidence to explain, not
  to paper over: the second push's diff was 43 of 47 agreeing, with the
  four explained by the record's horizon.
- **Seasons and awards.** When Elixir's `war_weeks` show a season closed
  (its Colosseum week finished, or a later season begun), the first
  evaluation must write the grants: read `award#` items for that season
  for each enabled computed award. Grants are on demand, so a season that
  closes and is not looked at inside the record's eight-week window is
  never granted — this objective is the look, every Monday. A Free Pass is
  a leaders' pick: never granted by this team.
- **Rookie and tenure honesty.** `tenure_known: false` never becomes a
  tenure, a rookie or a removal clock; `first_roster_observed_at` bounds
  every "since".

## Action

- An engine defect: fix with the golden test that would have caught it,
  ship, re-evaluate (a leader's "re-judge now" or the next open of Manage),
  read the verdict back.
- A rule change or a new default is Jamie's: one decision with the
  elixir-bot source line and the affected members' lines attached.
- A fact Elixir does not expose that a rule needs (ranked league at month
  end for a ranked podium, say) is a request to Elixir, fact-only.

## Success

Golden tests green; the POAP KINGS snapshot has no held member without a
stated reason and no card that contradicts it; every closed season has its
grants; the Monday comparison with elixir-bot is explained line by line.
