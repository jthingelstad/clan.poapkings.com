/**
 * Jamie 2026-09-24: after the boat crosses the line, the rest of the
 * week's war days are optional, and participation is decks, not days:
 * a week asks four decks a war day up to the finish (12 on a day-3
 * finish). Decks after the finish count; skipping them never hurts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { factsAt } from "../src/facts.mjs";
import { member, participation, NOW, EXAMPLE_POLICY } from "./fixture.mjs";

const policy = EXAMPLE_POLICY;

/** Every regular week finished on war day 3. */
function finishedOnDay3(members) {
  const p = participation(members);
  p.war_weeks = p.war_weeks.map((w) =>
    w.is_colosseum || w.finished_observed_at === null
      ? w
      : { ...w, finish_war_day: 3 },
  );
  return p;
}

test("12 decks on a day-3 finish is a full week; the day after is optional", () => {
  const skipped = member("#2PP0V9PP", { war: [12, 12, 12, 12, 16, 4] });
  const played = member("#2PP0V9UU", { war: [16, 16, 16, 16, 16, 4] });
  const [s, p] = factsAt(finishedOnDay3([skipped, played]), policy, NOW);
  assert.equal(s.war.rate, 1, "every deck asked for");
  assert.equal(p.war.rate, 1, "the extra decks help, capped at full");
  assert.ok(p.war.decks_played > s.war.decks_played);
});

test("fewer decks than asked is still short, finish or not", () => {
  const [f] = factsAt(
    finishedOnDay3([member("#2PP0V9PP", { war: [8, 8, 8, 8, 16, 4] })]),
    policy,
    NOW,
  );
  assert.ok(f.war.rate < 1);
});
