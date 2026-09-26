/**
 * Award standings to Elixir (manage/standings.mjs), pure: the running
 * season's podium places and on-track members as facts, and the plan
 * that writes only what moved, names the previous leader when first place
 * changes hands, and takes back what is no longer held.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { planStandings, standingsFrom } from "../src/manage/standings.mjs";

const AS_OF = "2026-09-26T11:00:00.000Z";
const podium = (rows) =>
  rows.map(([tag, rank, points]) => ({
    player_tag: tag,
    name: tag,
    official_rank: rank,
    points,
    on_podium: rank <= 3,
  }));
const result = (champRows, { closed = false } = {}) => ({
  as_of: AS_OF,
  seasons: [
    {
      season_id: 136,
      closed,
      complete: true,
      awards: [
        {
          award_id: "war_champ",
          kind: "season_points_podium",
          name: "War Champ",
          computed: true,
          state: closed ? "closed" : "live",
          rows: podium(champRows),
        },
        {
          award_id: "iron_king",
          kind: "perfect_attendance",
          name: "Iron King",
          computed: true,
          state: closed ? "closed" : "live",
          rows: [
            {
              player_tag: "#MG",
              name: "Mega",
              decks_asked: 36,
              decks_short: 0,
            },
          ],
        },
        {
          award_id: "free_pass",
          kind: "leaders_pick",
          name: "Free Pass",
          computed: false,
          state: "manual",
          rows: [],
        },
      ],
    },
  ],
});

test("the running season's podium and on-track members become facts; a pick and a closed season do not", () => {
  const s = standingsFrom(
    result([
      ["#SA", 1, 6400],
      ["#AJ", 2, 5850],
      ["#DZ", 3, 5450],
      ["#SS", 4, 5200],
    ]),
  );
  assert.equal(s.season_id, 136);
  const facts = [...s.facts.values()];
  assert.equal(facts.length, 4, "three on the podium, one on track, no pick");
  const first = facts.find(
    (f) => f.detail.award_id === "war_champ" && f.detail.place === 1,
  );
  assert.deepEqual(first.detail, {
    award: "War Champ",
    award_id: "war_champ",
    season_id: 136,
    place: 1,
    value: 6400,
    unit: "points",
    as_of: AS_OF,
  });
  assert.equal(first.ref, "standing:136:war_champ:#SA");
  const iron = facts.find((f) => f.detail.award_id === "iron_king");
  assert.equal(iron.detail.unit, "war_decks");
  assert.equal(iron.detail.place, 1);
  assert.equal(
    standingsFrom(result([["#SA", 1, 6400]], { closed: true })).facts.size,
    0,
  );
});

test("the plan writes only what moved, names the previous leader, and takes back what is no longer held", () => {
  const day1 = standingsFrom(
    result([
      ["#SA", 1, 6400],
      ["#AJ", 2, 5850],
      ["#DZ", 3, 5450],
    ]),
  );
  const p1 = planStandings(null, day1);
  assert.equal(p1.writes.length, 4, "everything, the first time");
  assert.deepEqual(p1.removes, []);
  // Next morning: points moved, places did not. Nothing to write.
  const day2 = standingsFrom(
    result([
      ["#SA", 1, 6500],
      ["#AJ", 2, 6000],
      ["#DZ", 3, 5500],
    ]),
  );
  const p2 = planStandings(p1.next, day2);
  assert.deepEqual(p2.writes, []);
  assert.deepEqual(p2.removes, []);
  // Then Aaqib takes the lead and dez42 drops off the podium for sikander.
  const day3 = standingsFrom(
    result([
      ["#AJ", 1, 6900],
      ["#SA", 2, 6800],
      ["#SS", 3, 5900],
      ["#DZ", 4, 5800],
    ]),
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
  assert.deepEqual(p3.removes, ["standing:136:war_champ:#DZ"]);
  // The season closes: every standing is taken back (the grants say it now).
  const closed = standingsFrom(result([["#AJ", 1, 7000]], { closed: true }));
  const p4 = planStandings(p3.next, closed);
  assert.deepEqual(p4.writes, []);
  assert.equal(p4.removes.length, 4);
});

test("an attendance award has no leader: a member getting on track never names a previous one", () => {
  const withOne = standingsFrom(result([["#SA", 1, 6400]]));
  const p1 = planStandings(null, withOne);
  const two = result([["#SA", 1, 6500]]);
  two.seasons[0].awards[1].rows.push({
    player_tag: "#FB",
    name: "Fullboat",
    decks_asked: 36,
    decks_short: 0,
  });
  const p2 = planStandings(p1.next, standingsFrom(two));
  const fb = p2.writes.find((f) => f.player_tag === "#FB");
  assert.ok(fb);
  assert.equal("previous_player_tag" in fb.detail, false);
});
