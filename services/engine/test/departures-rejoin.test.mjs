import { test } from "node:test";
import assert from "node:assert/strict";
import { departuresFrom } from "../src/departures.mjs";

const left = (tag, at) => ({
  type: "member_left",
  at,
  detail: { player_tag: tag, name: tag, role_at_departure: "member" },
});
const joined = (tag, at) => ({
  type: "member_joined",
  at,
  detail: { player_tag: tag, name: tag },
});

test("a member who left and came back raises no departure card", () => {
  const events = [
    joined("#A", "2026-09-23T20:38:09Z"),
    left("#A", "2026-09-23T20:58:06Z"),
    joined("#A", "2026-09-23T22:23:11Z"),
    left("#B", "2026-09-23T21:00:00Z"),
  ];
  const out = departuresFrom(events, [], new Map());
  assert.deepEqual(
    out.map((d) => d.player_tag),
    ["#B"],
    "the rejoin undoes #A's leave; #B stays gone",
  );
});

test("a member on the current roster raises no departure card even without a join event", () => {
  const out = departuresFrom(
    [left("#C", "2026-09-20T10:00:00Z")],
    [],
    new Map(),
    new Set(["#C"]),
  );
  assert.equal(out.length, 0);
});
