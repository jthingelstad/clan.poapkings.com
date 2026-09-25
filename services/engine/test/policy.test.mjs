import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORIES,
  FIELDS,
  FIELD_KEYS,
  GROUPS,
  applies,
  countedCategories,
  defaults,
  diff,
  elderWeights,
  ranksElder,
  setMinimums,
  validate,
} from "../src/policy.mjs";

test("every field has a group, label, unit, starting value inside its range, and a why", () => {
  const groupKeys = new Set(GROUPS.map((g) => g.key));
  for (const key of FIELD_KEYS) {
    const f = FIELDS[key];
    assert.ok(groupKeys.has(f.group), `${key} group`);
    assert.ok(f.label && f.unit && f.why, `${key} prose`);
    if (f.type === "enum")
      assert.ok(
        f.options.some((o) => o.value === f.default),
        `${key} default is an option`,
      );
    else if (f.type !== "boolean")
      assert.ok(
        f.default >= f.min && f.default <= f.max,
        `${key} default in range`,
      );
    for (const clause of f.when ?? [])
      for (const k of Object.keys(clause))
        assert.ok(FIELDS[k], `${key} when names a field (${k})`);
  }
  for (const g of GROUPS)
    for (const clause of g.when ?? [])
      for (const k of Object.keys(clause))
        assert.ok(FIELDS[k], `group ${g.key} when names a field (${k})`);
});

test("a new policy starts with everything off: nothing counted, Elder by hand, no removal, no departure cards", () => {
  const d = defaults();
  assert.deepEqual(countedCategories(d), []);
  assert.equal(d.elder_mode, "manual");
  assert.equal(ranksElder(d), false);
  assert.deepEqual(elderWeights(d), {});
  assert.deepEqual(setMinimums(d), {});
  assert.equal(d.removal_enabled, false);
  assert.equal(d.departures_enabled, false);
  assert.equal(d.away_max_days, 0);
  assert.equal(d.contribution_grace_max_days, 0);
  for (const c of CATEGORIES) assert.equal(d[`elder_weight_${c}`], 0);
  // The starting values are valid as they stand: saving them is a policy.
  assert.equal(validate(d).ok, true);
});

test("the help text says what a setting does, never whose rules they are", () => {
  const prose = JSON.stringify({ GROUPS, FIELDS });
  assert.doesNotMatch(
    prose,
    /POAP|J2RGCRVG|elixir-bot|the boat|War is the primary|buy no rope|account power/i,
  );
});

test("Elder weights are relative and cover only counted categories", () => {
  const w = elderWeights({
    ...defaults(),
    war_enabled: true,
    donations_enabled: true,
    elder_mode: "categories",
    elder_weight_war: 60,
    elder_weight_donations: 20,
    // A weight on a category the clan does not count is inert.
    elder_weight_ranked: 20,
  });
  assert.deepEqual(Object.keys(w).sort(), ["donations", "war"]);
  assert.equal(w.war, 0.75);
  assert.equal(w.donations, 0.25);
});

test("validation speaks to a leader, not a schema", () => {
  const r = validate({ band_ceiling_share: 0.1, band_floor_share: 0.2 });
  assert.equal(r.ok, false);
  assert.match(r.errors.band_ceiling_share, /upper share cannot be below/);
  const none = validate({ elder_mode: "categories" });
  assert.match(none.errors.elder_mode, /at least one category/);
  const zero = validate({ elder_mode: "categories", ranked_enabled: true });
  assert.match(zero.errors.elder_mode, /weight above zero/);
  const e = validate({ elder_mode: "sometimes" });
  assert.match(e.errors.elder_mode, /is one of/);
  const t = validate({ tenure_min_days: "abc" });
  assert.match(t.errors.tenure_min_days, /needs a number/);
  const i = validate({ watch_days: 2.5 });
  assert.match(i.errors.watch_days, /whole number/);
  const u = validate({ nonsense: 1 });
  assert.match(u.errors.nonsense, /not a policy field/);
  const legacy = validate({ war_weight: 0.65, floor_war_days: 3 });
  assert.match(legacy.errors.war_weight, /not a policy field/);
  const ok = validate({
    ranked_enabled: true,
    elder_mode: "categories",
    elder_weight_ranked: "100",
    tenure_min_days: "14",
  });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.equal(ok.values.tenure_min_days, 14);
  assert.deepEqual(elderWeights(ok.values), { ranked: 1 });
});

test("when: a clause matches when all its fields do; any clause may", () => {
  assert.equal(applies(undefined, {}), true);
  const when = [{ elder_mode: "categories", war_enabled: true }];
  assert.equal(
    applies(when, { elder_mode: "categories", war_enabled: true }),
    true,
  );
  assert.equal(
    applies(when, { elder_mode: "manual", war_enabled: true }),
    false,
  );
  const either = [{ elder_mode: "categories" }, { removal_enabled: true }];
  assert.equal(
    applies(either, { elder_mode: "manual", removal_enabled: true }),
    true,
  );
});

test("diff names what changed with labels", () => {
  const before = defaults();
  const after = { ...before, at_risk_days: 6 };
  assert.deepEqual(diff(before, after), [
    { key: "at_risk_days", label: "At risk", before: 7, after: 6 },
  ]);
});
