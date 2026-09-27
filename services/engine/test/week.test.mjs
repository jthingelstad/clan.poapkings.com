import { test } from "node:test";
import assert from "node:assert/strict";
import { reportWeeks, weeklyReport } from "../src/week.mjs";
import { validate } from "../src/policy.mjs";
import { member, participation, NOW, EXAMPLE_POLICY } from "./fixture.mjs";

const DAY = 86400_000;
const at = (iso) => new Date(iso);

test("the week closes at the Monday reset: its war week's finish, or 10:00 UTC Monday", () => {
  const p = participation([member("#A")]);
  // Saturday: the latest closed week is the one that ended last Monday.
  assert.equal(reportWeeks(p, NOW)[0].iso_week, "2026-W36");
  assert.equal(reportWeeks(p, NOW).length, 5);
  // Monday before the reset: the week that just ended is not closed yet.
  const monday = at("2026-09-14T05:00:00Z");
  assert.equal(reportWeeks(p, monday)[0].iso_week, "2026-W36");
  // At the game's reset it is.
  const reset = at("2026-09-14T10:00:00Z");
  assert.equal(reportWeeks(p, reset)[0].iso_week, "2026-W37");
  // A war week that finishes before the reset closes it then.
  const finished = participation([member("#A")]);
  finished.war_weeks[5].finished_observed_at = "2026-09-14T09:38:00.000Z";
  assert.equal(
    reportWeeks(finished, at("2026-09-14T09:40:00Z"))[0].iso_week,
    "2026-W37",
  );
  assert.equal(
    reportWeeks(finished, at("2026-09-14T09:30:00Z"))[0].iso_week,
    "2026-W36",
  );
});

test("everyone who took part is named with what they did; nobody who did not", () => {
  const p = participation([
    member("#A", { name: "Ada", war: [16, 16, 16, 16, 16, 4] }),
    member("#B", { name: "Bo", war: [16, 16, 16, 16, 10, 0] }),
    member("#C", {
      name: "Cy",
      war: [0, 0, 0, 0, 0, 0],
      donations: [0, 0, 0, 0, 0, 0],
      battles: [0, 0, 0, 0, 0, 0],
    }),
    member("#D", { name: "Di", war: [16, 16, 16, 16, null, 0] }),
  ]);
  const r = weeklyReport(p, { now: NOW });
  assert.equal(r.week.iso_week, "2026-W36");
  const war = r.areas.find((a) => a.key === "war");
  // The week's war week is Colosseum: all four days asked.
  assert.equal(war.war.is_colosseum, true);
  assert.equal(war.war.decks_asked, 16);
  assert.deepEqual(
    war.participants.map((x) => [x.name, x.value, x.all_decks]),
    [
      ["Ada", 16, true],
      ["Bo", 10, false],
    ],
  );
  assert.equal(war.total, 26);
  assert.equal(war.points, 26 * 200);
  assert.equal(war.war.all_decks, 1);
  const donations = r.areas.find((a) => a.key === "donations");
  assert.deepEqual(
    donations.participants.map((x) => x.name),
    ["Ada", "Bo", "Di"],
  );
  assert.equal(donations.total, 600);
  // Cy did nothing this week and appears nowhere.
  assert.ok(!JSON.stringify(r.areas).includes("#C"));
  assert.equal(r.members, 4);
});

test("an early finish asks four decks a day up to the finish", () => {
  const p = participation([member("#A", { war: [16, 16, 16, 12, 16, 0] })]);
  p.war_weeks[3].finish_war_day = 3;
  p.war_weeks[3].finished_early = true;
  const r = weeklyReport(p, { now: NOW, week: "2026-W35" });
  const war = r.areas.find((a) => a.key === "war");
  assert.equal(war.war.decks_asked, 12);
  assert.equal(war.war.finished_early, true);
  assert.equal(war.war.finish_war_day, 3);
  assert.equal(war.participants[0].all_decks, true);
});

test("an active policy's categories are highlighted, in its order; trophy road shows as battles", () => {
  const p = participation([member("#A"), member("#B")]);
  const r = weeklyReport(p, { now: NOW, policy: EXAMPLE_POLICY });
  assert.equal(r.highlight.basis, "policy");
  assert.deepEqual(r.highlight.counted, ["war", "ranked", "donations"]);
  assert.deepEqual(
    r.areas.map((a) => [a.key, a.highlighted]),
    [
      ["war", true],
      ["ranked", true],
      ["donations", true],
      ["battles", false],
    ],
  );
  const trophies = validate({ trophies_enabled: true }).values;
  const t = weeklyReport(p, { now: NOW, policy: trophies });
  assert.deepEqual(
    t.areas.filter((a) => a.highlighted).map((a) => a.key),
    ["battles"],
  );
  assert.equal(t.areas[0].key, "battles");
});

test("with no policy, or one that counts nothing, the busiest areas are highlighted", () => {
  const quiet = { war: [0, 0, 0, 0, 0, 0], donations: [0, 0, 0, 0, 0, 0] };
  const p = participation([
    member("#A", { ranked: [0, 0, 0, 0, 9, 0] }),
    member("#B", quiet),
    member("#C", quiet),
  ]);
  for (const policy of [null, validate({}).values]) {
    const r = weeklyReport(p, { now: NOW, policy });
    assert.equal(r.highlight.basis, "activity");
    // Everyone battled; one of three warred, donated and played ranked.
    assert.deepEqual(
      r.areas.filter((a) => a.highlighted).map((a) => a.key),
      ["battles"],
    );
    assert.equal(r.areas[0].key, "battles");
  }
  // When no area reaches half the clan, the busiest one is highlighted.
  const few = participation([
    member("#A", { ranked: [0, 0, 0, 0, 9, 0] }),
    member("#B", { ...quiet, battles: [0, 0, 0, 0, 0, 0] }),
    member("#C", { ...quiet, battles: [0, 0, 0, 0, 0, 0] }),
  ]);
  const f = weeklyReport(few, { now: NOW });
  assert.deepEqual(
    f.areas.filter((a) => a.highlighted).map((a) => a.key),
    ["war"],
  );
});

test("a member who joined after the week is not in it; one who joined during it is marked", () => {
  const p = participation([
    member("#A"),
    member("#NEW", { tenureDays: 2 }),
    member("#MID", { tenureDays: 9 }),
  ]);
  const r = weeklyReport(p, { now: NOW });
  const tags = r.areas.find((a) => a.key === "battles").participants;
  assert.deepEqual(tags.map((x) => x.player_tag).sort(), ["#A", "#MID"]);
  assert.equal(tags.find((x) => x.player_tag === "#MID").joined_during, true);
  assert.equal(r.members, 2);
  assert.equal(r.joined_during, 1);
});

test("who came and went: joins, departures (never kick or leave), promotions and demotions in the week", () => {
  const p = participation([member("#A", { name: "Ada" })]);
  const ev = (type, iso, detail) => ({ type, at: iso, detail });
  const roster = {
    members: [{ player_tag: "#A", name: "Ada" }],
    recent_events: [
      ev("member_joined", "2026-08-20T00:00:00Z", { player_tag: "#OLD" }),
      ev("member_joined", "2026-09-01T12:00:00Z", {
        player_tag: "#J",
        name: "Jo",
      }),
      ev("member_left", "2026-09-02T12:00:00Z", {
        player_tag: "#L",
        name: "Lu",
        role_at_departure: "member",
      }),
      ev("role_changed", "2026-09-03T12:00:00Z", {
        player_tag: "#A",
        role_before: "member",
        role_after: "elder",
      }),
      ev("role_changed", "2026-09-04T12:00:00Z", {
        player_tag: "#E",
        name: "Ed",
        role_before: "elder",
        role_after: "member",
      }),
      ev("member_left", "2026-09-08T12:00:00Z", { player_tag: "#LATER" }),
    ],
  };
  const r = weeklyReport(p, { now: NOW, roster });
  const m = r.membership;
  assert.deepEqual(
    m.joined.map((x) => x.name),
    ["Jo"],
  );
  assert.deepEqual(
    m.departed.map((x) => [x.name, Object.keys(x).sort().join()]),
    [["Lu", "at,name,player_tag"]],
  );
  assert.deepEqual(
    m.promoted.map((x) => [x.name, x.role_after]),
    [["Ada", "elder"]],
  );
  assert.deepEqual(
    m.demoted.map((x) => x.name),
    ["Ed"],
  );
  assert.equal(m.complete, true);
  // A week older than the roster's events says so.
  const older = weeklyReport(p, { now: NOW, roster, week: "2026-W32" });
  assert.equal(older.membership.complete, false);
  assert.equal(older.membership.events_from, "2026-08-20T00:00:00.000Z");
});

test("an older closed week by its id; an open or unknown week is none", () => {
  const p = participation([member("#A")]);
  const r = weeklyReport(p, { now: NOW, week: "2026-w33" });
  assert.equal(r.week.iso_week, "2026-W33");
  assert.equal(r.weeks.length, 5);
  assert.equal(weeklyReport(p, { now: NOW, week: "2026-W37" }), null);
  assert.equal(weeklyReport(p, { now: NOW, week: "2025-W01" }), null);
});

test("the week so far: each area's total and how many took part", () => {
  const p = participation([
    member("#A"),
    member("#B", { war: [16, 16, 16, 16, 16, 0] }),
  ]);
  const r = weeklyReport(p, { now: NOW });
  assert.equal(r.so_far.iso_week, "2026-W37");
  const war = r.so_far.areas.find((a) => a.key === "war");
  assert.deepEqual([war.total, war.took_part], [8, 1]);
  const battles = r.so_far.areas.find((a) => a.key === "battles");
  assert.deepEqual([battles.total, battles.took_part], [20, 2]);
});

test("before any week has closed there is no report yet, only the week so far", () => {
  const p = participation([member("#A")]);
  p.weeks = p.weeks.slice(-1);
  const r = weeklyReport(p, { now: new Date(NOW.getTime() - DAY) });
  assert.equal(r.week, null);
  assert.deepEqual(r.weeks, []);
  assert.equal(r.so_far.iso_week, "2026-W37");
});
