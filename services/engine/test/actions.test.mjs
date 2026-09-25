import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTION_TYPES,
  audienceOf,
  awayCandidates,
  canAct,
  priorActions,
  reconstructedLog,
  welcomesFrom,
} from "../src/actions.mjs";
import { evaluate } from "../src/evaluate.mjs";
import { member, participation, NOW, EXAMPLE_POLICY } from "./fixture.mjs";

const DAY = 86400_000;
const leader = { player_tag: "#L", role: "leader" };
const co = { player_tag: "#C", role: "coLeader" };
const elder = { player_tag: "#E", role: "elder" };
const plain = { player_tag: "#M", role: "member" };

test("who may take an action: leaders' for leadership, elders' for elders and up, a member's for that member alone", () => {
  const removal = { type: "removal", player_tag: "#M" };
  assert.deepEqual(audienceOf(removal), { kind: "leaders" });
  assert.deepEqual(
    [leader, co, elder, plain].map((w) => canAct(removal, w)),
    [true, true, false, false],
  );
  const welcome = { type: "welcome", player_tag: "#NEW" };
  assert.deepEqual(
    [leader, co, elder, plain].map((w) => canAct(welcome, w)),
    [true, true, true, false],
  );
  const away = { type: "away", player_tag: "#M" };
  assert.deepEqual(audienceOf(away), { kind: "member", player_tag: "#M" });
  assert.deepEqual(
    [leader, co, elder, plain].map((w) => canAct(away, w)),
    [false, false, false, true],
  );
  for (const t of Object.keys(ACTION_TYPES))
    assert.ok(ACTION_TYPES[t].label && !/card/i.test(ACTION_TYPES[t].label));
});

test("a newcomer is welcomed once per join, only while still here and only for a few days", () => {
  const at = (days) => new Date(NOW.getTime() - days * DAY).toISOString();
  const events = [
    {
      type: "member_joined",
      at: at(1),
      detail: { player_tag: "#NEW", name: "New" },
    },
    {
      type: "member_joined",
      at: at(5),
      detail: { player_tag: "#OLD", name: "Old" },
    },
    {
      type: "member_joined",
      at: at(1),
      detail: { player_tag: "#GONE", name: "Gone" },
    },
    { type: "member_left", at: at(1), detail: { player_tag: "#X" } },
  ];
  const here = new Set(["#NEW", "#OLD"]);
  assert.deepEqual(
    welcomesFrom(events, [], here, NOW).map((w) => w.player_tag),
    ["#NEW"],
  );
  const already = [
    { type: "welcome", player_tag: "#NEW", evidence: { joined_at: at(1) } },
  ];
  assert.deepEqual(welcomesFrom(events, already, here, NOW), []);
});

test("a member or elder at risk is asked about away; leadership and held members are not", () => {
  const others = Array.from({ length: 8 }, (_, i) => member(`#O${i}`));
  const quiet = (tag, role) =>
    member(tag, { role, lastBattleDaysAgo: 6, war: [0, 0, 0, 0, 0, 0] });
  const v = evaluate({
    participation: participation([
      ...others,
      quiet("#M1", "member"),
      quiet("#E1", "elder"),
      quiet("#C1", "coLeader"),
      quiet("#H1", "member"),
    ]),
    policy: EXAMPLE_POLICY,
    now: NOW,
    holds: [{ player_tag: "#H1", until: null }],
  });
  assert.deepEqual(
    awayCandidates(v)
      .map((m) => m.player_tag)
      .sort(),
    ["#E1", "#M1"],
  );
});

test("an action from before logs is reconstructed from its own fields; earlier actions are listed newest first", () => {
  const card = {
    type: "promotion",
    status: "declined",
    raised_at: "2026-09-01T00:00:00Z",
    decided_at: "2026-09-02T00:00:00Z",
    decided_by: "#L",
    decline_reason: "not_now",
    policy_version: 2,
    evidence: {
      rationale: { headline: "In the promotable set on 3 reviews." },
    },
  };
  assert.deepEqual(
    reconstructedLog(card).map((e) => [e.kind, e.detail.reconstructed]),
    [
      ["raised", true],
      ["declined", true],
    ],
  );
  const cards = [
    { ...card, card_id: "a", player_tag: "#M" },
    {
      ...card,
      card_id: "b",
      player_tag: "#M",
      raised_at: "2026-09-05T00:00:00Z",
      status: "withdrawn",
      withdrawn_at: "2026-09-06T00:00:00Z",
      withdraw_reason: "The role changed.",
    },
    { ...card, card_id: "c", player_tag: "#OTHER" },
  ];
  assert.deepEqual(
    priorActions(cards, {
      player_tag: "#M",
      type: "promotion",
      before: "2026-09-10",
    }).map((p) => [p.card_id, p.status, p.reason]),
    [
      ["b", "withdrawn", "The role changed."],
      ["a", "declined", "not_now"],
    ],
  );
});
