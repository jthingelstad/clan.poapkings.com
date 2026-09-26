/**
 * Award standings to Elixir (manage/standings.mjs), pure: the running
 * season's podium places and on-track members as facts, the latest closed
 * season's final places, and the plan that writes only what moved, names
 * the previous leader when first place changes hands between two single
 * leaders, and takes back what is no longer held.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { planStandings, standingsFrom } from "../src/manage/standings.mjs";

const AS_OF = "2026-09-26T11:00:00.000Z";
const podium = (rows) =>
  rows.map(([tag, place, points]) => ({
    player_tag: tag,
    name: tag,
    official_rank: place,
    place,
    points,
    on_podium: place <= 3,
  }));
const attendanceRows = (tags) =>
  tags.map((tag) => ({
    player_tag: tag,
    name: tag,
    decks_asked: 16,
    decks_short: 0,
  }));
const season = (id, champRows, { closed = false, onTrack = ["#MG"] } = {}) => ({
  season_id: id,
  closed,
  complete: true,
  awards: [
    {
      award_id: "points_podium",
      kind: "season_points_podium",
      name: "Points Podium",
      computed: true,
      state: closed ? "closed" : "live",
      rows: podium(champRows),
    },
    {
      award_id: "full_attendance",
      kind: "perfect_attendance",
      name: "Full Attendance",
      computed: true,
      state: closed ? "closed" : "live",
      rows: attendanceRows(onTrack),
    },
    {
      award_id: "leaders_pick",
      kind: "leaders_pick",
      name: "Leaders' Pick",
      computed: false,
      state: "manual",
      rows: [],
    },
  ],
});
const result = (...seasons) => ({ as_of: AS_OF, seasons });

test("the running season's podium and on-track members become facts; a pick does not", () => {
  const s = standingsFrom(
    result(
      season(136, [
        ["#SA", 1, 6400],
        ["#AJ", 2, 5850],
        ["#DZ", 3, 5450],
        ["#SS", 4, 5200],
      ]),
    ),
  );
  assert.equal(s.season_id, 136);
  const facts = [...s.facts.values()];
  assert.equal(facts.length, 4, "three on the podium, one on track, no pick");
  const first = facts.find(
    (f) => f.detail.award_id === "points_podium" && f.detail.place === 1,
  );
  assert.deepEqual(first.detail, {
    award: "Points Podium",
    award_id: "points_podium",
    season_id: 136,
    place: 1,
    value: 6400,
    unit: "points",
    as_of: AS_OF,
  });
  assert.equal(first.ref, "standing:136:points_podium:#SA");
  const attendance = facts.find((f) => f.detail.award_id === "full_attendance");
  assert.equal(attendance.detail.unit, "war_decks");
  assert.equal(attendance.detail.place, 1);
});

test("everyone on track for attendance stands, however many", () => {
  const tags = Array.from({ length: 14 }, (_, i) => `#T${i}`);
  const s = standingsFrom(result(season(136, [], { onTrack: tags })));
  assert.equal(
    [...s.facts.values()].filter((f) => f.detail.unit === "war_decks").length,
    14,
  );
});

test("a tie shares the place, and a tie for first names no previous leader", () => {
  const day1 = standingsFrom(
    result(
      season(136, [
        ["#SA", 1, 6400],
        ["#AJ", 2, 6000],
      ]),
    ),
  );
  const p1 = planStandings(null, day1);
  // Next morning #AJ draws level: the tie stands, both hold first.
  const day2 = standingsFrom(
    result(
      season(136, [
        ["#SA", 1, 6500],
        ["#AJ", 1, 6500],
      ]),
    ),
  );
  const p2 = planStandings(p1.next, day2);
  const aj = p2.writes.find((f) => f.player_tag === "#AJ");
  assert.equal(aj.detail.place, 1);
  assert.equal(
    "previous_player_tag" in aj.detail,
    false,
    "a tie is no lead change",
  );
  // Then #AJ pulls ahead alone: now the lead has changed hands.
  const day3 = standingsFrom(
    result(
      season(136, [
        ["#AJ", 1, 6900],
        ["#SA", 2, 6600],
      ]),
    ),
  );
  const p3 = planStandings(p2.next, day3);
  // #AJ's place did not move (first, tied, then first alone): nothing to
  // write for them, and #SA moving to second is written without a name.
  assert.ok(
    p3.writes.some((f) => f.player_tag === "#SA" && f.detail.place === 2),
  );
});

test("the plan writes only what moved, names the previous leader, and takes back what is no longer held", () => {
  const day1 = standingsFrom(
    result(
      season(136, [
        ["#SA", 1, 6400],
        ["#AJ", 2, 5850],
        ["#DZ", 3, 5450],
      ]),
    ),
  );
  const p1 = planStandings(null, day1);
  assert.equal(p1.writes.length, 4, "everything, the first time");
  assert.deepEqual(p1.removes, []);
  // Next morning: points moved, places did not. Nothing to write.
  const day2 = standingsFrom(
    result(
      season(136, [
        ["#SA", 1, 6500],
        ["#AJ", 2, 6000],
        ["#DZ", 3, 5500],
      ]),
    ),
  );
  const p2 = planStandings(p1.next, day2);
  assert.deepEqual(p2.writes, []);
  assert.deepEqual(p2.removes, []);
  // Then #AJ takes the lead and #DZ drops off the podium for #SS.
  const day3 = standingsFrom(
    result(
      season(136, [
        ["#AJ", 1, 6900],
        ["#SA", 2, 6800],
        ["#SS", 3, 5900],
        ["#DZ", 4, 5800],
      ]),
    ),
  );
  const p3 = planStandings(p2.next, day3);
  const lead = p3.writes.find((f) => f.detail.place === 1);
  assert.equal(lead.player_tag, "#AJ");
  assert.equal(
    lead.detail.previous_player_tag,
    "#SA",
    "a lead change says who held it",
  );
  assert.ok(
    p3.writes.some((f) => f.player_tag === "#SA" && f.detail.place === 2),
  );
  assert.ok(
    p3.writes.some((f) => f.player_tag === "#SS" && f.detail.place === 3),
  );
  assert.ok(
    !p3.writes.some(
      (f) => f.detail.place !== 1 && "previous_player_tag" in f.detail,
    ),
    "only first place names who held it",
  );
  assert.deepEqual(p3.removes, ["standing:136:points_podium:#DZ"]);
});

test("a closed season's final places stay up until the next season closes", () => {
  const live = standingsFrom(
    result(
      season(136, [
        ["#AJ", 1, 6900],
        ["#SA", 2, 6800],
      ]),
    ),
  );
  const p1 = planStandings(null, live);
  // The season closes and the next begins: 136's final places stand
  // (unchanged places write nothing), 137's first standings are written.
  const rolled = standingsFrom(
    result(
      season(
        136,
        [
          ["#AJ", 1, 7000],
          ["#SA", 2, 6900],
        ],
        { closed: true },
      ),
      season(137, [["#DZ", 1, 300]], { onTrack: [] }),
    ),
  );
  const p2 = planStandings(p1.next, rolled);
  assert.deepEqual(p2.removes, [], "the final places are not taken back");
  const first137 = p2.writes.find((f) => f.detail.season_id === 137);
  assert.equal(first137.player_tag, "#DZ");
  assert.equal(
    "previous_player_tag" in first137.detail,
    false,
    "a new season's first leader never names last season's",
  );
  // When 137 closes too, 136's standings are taken back.
  const later = standingsFrom(
    result(
      season(136, [["#AJ", 1, 7000]], { closed: true }),
      season(137, [["#DZ", 1, 7100]], { closed: true, onTrack: [] }),
    ),
  );
  const p3 = planStandings(p2.next, later);
  assert.ok(p3.removes.every((r) => r.startsWith("standing:136:")));
  assert.ok(p3.removes.length >= 2);
});

test("an attendance award has no leader: a member getting on track never names a previous one", () => {
  const p1 = planStandings(
    null,
    standingsFrom(result(season(136, [["#SA", 1, 6400]]))),
  );
  const p2 = planStandings(
    p1.next,
    standingsFrom(
      result(season(136, [["#SA", 1, 6500]], { onTrack: ["#MG", "#FB"] })),
    ),
  );
  const fb = p2.writes.find((f) => f.player_tag === "#FB");
  assert.ok(fb);
  assert.equal("previous_player_tag" in fb.detail, false);
});

test("a renamed award rewrites its standings", () => {
  const p1 = planStandings(
    null,
    standingsFrom(result(season(136, [["#SA", 1, 6400]]))),
  );
  const renamed = result(season(136, [["#SA", 1, 6400]]));
  renamed.seasons[0].awards[0].name = "Season Points";
  const p2 = planStandings(p1.next, standingsFrom(renamed));
  assert.ok(p2.writes.some((f) => f.detail.award === "Season Points"));
});

test("before a season's first week finishes, attendance has asked nothing and shares nothing", () => {
  const early = result(season(137, [["#SA", 1, 400]], { onTrack: ["#MG"] }));
  early.seasons[0].awards[1].rows[0].decks_asked = 0;
  const s = standingsFrom(early);
  assert.equal(
    [...s.facts.values()].filter((f) => f.detail.unit === "war_decks").length,
    0,
  );
});
