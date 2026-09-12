import { test } from "node:test";
import assert from "node:assert/strict";
import { clansOf, normalizeTag, runGate } from "../src/gate.mjs";
import { fakeMcp, PERSON, player } from "./fakes.mjs";

test("gate: an agent grant is refused first, before any tool call", async () => {
  const mcp = fakeMcp({
    principal: { kind: "agent", subject: { type: "clan", tag: "#J2RGCRVG" } },
  });
  const g = await runGate({ mcp, token: "t" });
  assert.equal(g.ok, false);
  assert.equal(g.reason, "not_a_person");
  assert.deepEqual(
    mcp.calls.map((c) => c[0]),
    ["initialize"],
  );
});

test("gate: no principal block reads as not a person", async () => {
  const mcp = fakeMcp({ principal: null });
  const g = await runGate({ mcp, token: "t" });
  assert.equal(g.reason, "not_a_person");
});

test("gate: a person with no players at all", async () => {
  const mcp = fakeMcp({ players: [] });
  const g = await runGate({ mcp, token: "t" });
  assert.equal(g.reason, "no_primary_player");
  assert.equal(g.principal.kind, "person");
});

test("gate: no verified claim is refused before the clan check, with the players listed", async () => {
  const mcp = fakeMcp({
    players: [
      player({ claim_status: "unverified", clan_tag: null, clan_role: null }),
    ],
  });
  const g = await runGate({ mcp, token: "t" });
  assert.equal(g.reason, "unverified");
  assert.equal(g.identities[0].player_tag, "#20JJJ2CCRU");
});

test("gate: a verified primary not in a clan", async () => {
  const mcp = fakeMcp({
    players: [player({ clan_tag: null, clan_role: null })],
  });
  const g = await runGate({ mcp, token: "t" });
  assert.equal(g.reason, "no_clan");
});

test("gate: the happy path names the clan set and the role", async () => {
  const mcp = fakeMcp();
  const g = await runGate({ mcp, token: "t" });
  assert.equal(g.ok, true);
  assert.equal(g.clans.length, 1);
  assert.equal(g.clans[0].clan_tag, "#J2RGCRVG");
  assert.equal(g.clans[0].name, "POAP KINGS");
  assert.equal(g.clans[0].role, "leader");
  assert.equal(g.clans[0].role_label, "Leader");
  assert.equal(g.clans[0].acting_as, "#20JJJ2CCRU");
  assert.equal(g.primary.player_tag, "#20JJJ2CCRU");
  assert.equal(g.principal.subject.name, "King Thing");
});

test("gate: a verified alt in another clan adds a second clan; the primary's comes first", async () => {
  const mcp = fakeMcp({
    principal: { ...PERSON, clan: { tag: "#PYLQ2", name: "Elsewhere" } },
    players: [
      player(),
      player({
        player_tag: "#8QCV",
        name: "Big Thing",
        is_primary: false,
        relationship: "alt",
        clan_tag: "#PYLQ2",
        clan_role: "member",
      }),
    ],
  });
  const g = await runGate({ mcp, token: "t" });
  assert.deepEqual(
    g.clans.map((c) => c.clan_tag),
    ["#J2RGCRVG", "#PYLQ2"],
  );
  assert.equal(g.clans[0].name, null);
  assert.equal(g.clans[1].name, "Elsewhere");
  assert.equal(g.clans[1].acting_as, "#8QCV");
  assert.equal(g.clans[1].role_label, "Member");
});

test("gate: an UNVERIFIED alt never adds a clan, but is listed so the chooser can say why", async () => {
  const mcp = fakeMcp({
    players: [
      player(),
      player({
        player_tag: "#8QCV",
        is_primary: false,
        relationship: "alt",
        claim_status: "unverified",
        clan_tag: "#PYLQ2",
        clan_role: "member",
      }),
    ],
  });
  const g = await runGate({ mcp, token: "t" });
  assert.equal(g.clans.length, 1);
  assert.equal(g.identities.length, 2);
  assert.equal(g.identities[1].claim_status, "unverified");
});

test("gate: two verified tags in one clan are one clan, acting as the higher role, both yours", async () => {
  const mcp = fakeMcp({
    players: [
      player({ clan_role: "member" }),
      player({
        player_tag: "#8QCV",
        is_primary: false,
        relationship: "alt",
        clan_role: "coLeader",
      }),
    ],
  });
  const g = await runGate({ mcp, token: "t" });
  assert.equal(g.clans.length, 1);
  assert.equal(g.clans[0].acting_as, "#8QCV");
  assert.equal(g.clans[0].role, "coLeader");
  assert.deepEqual(g.clans[0].your_tags.sort(), ["#20JJJ2CCRU", "#8QCV"]);
});

test("gate: an alt-only account with a verified alt in a clan passes; the alt keys the preference", async () => {
  const mcp = fakeMcp({
    players: [
      player({ player_tag: "#8QCV", is_primary: false, relationship: "alt" }),
    ],
  });
  const g = await runGate({ mcp, token: "t" });
  assert.equal(g.ok, true);
  assert.equal(g.primary.player_tag, "#8QCV");
});

test("gate: an unverified primary with a verified alt in a clan still passes", async () => {
  const mcp = fakeMcp({
    players: [
      player({ claim_status: "unverified" }),
      player({
        player_tag: "#8QCV",
        is_primary: false,
        relationship: "alt",
        clan_tag: "#PYLQ2",
        clan_role: "elder",
      }),
    ],
  });
  const g = await runGate({ mcp, token: "t" });
  assert.equal(g.ok, true);
  assert.deepEqual(
    g.clans.map((c) => c.clan_tag),
    ["#PYLQ2"],
  );
});

test("gate: a door failure is an error, not a refusal", async () => {
  const mcp = fakeMcp();
  mcp.state.refuse = true;
  const g = await runGate({ mcp, token: "t" });
  assert.equal(g.ok, false);
  assert.equal(g.reason, undefined);
  assert.equal(g.status, 401);
});

test("clansOf: friends and watching never make a clan, even if the row says verified", () => {
  const clans = clansOf(
    [
      {
        player_tag: "#A",
        claim_status: "verified",
        relationship: "friend",
        clan_tag: "#X",
        role: "leader",
      },
      {
        player_tag: "#B",
        claim_status: "unverified",
        relationship: "alt",
        clan_tag: "#Y",
        role: "leader",
      },
    ],
    null,
  );
  // A verified friend cannot exist (Verify only proves primary/alts), and
  // the set refuses it anyway: only you and your alts act here.
  assert.deepEqual(clans, []);
});

test("normalizeTag: case, missing #, O-for-0, and refusal of a non-tag", () => {
  assert.equal(normalizeTag("pylq2"), "#PYLQ2");
  assert.equal(normalizeTag("#J2RGCRVG"), "#J2RGCRVG");
  assert.equal(normalizeTag("j2rgcrvg"), "#J2RGCRVG");
  assert.equal(normalizeTag("OTHER"), null);
  assert.equal(normalizeTag(""), null);
});
