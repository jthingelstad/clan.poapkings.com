import { test } from "node:test";
import assert from "node:assert/strict";
import { roleLabel, roleRank } from "../src/roles.mjs";

test("role labels: the API's coLeader is the UI's Co-leader", () => {
  assert.equal(roleLabel("leader"), "Leader");
  assert.equal(roleLabel("coLeader"), "Co-leader");
  assert.equal(roleLabel("elder"), "Elder");
  assert.equal(roleLabel("member"), "Member");
});

test("role labels: an unknown role is shown as itself, never invented", () => {
  assert.equal(roleLabel("admin"), "admin");
  assert.equal(roleLabel(null), "Member");
});

test("role rank orders leadership first", () => {
  const roles = ["member", "leader", "elder", "coLeader", "weird"];
  assert.deepEqual(
    roles.sort((a, b) => roleRank(a) - roleRank(b)),
    ["leader", "coLeader", "elder", "member", "weird"],
  );
});
