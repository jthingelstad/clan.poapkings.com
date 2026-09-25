import { test } from "node:test";
import assert from "node:assert/strict";
import { memberWeeks } from "../src/member.mjs";
import { member, participation, NOW } from "./fixture.mjs";

test("a member's own weeks: this week so far, the open war week, decks asked on closed weeks, time here", () => {
  const p = participation([
    member("#A", { name: "Ada", tenureDays: 40 }),
    member("#B"),
  ]);
  const roster = {
    members: [{ player_tag: "#A", trophies: 9100 }],
    recent_events: [
      {
        type: "role_changed",
        at: "2026-09-01T00:00:00Z",
        detail: {
          player_tag: "#A",
          role_before: "member",
          role_after: "elder",
        },
      },
      {
        type: "role_changed",
        at: "2026-09-02T00:00:00Z",
        detail: {
          player_tag: "#B",
          role_before: "member",
          role_after: "elder",
        },
      },
    ],
  };
  const y = memberWeeks(p, "#A", roster, NOW);
  assert.equal(y.name, "Ada");
  assert.equal(y.trophies, 9100);
  assert.equal(y.this_week.complete, false);
  assert.equal(y.this_week.battles, 10);
  assert.equal(y.this_war_week.open, true);
  assert.equal(
    y.this_war_week.decks_asked,
    null,
    "an open week asks nothing yet",
  );
  assert.ok(
    y.war_weeks.filter((w) => !w.open).every((w) => w.decks_asked === 16),
  );
  assert.equal(y.time_here.days, 40);
  assert.deepEqual(
    y.time_here.events.map((e) => e.role_after),
    ["elder"],
    "only this member's events",
  );
  assert.equal(memberWeeks(p, "#NOBODY", roster, NOW), null);
});
