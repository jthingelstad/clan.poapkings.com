import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FIELDS,
  FIELD_KEYS,
  GROUPS,
  defaults,
  validate,
  diff,
} from "../src/policy.mjs";

test("every field has a group, label, unit, default inside its range, and a why", () => {
  const groupKeys = new Set(GROUPS.map((g) => g.key));
  for (const key of FIELD_KEYS) {
    const f = FIELDS[key];
    assert.ok(groupKeys.has(f.group), `${key} group`);
    assert.ok(f.label && f.unit && f.why, `${key} prose`);
    if (f.type !== "boolean") {
      assert.ok(
        f.default >= f.min && f.default <= f.max,
        `${key} default in range`,
      );
    }
  }
});

test("the POAP KINGS defaults are elixir-bot's ratified constants", () => {
  const d = defaults();
  assert.equal(d.tenure_min_days, 28);
  assert.equal(d.floor_window_weeks, 2);
  assert.equal(d.floor_war_decks, 1);
  assert.equal(d.floor_ranked_battles, 5);
  assert.equal(d.war_rate_window_weeks, 4);
  assert.equal(d.full_day_bonus, undefined, "decks, not days: no day bonus");
  assert.equal(d.war_weight, 0.65);
  assert.equal(d.donation_weight, 0.35);
  assert.equal(d.ranked_weight, 0.4);
  assert.equal(d.band_floor_share, 0.2);
  assert.equal(d.band_ceiling_share, 0.3);
  assert.equal(d.worthiness_percentile, 0.5);
  assert.equal(d.promote_qualifying_weeks, 3);
  assert.equal(d.swap_margin, 0.05);
  assert.equal(d.demote_abandoned_weeks, 2);
  assert.equal(d.demote_outranked_weeks, 3);
  assert.equal(d.watch_days, 3);
  assert.equal(d.at_risk_days, 5);
  assert.equal(d.confirm_days, 3);
  assert.equal(d.contribution_grace_max_days, 4);
  assert.equal(d.roster_cap, 50);
  assert.equal(d.renominate_removal_days, 7);
  assert.equal(d.renominate_promotion_days, 14);
  assert.equal(d.renominate_demotion_days, 14);
  assert.equal(d.members_see_standing, true);
});

test("validation speaks to a leader, not a schema", () => {
  const r = validate({ band_ceiling_share: 0.1, band_floor_share: 0.2 });
  assert.equal(r.ok, false);
  assert.match(
    r.errors.band_ceiling_share,
    /ceiling cannot be below the floor/,
  );
  const w = validate({ war_weight: 0.7 });
  assert.match(w.errors.donation_weight, /add up to 1/);
  const z = validate({ floor_war_decks: 0, floor_ranked_battles: 0 });
  assert.match(z.errors.floor_war_decks, /everyone clears the floor/);
  const t = validate({ tenure_min_days: "abc" });
  assert.match(t.errors.tenure_min_days, /needs a number/);
  const i = validate({ watch_days: 2.5 });
  assert.match(i.errors.watch_days, /whole number/);
  const u = validate({ nonsense: 1 });
  assert.match(u.errors.nonsense, /not a policy field/);
  const ok = validate({
    war_weight: "0.7",
    donation_weight: "0.3",
    tenure_min_days: "14",
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.values.tenure_min_days, 14);
  assert.equal(ok.values.war_weight, 0.7);
});

test("diff names what changed with labels", () => {
  const before = defaults();
  const after = { ...before, at_risk_days: 6 };
  assert.deepEqual(diff(before, after), [
    { key: "at_risk_days", label: "At risk", before: 5, after: 6 },
  ]);
});

test("a version saved before decks reads through the legacy mapping", () => {
  const v = validate({ floor_war_days: 3, full_day_bonus: 0.4 });
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(
    v.values.floor_war_decks,
    3,
    "N days with a deck is at least N decks",
  );
  assert.equal(v.values.full_day_bonus, undefined);
});
