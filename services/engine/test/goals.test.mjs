import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GOAL_KEYS,
  POSTURES,
  PRESETS,
  declaredGoals,
  goalsInSentence,
  pitchFromGoals,
  policyFromGoals,
} from "../src/goals.mjs";
import {
  countedCategories,
  elderWeights,
  ranksElder,
  setMinimums,
  validate,
} from "../src/policy.mjs";
import { describePolicy } from "../src/render.mjs";
import { validatePitch } from "../src/recruit.mjs";

/** Every combination of goals, including none. */
const combos = Array.from({ length: 1 << GOAL_KEYS.length }, (_, mask) =>
  GOAL_KEYS.filter((_, i) => mask & (1 << i)),
);

test("every combination of goals and posture makes a valid starting policy", () => {
  for (const goals of combos)
    for (const posture of Object.keys(POSTURES)) {
      const v = policyFromGoals(goals, posture);
      assert.equal(validate(v).ok, true, `${goals} / ${posture}`);
      assert.deepEqual(declaredGoals(v), goals);
      assert.equal(v.posture, posture);
      // Every posture tracks inactivity and treats newcomers and departures.
      assert.equal(v.removal_enabled, true);
      assert.equal(v.welcome_enabled, true);
      assert.equal(v.departures_enabled, true);
    }
});

test("what is counted follows the measurable goals; playing together alone means Elders by hand", () => {
  const war = policyFromGoals(["war"], "standard");
  assert.deepEqual(countedCategories(war), ["war"]);
  assert.deepEqual(Object.keys(elderWeights(war)), ["war"]);
  const climbing = policyFromGoals(["climbing"], "standard");
  assert.deepEqual(countedCategories(climbing), ["ranked", "trophies"]);
  const social = policyFromGoals(["together"], "relaxed");
  assert.deepEqual(countedCategories(social), []);
  assert.equal(ranksElder(social), false);
  assert.equal(social.elder_mode, "manual");
  assert.deepEqual(setMinimums(social), {});
});

test("posture moves the minimums and the clocks: relaxed is gentler than strict", () => {
  const relaxed = policyFromGoals(["war", "donations"], "relaxed");
  const strict = policyFromGoals(["war", "donations"], "strict");
  assert.ok(
    relaxed.at_risk_days + relaxed.confirm_days >
      strict.at_risk_days + strict.confirm_days,
  );
  assert.ok(setMinimums(relaxed).war < setMinimums(strict).war);
  assert.ok(relaxed.away_max_days > strict.away_max_days);
  assert.equal(strict.removal_includes_elders, true);
  assert.equal(relaxed.removal_includes_elders, false);
});

test("presets are goals and a posture, nothing else", () => {
  for (const p of PRESETS) {
    assert.ok(p.goals.every((g) => GOAL_KEYS.includes(g)));
    assert.ok(POSTURES[p.posture]);
    assert.doesNotMatch(p.label, /POAP|card/i);
  }
});

test("How it works here opens with what the clan is for, and no posture words that could contradict its own numbers", () => {
  const v = policyFromGoals(["war", "donations"], "standard");
  const about = describePolicy(v)[0];
  assert.equal(about.key, "about");
  assert.deepEqual(about.lines, [
    "This clan is about Clan Wars and donations.",
  ]);
  assert.doesNotMatch(
    JSON.stringify(describePolicy(v)),
    /two weeks|Standard\./,
  );
  assert.equal(
    goalsInSentence(["donations", "together"]),
    "donations and playing together",
  );
});

test("a pitch drafted from the goals is valid, names no clan, and needs a goal", () => {
  for (const goals of combos.filter((g) => g.length))
    for (const posture of Object.keys(POSTURES)) {
      const pitch = pitchFromGoals(goals, posture);
      assert.equal(validatePitch(pitch).ok, true, `${goals} / ${posture}`);
      assert.doesNotMatch(JSON.stringify(pitch), /POAP|poapkings|Free Pass/i);
    }
  assert.equal(pitchFromGoals([], "standard"), null);
});
