/**
 * Jamie 2026-09-24: after the boat crosses the line, the rest of the
 * week's war days are optional. Playing them adds credit; skipping them
 * never counts against anyone (the Elder band, the removal clock).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaults } from "../src/policy.mjs";
import { factsAt } from "../src/facts.mjs";
import { member, participation, NOW } from "./fixture.mjs";

const policy = defaults();

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

const byDay = (week) => [week, week, week, week, week, [4, 0, 0, 0]];

test("skipping the day after an early finish costs nothing", () => {
  const skipped = member("#2PP0V9PP", {
    war: [12, 12, 12, 12, 16, 4],
    days: byDay([4, 4, 4, 0]).map((d, i) => (i === 4 ? [4, 4, 4, 4] : d)),
  });
  const played = member("#2PP0V9UU", {
    war: [16, 16, 16, 16, 16, 4],
    days: byDay([4, 4, 4, 4]),
  });
  const facts = factsAt(finishedOnDay3([skipped, played]), policy, NOW);
  const [s, p] = facts;
  assert.equal(s.war.rate, 1, "every asked-for day played in full");
  assert.equal(p.war.rate, 1, "the extra day is credit, capped at full");
  assert.equal(s.floor.war_days, p.floor.war_days, "an excused day is no miss");
  assert.ok(s.war.days_available < p.war.days_played + 1);
});

test("a day before the finish is still asked for", () => {
  const missedDay2 = member("#2PP0V9PP", {
    war: [8, 8, 8, 8, 16, 4],
    days: byDay([4, 0, 4, 0]).map((d, i) => (i === 4 ? [4, 4, 4, 4] : d)),
  });
  const [f] = factsAt(finishedOnDay3([missedDay2]), policy, NOW);
  assert.ok(f.war.rate < 1, "day 2 was before the finish");
});
