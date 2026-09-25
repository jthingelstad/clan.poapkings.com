/**
 * Awards: each kind's semantics on Elixir's shapes, judged under an
 * example clan's awards document.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultAwards,
  describeAward,
  evaluateAwards,
  seasonsFrom,
  validateAwards,
} from "../src/awards.mjs";
import { member, participation, NOW, EXAMPLE_AWARDS } from "./fixture.mjs";

const config = EXAMPLE_AWARDS;
const run = (members, opts = {}) =>
  evaluateAwards({
    participation: participation(members),
    config: opts.config ?? config,
    now: NOW,
    grants: opts.grants ?? [],
    config_version: 1,
  });
const season = (result, id) => result.seasons.find((s) => s.season_id === id);
const award = (result, id, awardId) =>
  season(result, id).awards.find((a) => a.award_id === awardId);

// ---- seasons ----------------------------------------------------------------

test("the record's war weeks group into seasons: 135 closed and complete, 136 live", () => {
  const seasons = seasonsFrom(participation([member("#AAA")]), NOW);
  assert.deepEqual(
    seasons.map((s) => [s.season_id, s.closed, s.complete, s.weeks.length]),
    [
      [135, true, true, 5],
      [136, false, true, 1],
    ],
  );
  assert.equal(seasons[0].closed_at, "2026-09-07T09:34:00.000Z");
});

test("a season whose first section is not in the record is held, never judged", () => {
  const p = participation([member("#AAA")]);
  p.war_weeks = p.war_weeks.filter(
    (w) => !(w.season_id === 135 && w.section_index === 0),
  );
  const r = evaluateAwards({ participation: p, config, now: NOW, grants: [] });
  const s = season(r, 135);
  assert.equal(s.complete, false);
  assert.equal(award(r, 135, "season_champ").state, "held");
  assert.equal(r.grants_due.length, 0);
});

// ---- season points podium ---------------------------------------------------

test("Season Champion: points order, donations tiebreak, ties named, podium of three", () => {
  const r = run([
    member("#AAA", { war: [16, 16, 16, 16, 16, 8] }), // 16000
    member("#BBB", {
      war: [16, 16, 16, 16, 15, 8],
      donations: [100, 100, 100, 100, 100, 100],
    }), // 15800
    member("#CCC", {
      war: [16, 16, 16, 16, 15, 8],
      donations: [300, 300, 300, 300, 300, 300],
    }), // 15800, higher donor
    member("#DDD", { war: [8, 8, 8, 8, 8, 8] }),
    member("#EEE", { war: [0, 0, 0, 0, 0, 0] }),
  ]);
  const champ = award(r, 135, "season_champ");
  assert.equal(champ.state, "closed");
  assert.deepEqual(
    champ.rows.map((x) => [
      x.player_tag,
      x.points,
      x.rank,
      x.official_rank,
      x.tied,
      x.on_podium,
    ]),
    [
      ["#AAA", 16000, 1, 1, false, true],
      ["#CCC", 15800, 2, 2, true, true],
      ["#BBB", 15800, 2, 3, true, true],
      ["#DDD", 8000, 4, 4, false, false],
    ],
    "zero points is not in the race; the tie is named and the donor takes the higher place",
  );
  const due = r.grants_due.filter((g) => g.award_id === "season_champ");
  assert.deepEqual(
    due.map((g) => [g.player_tag, g.rank, g.metric_value, g.metadata.tied]),
    [
      ["#AAA", 1, 16000, false],
      ["#CCC", 2, 15800, true],
      ["#BBB", 3, 15800, true],
    ],
  );
  // The open season is live: standings, nothing due.
  assert.equal(award(r, 136, "season_champ").state, "live");
  assert.ok(r.grants_due.every((g) => g.season_id === 135));
});

test("with no tiebreak a tie at the podium's edge keeps everyone tied", () => {
  const cfg = structuredClone(EXAMPLE_AWARDS);
  cfg.awards[0].params = { podium: 1, tiebreak: "none" };
  const r = run(
    [
      member("#AAA", { war: [16, 16, 16, 16, 16, 8] }),
      member("#BBB", { war: [16, 16, 16, 16, 16, 8] }),
      member("#CCC", { war: [8, 8, 8, 8, 8, 8] }),
    ],
    { config: cfg },
  );
  const due = r.grants_due.filter((g) => g.award_id === "season_champ");
  assert.deepEqual(due.map((g) => g.player_tag).sort(), ["#AAA", "#BBB"]);
});

test("a granted (season, award) is never due again; other awards still are", () => {
  const r = run([member("#AAA")], {
    grants: [{ season_id: 135, award_id: "season_champ", player_tag: "#AAA" }],
  });
  assert.ok(!r.grants_due.some((g) => g.award_id === "season_champ"));
  assert.ok(r.grants_due.some((g) => g.award_id === "ever_present"));
});

// ---- perfect attendance -----------------------------------------------------

test("Ever Present is pass/fail on decks: every deck asked for; one day's worth short fails at zero misses and passes at one", () => {
  const r = run([
    member("#AAA", { war: [16, 16, 16, 16, 16, 8] }),
    member("#BBB", { war: [16, 16, 16, 16, 15, 8] }),
    member("#CCC", { war: [16, 16, null, 16, 16, 8] }),
  ]);
  const iron = award(r, 135, "ever_present");
  assert.deepEqual(
    iron.rows.map((x) => [x.player_tag, x.decks_short, x.decks_asked]),
    [["#AAA", 0, 80]],
  );
  const due = r.grants_due.filter((g) => g.award_id === "ever_present");
  assert.deepEqual(
    due.map((g) => [g.player_tag, g.rank, g.metric_unit]),
    [["#AAA", 1, "war_decks"]],
  );

  const cfg = structuredClone(EXAMPLE_AWARDS);
  cfg.awards[1].params = { decks_per_day: 4, allowed_misses: 1 };
  const r2 = run(
    [
      member("#AAA", { war: [16, 16, 16, 16, 16, 8] }),
      member("#BBB", { war: [16, 16, 16, 16, 15, 8] }),
      member("#CCC", { war: [16, 16, null, 16, 16, 8] }),
    ],
    { config: cfg },
  );
  assert.deepEqual(
    award(r2, 135, "ever_present").rows.map((x) => x.player_tag),
    ["#AAA", "#BBB"],
    "a week the record cannot see is never a pass",
  );
});

test("Ever Present reads the week's own deck count, however the days fell (decks, not days)", () => {
  // 14 of 16 in one week: short two decks at four a day; at two a day the
  // week asks eight and 14 clears it. The per-day split never matters.
  const days = [
    [4, 4, 4, 4],
    [4, 4, 4, 4],
    [4, 4, 4, 4],
    [4, 4, 4, 4],
    [4, 4, 2, 4],
    [null, null, null, null],
  ];
  const r = run([member("#AAA", { war: [16, 16, 16, 16, 14, 0], days })]);
  assert.deepEqual(award(r, 135, "ever_present").rows, []);
  const cfg = structuredClone(EXAMPLE_AWARDS);
  cfg.awards[1].params = { decks_per_day: 2, allowed_misses: 0 };
  const r2 = run([member("#AAA", { war: [16, 16, 16, 16, 14, 0], days })], {
    config: cfg,
  });
  assert.deepEqual(
    award(r2, 135, "ever_present").rows.map((x) => x.player_tag),
    ["#AAA"],
  );
});

test("a season with no war days recorded for anyone holds the award rather than crowning nobody", () => {
  const r = run([
    member("#AAA", { war: [null, null, null, null, null, null] }),
    member("#BBB", { war: [null, null, null, null, null, null] }),
  ]);
  assert.equal(award(r, 135, "ever_present").state, "held");
});

// ---- donations --------------------------------------------------------------

test("Top Donor sums the week-end counters of the season's weeks", () => {
  const r = run([
    member("#AAA", { donations: [100, 200, 300, 400, 500, 999] }),
    member("#BBB", { donations: [50, 50, 50, 50, 50, 50] }),
    member("#CCC", { donations: [0, 0, 0, 0, 0, 0] }),
  ]);
  const d = award(r, 135, "top_donor");
  // War weeks start on the Mondays of ISO weeks 1..5 (08-10 .. 09-07).
  assert.deepEqual(
    d.rows.map((x) => [x.player_tag, x.total, x.known_weeks]),
    [
      ["#AAA", 200 + 300 + 400 + 500 + 999, 5],
      ["#BBB", 250, 5],
    ],
  );
});

// ---- rookies ----------------------------------------------------------------

test("Top Rookie: joined this season, or last season without a war day; never a pre-record join", () => {
  const r = run([
    member("#OLD", { tenureDays: 300, war: [16, 16, 16, 16, 16, 8] }),
    member("#NEW", { tenureDays: 20, war: [0, 0, 0, 0, 16, 8] }), // joined in the Colosseum week of 135
    member("#PRE", {
      tenureDays: 400,
      tenureKnown: false,
      war: [16, 16, 16, 16, 16, 8],
    }),
  ]);
  const rookies = award(r, 135, "top_rookie");
  assert.deepEqual(
    rookies.rows.map((x) => [x.player_tag, x.rank]),
    [["#NEW", 1]],
  );
  // In 136, #NEW joined during the previous season and played it: not a rookie.
  assert.deepEqual(award(r, 136, "top_rookie").rows, []);
});

// ---- leaders' pick ----------------------------------------------------------

test("a leaders' pick computes nothing and shows what was granted by hand", () => {
  const r = run([member("#AAA")], {
    grants: [
      {
        season_id: 135,
        award_id: "clan_honour",
        player_tag: "#AAA",
        player_name: "AAA",
        note: "Second on points; last season's holder sat out.",
        granted_at: "2026-09-08T00:00:00Z",
        granted_by: "#LEAD",
      },
    ],
  });
  const fp = award(r, 135, "clan_honour");
  assert.equal(fp.state, "manual");
  assert.equal(
    fp.rows[0].note,
    "Second on points; last season's holder sat out.",
  );
  assert.ok(!r.grants_due.some((g) => g.award_id === "clan_honour"));
});

// ---- the document -----------------------------------------------------------

test("an awards document validates; bad ids, kinds, parameters and duplicates are refused in a leader's words", () => {
  assert.equal(validateAwards(EXAMPLE_AWARDS).ok, true);
  assert.equal(validateAwards(defaultAwards()).ok, true);
  const bad = validateAwards({
    awards: [
      { id: "Season Champion", kind: "season_points_podium", name: "x" },
      { id: "a", kind: "nope", name: "x" },
      {
        id: "ok",
        kind: "perfect_attendance",
        name: "",
        params: { decks_per_day: 9, bogus: 1 },
      },
      { id: "ok", kind: "donations_podium", name: "y", params: { podium: 2 } },
    ],
  });
  assert.equal(bad.ok, false);
  assert.match(bad.errors["awards.0.id"], /lowercase/);
  assert.match(bad.errors["awards.1.kind"], /not a kind/);
  assert.match(bad.errors["awards.2.name"], /1 to 40/);
  assert.match(bad.errors["awards.2.params.decks_per_day"], /between 1 and 4/);
  assert.match(bad.errors["awards.2.params.bogus"], /not a setting/);
  assert.match(bad.errors["awards.3.id"], /share/);
  // Missing parameters take the kind's default; nothing is published.
  const ok = validateAwards({
    awards: [{ id: "champ", kind: "season_points_podium", name: "Champ" }],
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.values.awards[0].params, {
    podium: 3,
    tiebreak: "donations",
  });
  assert.equal("publish" in ok.values, false);
});

test("every award describes its rule in one sentence under its parameters", () => {
  for (const a of EXAMPLE_AWARDS.awards)
    assert.ok(describeAward(a).length > 20);
  assert.match(
    describeAward({
      kind: "perfect_attendance",
      params: { decks_per_day: 3, allowed_misses: 1 },
    }),
    /At least 3 decks a war day .* up to 1 day's worth of decks short/,
  );
});

test("every clan starts with no awards, whatever its tag", () => {
  assert.deepEqual(defaultAwards().awards, []);
  assert.equal(defaultAwards.length, 0, "the start never depends on the clan");
});
