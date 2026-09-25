/**
 * Golden tests ported from elixir-bot/tests (test_engine_management.py,
 * test_elder_math_2026_08.py), expressed against Elixir's tool shapes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { factsAt } from "../src/facts.mjs";
import { band, participationPercentile, scores } from "../src/standing.mjs";
import {
  evaluate,
  reconcileCards,
  replayMachines,
  reviewBoundaries,
} from "../src/evaluate.mjs";
import { member, participation, NOW, EXAMPLE_POLICY } from "./fixture.mjs";

const policy = EXAMPLE_POLICY;
const DAY = 86400_000;

function bandNow(members, opts = {}) {
  const p = participation(members);
  const pol = { ...policy, ...opts };
  const facts = factsAt(p, pol, NOW);
  const byTag = new Map(facts.map((f) => [f.player_tag, f]));
  const rows = scores(facts, pol);
  return { facts: byTag, rows, band: band(rows, byTag, members.length, pol) };
}

// ---- war decks (Jamie 2026-09-24: decks, not days) --------------------------

test("the war rate is decks played over decks asked for, capped at full", () => {
  const full = member("#FULL", { war: [16, 16, 16, 16, 16, 0] });
  const half = member("#HALF", { war: [8, 8, 8, 8, 8, 0] });
  const { facts } = bandNow([full, half]);
  assert.equal(facts.get("#FULL").war.rate, 1);
  assert.equal(facts.get("#HALF").war.rate, 0.5);
  assert.equal(
    facts.get("#FULL").war.decks_asked,
    16 * policy.war_window_weeks,
  );
});

test("non-participation scores zero, participants are ranked against each other", () => {
  const vals = [0, 0, 0, 5, 10];
  assert.equal(participationPercentile(0, vals), 0);
  assert.equal(participationPercentile(5, vals), 0.25);
  assert.equal(participationPercentile(10, vals), 0.75);
  assert.equal(
    participationPercentile(0, [0, 0]),
    0,
    "a roster where nobody participates pays nobody",
  );
});

// ---- minimums and scores ---------------------------------------------------

test("war minimum and scores: a war player out-scores a war-absent donor", () => {
  const w = member("#W", {
    war: [12, 12, 12, 12, 12, 0],
    donations: [300, 300, 300, 300, 300, 0],
  });
  const n = member("#N", {
    war: [0, 0, 0, 0, 0, 0],
    donations: [900, 900, 900, 900, 900, 0],
  });
  const { facts, rows } = bandNow([w, n]);
  assert.equal(facts.get("#W").minimums.met.war, true);
  assert.equal(facts.get("#N").minimums.met.war, false);
  assert.ok(rows.get("#W").values.war > 0);
  assert.equal(rows.get("#N").values.war, 0);
  assert.ok(rows.get("#W").score > rows.get("#N").score);
});

test("the ranked minimum is participation, not the league reached", () => {
  const plays = member("#PLAYS", {
    war: [0, 0, 0, 0, 0, 0],
    ranked: [0, 0, 0, 0, 8, 0],
  });
  const idle = member("#IDLE", {
    war: [0, 0, 0, 0, 0, 0],
    ranked: [0, 0, 0, 0, 0, 0],
  });
  const { facts } = bandNow([plays, idle]);
  assert.equal(facts.get("#PLAYS").minimums.met.ranked, true);
  assert.equal(facts.get("#IDLE").minimums.met.ranked, false);
});

test("the Elder score is the weighted mix of what the clan counts, and never saturates", () => {
  const filler = Array.from({ length: 6 }, (_, i) =>
    member(`#F${i}`, {
      war: [1, 1, 1, 1, 1, 0],
      donations: [50, 50, 50, 50, 50, 0],
    }),
  );
  const wardog = member("#WARDOG", { war: [16, 16, 16, 16, 16, 0] });
  const waronly = member("#WARONLY", { war: [8, 8, 8, 8, 8, 0] });
  const both = member("#BOTH", {
    war: [8, 8, 8, 8, 8, 0],
    ranked: [10, 10, 10, 10, 10, 0],
  });
  const rkonly = member("#RKONLY", {
    war: [0, 0, 0, 0, 0, 0],
    ranked: [10, 10, 10, 10, 10, 0],
  });
  const everyone = [...filler, wardog, waronly, both, rkonly];
  const { rows } = bandNow(everyone);
  assert.ok(rows.get("#BOTH").score > rows.get("#WARONLY").score);
  assert.ok(rows.get("#RKONLY").score < rows.get("#WARDOG").score);
  assert.ok(rows.get("#RKONLY").score > 0);
  for (const r of rows.values()) assert.ok(r.score >= 0 && r.score <= 1);
  // The same roster under a clan that ranks on ranked play alone.
  const rankedOnly = bandNow(everyone, {
    war_enabled: false,
    donations_enabled: false,
    elder_weight_war: 0,
    elder_weight_donations: 0,
    elder_weight_ranked: 1,
  }).rows;
  assert.ok(rankedOnly.get("#RKONLY").score > rankedOnly.get("#WARDOG").score);
  assert.deepEqual(Object.keys(rankedOnly.get("#RKONLY").pct), ["ranked"]);
  assert.equal(rankedOnly.get("#WARDOG").score, 0);
});

test("weights are relative: 55/15/30 and 11/3/6 rank a roster the same", () => {
  const roster = [
    member("#A", {
      war: [16, 16, 16, 16, 16, 0],
      donations: [50, 50, 50, 50, 50, 0],
    }),
    member("#B", { war: [4, 4, 4, 4, 4, 0], ranked: [9, 9, 9, 9, 9, 0] }),
    member("#C", {
      war: [0, 0, 0, 0, 0, 0],
      donations: [900, 900, 900, 900, 900, 0],
    }),
  ];
  const a = bandNow(roster).rows;
  const b = bandNow(roster, {
    elder_weight_war: 11,
    elder_weight_ranked: 3,
    elder_weight_donations: 6,
  }).rows;
  for (const tag of ["#A", "#B", "#C"])
    assert.equal(a.get(tag).score.toFixed(10), b.get(tag).score.toFixed(10));
});

test("trophy road counts today's trophies from the roster, and a missing count is unknown", () => {
  const p = participation([member("#HIGH"), member("#LOW"), member("#GONE")]);
  const pol = {
    ...policy,
    trophies_enabled: true,
    trophies_min: 8000,
    minimums_rule: "all",
    war_min_decks: 0,
    ranked_min_battles: 0,
    elder_weight_trophies: 50,
  };
  const trophies = new Map([
    ["#HIGH", 9100],
    ["#LOW", 6200],
  ]);
  const facts = new Map(
    factsAt(p, pol, NOW, { trophies }).map((f) => [f.player_tag, f]),
  );
  assert.equal(facts.get("#HIGH").minimums.met.trophies, true);
  assert.equal(facts.get("#LOW").minimums.met.trophies, false);
  assert.equal(facts.get("#GONE").minimums.met.trophies, null);
  assert.equal(facts.get("#GONE").minimums.unknown, true);
  const rows = scores([...facts.values()], pol);
  assert.ok(rows.get("#HIGH").pct.trophies > rows.get("#LOW").pct.trophies);
});

test("minimums: any one of them, or all of them; none set means everyone meets them", () => {
  const warOnly = member("#WAR", { ranked: [0, 0, 0, 0, 0, 0] });
  const p = participation([warOnly]);
  const any = factsAt(p, policy, NOW)[0].minimums;
  assert.equal(any.passes, true);
  const all = factsAt(p, { ...policy, minimums_rule: "all" }, NOW)[0].minimums;
  assert.equal(all.passes, false);
  assert.equal(all.unknown, false, "a known miss under all is a miss");
  const none = factsAt(
    p,
    { ...policy, war_min_decks: 0, ranked_min_battles: 0 },
    NOW,
  )[0].minimums;
  assert.deepEqual(none.set, {});
  assert.equal(none.passes, true);
});

test("an elder who plays ranked is not abandoned; one who plays nothing is", () => {
  const filler = Array.from({ length: 11 }, (_, i) =>
    member(`#P${i}`, { war: [8, 8, 8, 8, 8, 0] }),
  );
  const ranker = member("#RANKER", {
    role: "elder",
    war: [0, 0, 0, 0, 0, 0],
    ranked: [0, 0, 0, 6, 6, 0],
  });
  const idle = member("#IDLE", { role: "elder", war: [0, 0, 0, 0, 0, 0] });
  const { band: b } = bandNow([...filler, ranker, idle]);
  assert.notEqual(b.demote_reasons.get("#RANKER"), "abandoned");
  assert.equal(b.demote_reasons.get("#IDLE"), "abandoned");
});

// ---- the band ---------------------------------------------------------------

test("below the floor, grow to the TARGET with worthy members only; a war-absent member never qualifies", () => {
  const top = member("#TOP", {
    war: [16, 16, 16, 16, 16, 0],
    donations: [800, 800, 800, 800, 800, 0],
  });
  const mids = Array.from({ length: 5 }, (_, i) =>
    member(`#M${i}`, {
      war: [4, 4, 4, 4, 4, 0],
      donations: [100, 100, 100, 100, 100, 0],
    }),
  );
  const nowar = member("#NOWAR", {
    war: [0, 0, 0, 0, 0, 0],
    donations: [999, 999, 999, 999, 999, 0],
  });
  const { band: b } = bandNow([top, ...mids, nowar]);
  assert.equal(b.floor, 1);
  assert.equal(b.target, 2);
  assert.equal(b.current_elders, 0);
  assert.ok(b.promotable.has("#TOP"));
  assert.ok(!b.promotable.has("#NOWAR"));
  assert.equal(
    b.promotable.size,
    b.target,
    "grows to the target, not the floor",
  );
});

test("worthiness at the median blocks a weak promotion, and unknown tenure is never assumed", () => {
  const young = Array.from({ length: 5 }, (_, i) =>
    member(`#Y${i}`, {
      tenureDays: 10,
      war: [16, 16, 16, 16, 16, 0],
      donations: [500, 500, 500, 500, 500, 0],
    }),
  );
  const olds = Array.from({ length: 3 }, (_, i) =>
    member(`#O${i}`, {
      tenureDays: 200,
      war: [2, 2, 2, 2, 2, 0],
      donations: [50, 50, 50, 50, 50, 0],
    }),
  );
  const unknown = member("#UNK", {
    tenureKnown: false,
    tenureDays: 9,
    war: [16, 16, 16, 16, 16, 0],
    donations: [600, 600, 600, 600, 600, 0],
  });
  const { band: b } = bandNow([...young, ...olds, unknown]);
  assert.equal(b.promotable.size, 0, "nobody worthy and tenured");
  assert.ok(b.tenure_unknown.has("#UNK"));
});

test("inside the band, no moves", () => {
  const elders = Array.from({ length: 3 }, (_, i) =>
    member(`#E${i}`, {
      role: "elder",
      war: [14, 14, 14, 14, 14, 0],
      donations: [300, 300, 300, 300, 300, 0],
    }),
  );
  const members = Array.from({ length: 9 }, (_, i) =>
    member(`#M${i}`, {
      war: [6, 6, 6, 6, 6, 0],
      donations: [100, 100, 100, 100, 100, 0],
    }),
  );
  const { band: b } = bandNow([...elders, ...members]);
  // 12 roster: floor 2, ceil 4, target 3; three elders on top.
  assert.equal(b.target, 3);
  assert.equal(b.promotable.size, 0);
  assert.equal(b.demotable.size, 0);
});

test("tenure decides a close call; it never invents a promotion for a challenger who is behind", () => {
  const filler = Array.from({ length: 6 }, (_, i) =>
    member(`#F${i}`, {
      war: [4, 4, 4, 4, 4, 0],
      donations: [100, 100, 100, 100, 100, 0],
    }),
  );
  const chal = member("#CHAL", {
    tenureDays: 400,
    war: [12, 12, 12, 12, 12, 0],
    donations: [300, 300, 300, 300, 300, 0],
  });
  const inc = member("#INC", {
    role: "elder",
    tenureDays: 60,
    war: [12, 12, 12, 12, 12, 0],
    donations: [295, 295, 295, 295, 295, 0],
  });
  const e2 = member("#E2", {
    role: "elder",
    war: [13, 13, 13, 13, 13, 0],
    donations: [350, 350, 350, 350, 350, 0],
  });
  const e3 = member("#E3", {
    role: "elder",
    war: [14, 14, 14, 14, 14, 0],
    donations: [380, 380, 380, 380, 380, 0],
  });
  const { rows, band: b } = bandNow([...filler, chal, inc, e2, e3]);
  const margin = rows.get("#CHAL").score - rows.get("#INC").score;
  assert.ok(
    margin > 0 && margin < policy.swap_margin,
    `near-tie inside the deadband, got ${margin}`,
  );
  assert.ok(
    b.promotable.has("#CHAL"),
    "the longer-tenured challenger takes the close call",
  );
  assert.ok(b.demotable.has("#INC"));
  assert.equal(b.demote_reasons.get("#INC"), "outranked");

  const old = member("#OLD", {
    tenureDays: 900,
    war: [9, 9, 9, 9, 9, 0],
    donations: [200, 200, 200, 200, 200, 0],
  });
  const elders = [
    member("#E1", {
      role: "elder",
      tenureDays: 60,
      war: [13, 13, 13, 13, 13, 0],
      donations: [350, 350, 350, 350, 350, 0],
    }),
    member("#E2", {
      role: "elder",
      tenureDays: 60,
      war: [14, 14, 14, 14, 14, 0],
      donations: [380, 380, 380, 380, 380, 0],
    }),
    member("#E3", {
      role: "elder",
      tenureDays: 60,
      war: [15, 15, 15, 15, 15, 0],
      donations: [400, 400, 400, 400, 400, 0],
    }),
  ];
  const second = bandNow([...filler, old, ...elders]);
  assert.ok(
    !second.band.promotable.has("#OLD"),
    "behind on score, tenure changes nothing",
  );
  assert.equal(second.band.demotable.size, 0);
});

test("above the ceiling: the lowest-ranked participating elder is demoted as outranked", () => {
  // 10 roster: floor 2, ceil 3, target 3 (round 2.5 = 3). Five elders.
  const elders = Array.from({ length: 5 }, (_, i) =>
    member(`#E${i}`, {
      role: "elder",
      war: [8 + i, 8 + i, 8 + i, 8 + i, 8 + i, 0],
      donations: [
        100 + 10 * i,
        100 + 10 * i,
        100 + 10 * i,
        100 + 10 * i,
        100 + 10 * i,
        0,
      ],
    }),
  );
  const members = Array.from({ length: 5 }, (_, i) =>
    member(`#M${i}`, {
      war: [2, 2, 2, 2, 2, 0],
      donations: [20, 20, 20, 20, 20, 0],
    }),
  );
  const { band: b } = bandNow([...elders, ...members]);
  assert.equal(b.ceil, 3);
  assert.ok(b.demotable.has("#E0"));
  assert.ok(b.demotable.has("#E1"));
  assert.ok(!b.demotable.has("#E4"));
  assert.equal(b.demote_reasons.get("#E0"), "outranked");
});

// ---- the removal clock -------------------------------------------------------

function clockFor(opts, extra = {}) {
  const others = Array.from({ length: 10 }, (_, i) => member(`#O${i}`));
  const m = member("#X", opts);
  const v = evaluate({
    participation: participation([...others, m]),
    policy: { ...policy, ...extra },
    now: NOW,
  });
  return v.members.find((x) => x.player_tag === "#X");
}

test("kick clock: watch at three days, at risk at five, recommended at eight", () => {
  assert.equal(
    clockFor({ lastBattleDaysAgo: 2, war: [0, 0, 0, 0, 0, 0] }).removal.state,
    "none",
  );
  assert.equal(
    clockFor({ lastBattleDaysAgo: 3, war: [0, 0, 0, 0, 0, 0] }).removal.state,
    "watch",
  );
  assert.equal(
    clockFor({ lastBattleDaysAgo: 5, war: [0, 0, 0, 0, 0, 0] }).removal.state,
    "at_risk",
  );
  assert.equal(
    clockFor({ lastBattleDaysAgo: 8, war: [0, 0, 0, 0, 0, 0] }).removal.state,
    "recommended",
  );
});

test("contribution grace extends confirm on an open roster, and still escalates after it", () => {
  // 11 members of 50: slack .78 -> grace round(4*.78)=3 -> confirm 6 -> card at day 11.
  const contributor = { lastBattleDaysAgo: 9, war: [16, 16, 16, 16, 16, 0] };
  const v = clockFor(contributor);
  assert.equal(v.removal.grace_days, 3);
  assert.equal(v.removal.state, "at_risk");
  assert.equal(
    clockFor({ ...contributor, lastBattleDaysAgo: 11.5 }).removal.state,
    "recommended",
  );
  // A full roster gives no grace.
  assert.equal(clockFor(contributor, { roster_cap: 11 }).removal.grace_days, 0);
  assert.equal(
    clockFor(contributor, { roster_cap: 11 }).removal.state,
    "recommended",
  );
});

test("ranked participation earns the same grace as war", () => {
  const v = clockFor({
    lastBattleDaysAgo: 9,
    war: [0, 0, 0, 0, 0, 0],
    ranked: [0, 0, 0, 6, 0, 0],
  });
  assert.equal(v.removal.grace_days, 3);
});

test("a new membership resets a pre-join idle clock; newcomers get no shield after that", () => {
  const joinedYesterday = clockFor({
    tenureDays: 1,
    lastBattleDaysAgo: 20,
    war: [0, 0, 0, 0, 0, 0],
  });
  assert.equal(joinedYesterday.removal.state, "none");
  const joinedNineDaysAgo = clockFor({
    tenureDays: 9,
    lastBattleDaysAgo: 20,
    war: [0, 0, 0, 0, 0, 0],
  });
  assert.equal(joinedNineDaysAgo.removal.state, "recommended");
});

test("elder+ is never recommended for removal; a hold pauses at at_risk and expires by itself", () => {
  assert.equal(
    clockFor({ role: "elder", lastBattleDaysAgo: 20, war: [0, 0, 0, 0, 0, 0] })
      .removal.state,
    "at_risk",
  );
  const others = Array.from({ length: 10 }, (_, i) => member(`#O${i}`));
  const m = member("#X", { lastBattleDaysAgo: 20, war: [0, 0, 0, 0, 0, 0] });
  const held = evaluate({
    participation: participation([...others, m]),
    policy,
    now: NOW,
    holds: [
      { player_tag: "#X", until: new Date(NOW.getTime() + DAY).toISOString() },
    ],
  }).members.find((x) => x.player_tag === "#X");
  assert.equal(held.removal.state, "at_risk");
  assert.equal(held.removal.shielded, "hold");
  assert.equal(held.hold.active, true);
  const lapsed = evaluate({
    participation: participation([...others, m]),
    policy,
    now: NOW,
    holds: [
      { player_tag: "#X", until: new Date(NOW.getTime() - DAY).toISOString() },
    ],
  }).members.find((x) => x.player_tag === "#X");
  assert.equal(lapsed.removal.state, "recommended");
  assert.equal(lapsed.hold.active, false);
});

test("a member with no battle and no anchor is held, never judged", () => {
  const v = clockFor({ lastBattleDaysAgo: null, tenureKnown: false });
  // joined_observed_at still anchors: observed 120 days ago -> recommended.
  assert.equal(v.removal.state, "recommended");
  const p = participation([member("#X", { lastBattleDaysAgo: null })]);
  p.members[0].joined_observed_at = null;
  const held = evaluate({ participation: p, policy, now: NOW }).members[0];
  assert.equal(held.judgment.removal, "held");
  assert.equal(held.removal.state, "none");
});

// ---- sustained weeks, replayed ---------------------------------------------

test("promotion needs three qualifying weekly reviews, replayed from history", () => {
  const filler = Array.from({ length: 7 }, (_, i) =>
    member(`#F${i}`, {
      war: [4, 4, 4, 4, 4, 0],
      donations: [100, 100, 100, 100, 100, 0],
    }),
  );
  // Strong for the last three closed war weeks only: before that, absent.
  const riser = member("#RISER", {
    war: [0, 0, 16, 16, 16, 8],
    donations: [50, 50, 500, 500, 500, 200],
  });
  const p = participation([...filler, riser]);
  const v = evaluate({ participation: p, policy, now: NOW });
  const r = v.members.find((m) => m.player_tag === "#RISER");
  assert.equal(v.boundaries.length, 5);
  assert.deepEqual(
    r.trail.map((t) => t.promotable),
    [false, false, true, true, true],
  );
  assert.equal(r.promotion.state, "eligible");
  assert.equal(r.actionable.promotion, true);
  // One review fewer and it is still building.
  const earlier = evaluate({
    participation: p,
    policy,
    now: new Date("2026-09-06T00:00:00Z"),
  });
  assert.equal(
    earlier.members.find((m) => m.player_tag === "#RISER").promotion.state,
    "building",
  );
});

test("two misses in a row reset the promotion clock; one miss is tolerated; the role clears it", () => {
  const step = (promotable, extra = {}) => ({
    promotable,
    demotable: false,
    reason: null,
    role: "member",
    ...extra,
  });
  const run = (flags) =>
    replayMachines(
      flags.map((f) => step(f)),
      policy,
    );
  assert.equal(run([true, true, true]).pState, "eligible");
  assert.equal(
    run([true, false, true]).pState,
    "building",
    "one miss is tolerated",
  );
  assert.equal(run([true, false, true, true]).pState, "eligible");
  assert.equal(run([true, false, false]).pState, "none", "two misses reset");
  assert.equal(
    run([true, true, true, false, false]).pState,
    "building",
    "an eligible member drops back, keeping half",
  );
  assert.equal(run([true, true, true, false, false]).pWeeks, 1);
  const promoted = replayMachines(
    [step(true), step(true), step(true, { role: "elder" })],
    policy,
  );
  assert.equal(
    promoted.pState,
    "none",
    "already holding the role needs no card",
  );
  const d = (reason, n) =>
    replayMachines(
      Array.from({ length: n }, () => ({
        promotable: false,
        demotable: true,
        reason,
        role: "elder",
      })),
      policy,
    );
  assert.equal(d("abandoned", 1).dState, "building");
  assert.equal(d("abandoned", 2).dState, "eligible");
  assert.equal(d("outranked", 2).dState, "building");
  assert.equal(d("outranked", 3).dState, "eligible");
  const back = replayMachines(
    [
      {
        promotable: false,
        demotable: true,
        reason: "abandoned",
        role: "elder",
      },
      { promotable: false, demotable: false, reason: null, role: "elder" },
    ],
    policy,
  );
  assert.equal(back.dState, "none", "any week off the gate resets the clock");
});

test("demotion for abandonment takes two reviews; outranked takes three", () => {
  const filler = Array.from({ length: 8 }, (_, i) =>
    member(`#F${i}`, {
      war: [8, 8, 8, 8, 8, 0],
      donations: [200, 200, 200, 200, 200, 0],
    }),
  );
  const quit = member("#QUIT", {
    role: "elder",
    war: [16, 16, 0, 0, 0, 0],
    donations: [400, 400, 0, 0, 0, 0],
  });
  const v = evaluate({
    participation: participation([...filler, quit]),
    policy,
    now: NOW,
  });
  const r = v.members.find((m) => m.player_tag === "#QUIT");
  assert.equal(r.demotion.reason, "abandoned");
  assert.equal(r.demotion.state, "eligible");
  assert.ok(r.demotion.weeks >= 2);
  assert.equal(r.actionable.demotion, true);
});

// ---- decisions and cooldowns -----------------------------------------------

test("a declined card blocks re-nomination until the cooldown lapses; a completed one waits out the outcome window", () => {
  const others = Array.from({ length: 10 }, (_, i) => member(`#O${i}`));
  const idle = member("#X", { lastBattleDaysAgo: 20, war: [0, 0, 0, 0, 0, 0] });
  const declined = [
    {
      player_tag: "#X",
      type: "removal",
      status: "declined",
      decided_at: new Date(NOW.getTime() - 3 * DAY).toISOString(),
    },
  ];
  const v = evaluate({
    participation: participation([...others, idle]),
    policy,
    now: NOW,
    decisions: declined,
  });
  const r = v.members.find((m) => m.player_tag === "#X");
  assert.equal(r.removal.state, "recommended");
  assert.equal(r.actionable.removal, false, "inside the 7-day cooldown");
  const old = [
    {
      ...declined[0],
      decided_at: new Date(NOW.getTime() - 8 * DAY).toISOString(),
    },
  ];
  const v2 = evaluate({
    participation: participation([...others, idle]),
    policy,
    now: NOW,
    decisions: old,
  });
  assert.equal(
    v2.members.find((m) => m.player_tag === "#X").actionable.removal,
    true,
  );
  // Completed three days ago: past the 48-hour outcome window.
  const done = [{ ...declined[0], status: "done" }];
  const v3 = evaluate({
    participation: participation([...others, idle]),
    policy,
    now: NOW,
    decisions: done,
  });
  assert.equal(
    v3.members.find((m) => m.player_tag === "#X").actionable.removal,
    true,
  );
  // Completed an hour ago and the member still on the roster (the kick
  // not polled yet): no new removal until the window passes (2026-09-25).
  const justDone = [
    {
      ...done[0],
      decided_at: new Date(NOW.getTime() - 3600_000).toISOString(),
    },
  ];
  const v4 = evaluate({
    participation: participation([...others, idle]),
    policy,
    now: NOW,
    decisions: justDone,
  });
  const r4 = v4.members.find((m) => m.player_tag === "#X");
  assert.equal(r4.actionable.removal, false, "waits for the record");
  assert.ok(r4.removal.cooldown_until);
  // One the record never confirmed (flagged) may be raised again.
  const v5 = evaluate({
    participation: participation([...others, idle]),
    policy,
    now: NOW,
    decisions: [{ ...justDone[0], outcome_flagged: true }],
  });
  assert.equal(
    v5.members.find((m) => m.player_tag === "#X").actionable.removal,
    true,
  );
});

test("reconcile: an open action about someone no longer in the clan is withdrawn; other kinds are left to their own rules", () => {
  const others = Array.from({ length: 11 }, (_, i) => member(`#O${i}`));
  const v = evaluate({
    participation: participation(others),
    policy,
    now: NOW,
  });
  const { withdraw } = reconcileCards(v, [
    { card_id: "gone", player_tag: "#GONE", type: "removal" },
    { card_id: "gone2", player_tag: "#GONE", type: "promotion" },
    { card_id: "dep", player_tag: "#GONE", type: "departure" },
  ]);
  assert.deepEqual(
    withdraw.map((w) => [w.card.card_id, w.reason]),
    [
      ["gone", "They are no longer in the clan."],
      ["gone2", "They are no longer in the clan."],
    ],
  );
});

test("reconcile: raise for actionable verdicts without an open card, withdraw open cards no longer supported", () => {
  const others = Array.from({ length: 10 }, (_, i) => member(`#O${i}`));
  const idle = member("#IDLE", {
    lastBattleDaysAgo: 20,
    war: [0, 0, 0, 0, 0, 0],
  });
  const back = member("#BACK", {
    lastBattleDaysAgo: 0.1,
    war: [0, 0, 0, 0, 0, 0],
  });
  const v = evaluate({
    participation: participation([...others, idle, back]),
    policy,
    now: NOW,
  });
  const { raise, withdraw } = reconcileCards(v, [
    { card_id: "c1", player_tag: "#BACK", type: "removal" },
    { card_id: "c2", player_tag: "#IDLE", type: "removal" },
  ]);
  assert.deepEqual(
    raise.filter((r) => r.type === "removal"),
    [],
  );
  assert.equal(withdraw.length, 1);
  assert.equal(withdraw[0].card.card_id, "c1");
  assert.match(withdraw[0].reason, /played/);
  const fresh = reconcileCards(v, []);
  assert.deepEqual(
    fresh.raise
      .filter((r) => r.type === "removal")
      .map((r) => `${r.player_tag}:${r.type}`),
    ["#IDLE:removal"],
  );
});

// ---- readiness ---------------------------------------------------------------

test("readiness fails closed: unknown tenure, no war record, Elder by hand, removal off", () => {
  const p = participation([member("#A", { tenureKnown: false }), member("#B")]);
  const v = evaluate({ participation: p, policy, now: NOW });
  assert.equal(
    v.members.find((m) => m.player_tag === "#A").judgment.promotion,
    "unknown",
  );
  assert.equal(
    v.members.find((m) => m.player_tag === "#B").judgment.promotion,
    "ready",
  );
  const noWar = participation([member("#B")], { war_weeks: [] });
  const v2 = evaluate({ participation: noWar, policy, now: NOW });
  assert.equal(v2.boundaries.length, 0);
  assert.equal(v2.members[0].judgment.promotion, "held");
  const off = evaluate({
    participation: p,
    policy: {
      ...policy,
      elder_mode: "manual",
      removal_enabled: false,
    },
    now: NOW,
  });
  assert.equal(off.members[1].judgment.promotion, "off");
  assert.equal(off.members[1].judgment.removal, "off");
  assert.equal(off.band, null, "no band when leaders choose Elders by hand");
  assert.equal(off.boundaries.length, 0);
  assert.equal(off.members[1].standing, null);
  assert.deepEqual(off.members[1].actionable, {
    promotion: false,
    demotion: false,
    removal: false,
  });
});

test("a clan that does not count Clan Wars is reviewed at the end of each whole week", () => {
  const noWarClan = {
    ...policy,
    war_enabled: false,
    elder_weight_war: 0,
    war_min_decks: 0,
  };
  const p = participation([member("#B")], { war_weeks: [] });
  const v = evaluate({ participation: p, policy: noWarClan, now: NOW });
  // Five whole ISO weeks closed before NOW; the sixth is partial.
  assert.equal(v.boundaries.length, 5);
  assert.equal(v.boundaries.at(-1), "2026-09-07T00:00:00.000Z");
  assert.equal(v.members[0].judgment.promotion, "ready");
  assert.equal(
    v.members[0].judgment.promotion,
    evaluate({ participation: p, policy: noWarClan, now: NOW }).members[0]
      .judgment.promotion,
  );
});

test("Elders can be carded for inactivity when the policy says so; leadership never is", () => {
  const others = Array.from({ length: 10 }, (_, i) => member(`#O${i}`));
  const elder = member("#E", {
    role: "elder",
    lastBattleDaysAgo: 20,
    war: [0, 0, 0, 0, 0, 0],
  });
  const co = member("#C", {
    role: "coLeader",
    lastBattleDaysAgo: 20,
    war: [0, 0, 0, 0, 0, 0],
  });
  const p = participation([...others, elder, co]);
  const find = (v, tag) => v.members.find((m) => m.player_tag === tag);
  const shielded = evaluate({ participation: p, policy, now: NOW });
  assert.equal(find(shielded, "#E").removal.shielded, "role");
  const included = evaluate({
    participation: p,
    policy: { ...policy, removal_includes_elders: true },
    now: NOW,
  });
  assert.equal(find(included, "#E").removal.state, "recommended");
  assert.equal(find(included, "#E").actionable.removal, true);
  assert.equal(find(included, "#C").removal.shielded, "role");
});

test("review boundaries are the observed war-week finishes before now, newest last", () => {
  const b = reviewBoundaries(participation([]), NOW, 3).map((d) =>
    d.toISOString().slice(0, 10),
  );
  assert.deepEqual(b, ["2026-08-24", "2026-08-31", "2026-09-07"]);
});

test("the war minimum counts decks in the window; an unrecorded log never passes the ranked minimum", () => {
  const two = member("#TWO", { war: [2, 2, 2, 2, 2, 2] });
  const unrecorded = {
    ...member("#UNREC", {
      war: [2, 2, 2, 2, 2, 2],
      ranked: [9, 9, 9, 9, 9, 9],
    }),
    log_recorded: false,
  };
  const facts = factsAt(participation([two, unrecorded]), policy, NOW);
  const a = facts.find((f) => f.player_tag === "#TWO");
  const b = facts.find((f) => f.player_tag === "#UNREC");
  assert.equal(a.minimums.war_decks, policy.minimums_window_weeks * 2);
  assert.equal(a.minimums.met.war, true);
  assert.equal(
    a.minimums.log_recorded,
    true,
    "absent = recorded (an older door)",
  );
  assert.equal(b.minimums.log_recorded, false);
  assert.equal(b.minimums.met.ranked, null);
});

test("an unrecorded battle log holds every judgment that could card its constructed zeros", () => {
  const peers = Array.from({ length: 8 }, (_, i) =>
    member(`#F${i}`, {
      war: [8, 8, 8, 8, 8, 0],
      donations: [200, 200, 200, 200, 200, 0],
    }),
  );
  const unknownMember = {
    ...member("#UNKNOWN-MEMBER", {
      lastBattleDaysAgo: null,
      tenureDays: 120,
    }),
    log_recorded: false,
  };
  const unknownElder = {
    ...member("#UNKNOWN-ELDER", {
      role: "elder",
      war: [0, 0, 0, 0, 0, 0],
      ranked: [9, 9, 9, 9, 9, 0],
    }),
    log_recorded: false,
  };
  const verdicts = evaluate({
    participation: participation([...peers, unknownMember, unknownElder]),
    policy,
    now: NOW,
  });
  const m = verdicts.members.find(
    (row) => row.player_tag === "#UNKNOWN-MEMBER",
  );
  const e = verdicts.members.find((row) => row.player_tag === "#UNKNOWN-ELDER");

  assert.equal(m.removal.state, "recommended", "the clock may be computed");
  assert.equal(m.judgment.promotion, "held");
  assert.equal(m.judgment.removal, "held");
  assert.deepEqual(m.actionable, {
    promotion: false,
    demotion: false,
    removal: false,
  });

  assert.equal(e.demotion.state, "eligible", "the trail may be computed");
  assert.equal(e.judgment.demotion, "held");
  assert.equal(e.judgment.removal, "held");
  assert.deepEqual(e.actionable, {
    promotion: false,
    demotion: false,
    removal: false,
  });
});
