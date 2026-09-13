import { test } from "node:test";
import assert from "node:assert/strict";
import { defaults } from "../src/policy.mjs";
import { evaluate } from "../src/evaluate.mjs";
import {
  cardFacts,
  cardRationale,
  participationPhrase,
  standingForMembers,
  nextSteps,
  judgmentReasons,
} from "../src/render.mjs";
import { member, participation, NOW } from "./fixture.mjs";

const policy = defaults();

test("held and unknown judgments explain the missing evidence without changing the verdict", () => {
  const p = participation([
    member("#UNKNOWN", { tenureKnown: false }),
    member("#WAR", { war: [null, null, null, null, null, null] }),
    member("#ELDER", {
      role: "elder",
      war: [null, null, null, null, null, null],
    }),
    {
      ...member("#ANCHOR", { lastBattleDaysAgo: null }),
      joined_observed_at: null,
    },
  ]);
  const v = evaluate({ participation: p, policy, now: NOW });
  const reasons = (tag) =>
    judgmentReasons(
      v.members.find((m) => m.player_tag === tag),
      v.boundaries,
    );
  assert.deepEqual(reasons("#UNKNOWN"), [
    "Promotion: tenure unknown because the join predates the record.",
  ]);
  assert.deepEqual(reasons("#WAR"), [
    "Promotion held: war record incomplete in the review window.",
  ]);
  assert.deepEqual(reasons("#ELDER"), [
    "Promotion held: war record incomplete in the review window.",
    "Demotion held: war record incomplete in the review window.",
  ]);
  assert.deepEqual(reasons("#ANCHOR"), [
    "Removal held: no recorded battle or observed join anchors the clock.",
  ]);
  const noReviews = evaluate({
    participation: participation([member("#NEW")], { war_weeks: [] }),
    policy,
    now: NOW,
  });
  assert.deepEqual(
    judgmentReasons(noReviews.members[0], noReviews.boundaries),
    ["Promotion held: no closed war review yet."],
  );
  for (const m of v.members) {
    for (const [dimension, status] of Object.entries(m.judgment)) {
      if (status === "held" || status === "unknown")
        assert.equal(m.actionable[dimension], false);
    }
  }
  const ready = evaluate({
    participation: participation([member("#READY")]),
    policy,
    now: NOW,
  });
  assert.deepEqual(judgmentReasons(ready.members[0], ready.boundaries), []);
});

test("the member phrase carries no score, percentile, rank or slot count", () => {
  const v = evaluate({
    participation: participation([
      member("#A", { ranked: [3, 3, 3, 3, 3, 0] }),
      member("#B"),
    ]),
    policy,
    now: NOW,
  });
  const phrase = participationPhrase(v.members[0]);
  assert.match(phrase, /war decks over 4 war weeks/);
  assert.match(phrase, /12 ranked battles/);
  assert.match(phrase, /~200 donations a week/);
  const banned = /\b(score|percentile|rank|slots?|median|competitive)\b/i;
  assert.ok(!banned.test(phrase), phrase);
  const rows = standingForMembers(v);
  assert.ok(!banned.test(JSON.stringify(rows)));
});

test("card facts state windows and fidelity; an unknown is said, never zeroed", () => {
  const p = participation([
    member("#A", { tenureKnown: false, tenureDays: 9 }),
  ]);
  const v = evaluate({ participation: p, policy, now: NOW });
  const facts = cardFacts(v.members[0], policy);
  const tenure = facts.find((f) => f.key === "tenure");
  assert.match(tenure.value, /at least 9 days/);
  assert.equal(tenure.fidelity, "unknown");
  assert.equal(facts.find((f) => f.key === "war").window, "last 4 war weeks");
});

test("rationales name the policy clauses that fired", () => {
  const others = Array.from({ length: 10 }, (_, i) => member(`#O${i}`));
  const idle = member("#X", { lastBattleDaysAgo: 20, war: [0, 0, 0, 0, 0, 0] });
  const v = evaluate({
    participation: participation([...others, idle]),
    policy,
    now: NOW,
  });
  const m = v.members.find((x) => x.player_tag === "#X");
  const r = cardRationale("removal", m, policy, v.band);
  assert.match(r.headline, /20 battle-free days/);
  assert.deepEqual(r.clauses, ["at_risk_days", "confirm_days"]);
});

test("next steps tell a member the one or two things that would move them", () => {
  const p = participation([
    member("#A", {
      tenureDays: 10,
      war: [0, 0, 0, 0, 0, 0],
      donations: [10, 10, 10, 10, 10, 0],
    }),
  ]);
  const v = evaluate({ participation: p, policy, now: NOW });
  const steps = nextSteps(v.members[0], policy);
  assert.equal(steps.length, 2);
  assert.match(steps[0], /18 more days/);
  assert.match(steps[1], /Clear the floor/);
});
