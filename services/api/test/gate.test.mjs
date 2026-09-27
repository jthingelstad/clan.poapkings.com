import { test } from "node:test";
import assert from "node:assert/strict";
import { clansOf, normalizeTag, runGate, verifyNotice } from "../src/gate.mjs";
import { fakeMcp, PERSON, player } from "./fakes.mjs";

test("gate: an agent grant is refused first, before any tool call", async () => {
  const mcp = fakeMcp({
    principal: { kind: "agent", subject: { type: "clan", tag: "#2PQRJ8LV" } },
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

test("gate: an unverified player not in a clan is refused at the clan check, with the players listed", async () => {
  const mcp = fakeMcp({
    players: [
      player({ claim_status: "unverified", clan_tag: null, clan_role: null }),
    ],
  });
  const g = await runGate({ mcp, token: "t" });
  assert.equal(g.reason, "no_clan");
  assert.equal(g.identities[0].player_tag, "#20QQL8CCRU");
});

test("gate: an account that only follows friends has no player of its own", async () => {
  const mcp = fakeMcp({
    players: [
      player({ relationship: "friend", is_primary: false }),
      player({
        player_tag: "#8QCV",
        relationship: "watching",
        is_primary: false,
      }),
    ],
  });
  const g = await runGate({ mcp, token: "t" });
  assert.equal(g.reason, "no_primary_player");
});

test("gate: an UNVERIFIED Leader passes as a member, and what verifying would unlock is named", async () => {
  const mcp = fakeMcp({ players: [player({ claim_status: "unverified" })] });
  const g = await runGate({ mcp, token: "t" });
  assert.equal(g.ok, true);
  assert.equal(g.primary.player_tag, "#20QQL8CCRU");
  const [c] = g.clans;
  assert.equal(c.clan_tag, "#2PQRJ8LV");
  assert.equal(c.acting_as, "#20QQL8CCRU");
  assert.equal(c.role, "member");
  assert.equal(c.role_label, "Member");
  assert.equal(c.verified, false);
  assert.deepEqual(c.unlock, {
    player_tag: "#20QQL8CCRU",
    name: "Ada",
    role: "leader",
    role_label: "Leader",
  });
  assert.deepEqual(verifyNotice(g), {
    key: "#2PQRJ8LV:#20QQL8CCRU:leader",
    clans: [
      {
        clan_tag: "#2PQRJ8LV",
        clan_name: "Example Clan",
        player_tag: "#20QQL8CCRU",
        player_name: "Ada",
        role: "leader",
        role_label: "Leader",
      },
    ],
  });
});

test("gate: an unverified member has nothing to unlock, so no notice", async () => {
  const mcp = fakeMcp({
    players: [player({ claim_status: "unverified", clan_role: "member" })],
  });
  const g = await runGate({ mcp, token: "t" });
  assert.equal(g.clans[0].verified, false);
  assert.equal(g.clans[0].unlock, null);
  assert.equal(verifyNotice(g), null);
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
  assert.equal(g.clans[0].clan_tag, "#2PQRJ8LV");
  assert.equal(g.clans[0].name, "Example Clan");
  assert.equal(g.clans[0].role, "leader");
  assert.equal(g.clans[0].role_label, "Leader");
  assert.equal(g.clans[0].acting_as, "#20QQL8CCRU");
  assert.equal(g.primary.player_tag, "#20QQL8CCRU");
  assert.equal(g.principal.subject.name, "Ada");
});

test("gate: a verified alt in another clan adds a second clan; the primary's comes first", async () => {
  const mcp = fakeMcp({
    principal: { ...PERSON, clan: { tag: "#PYLQ2", name: "Elsewhere" } },
    players: [
      player(),
      player({
        player_tag: "#8QCV",
        name: "Ada's other",
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
    ["#2PQRJ8LV", "#PYLQ2"],
  );
  assert.equal(g.clans[0].name, null);
  assert.equal(g.clans[1].name, "Elsewhere");
  assert.equal(g.clans[1].acting_as, "#8QCV");
  assert.equal(g.clans[1].role_label, "Member");
});

test("gate: an UNVERIFIED alt adds its clan as a member's", async () => {
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
  assert.deepEqual(
    g.clans.map((c) => [c.clan_tag, c.role, c.verified]),
    [
      ["#2PQRJ8LV", "leader", true],
      ["#PYLQ2", "member", false],
    ],
  );
  assert.equal(g.identities[1].claim_status, "unverified");
  // Nothing more to unlock: the alt is a member in the game too.
  assert.equal(verifyNotice(g), null);
});

test("gate: a verified member tag and an unverified Co-leader tag in one clan act as the verified one, and name the other to verify", async () => {
  const mcp = fakeMcp({
    players: [
      player({ clan_role: "member" }),
      player({
        player_tag: "#8QCV",
        name: "Ada's other",
        is_primary: false,
        relationship: "alt",
        claim_status: "unverified",
        clan_role: "coLeader",
      }),
    ],
  });
  const g = await runGate({ mcp, token: "t" });
  assert.equal(g.clans.length, 1);
  const [c] = g.clans;
  assert.equal(c.acting_as, "#20QQL8CCRU");
  assert.equal(c.role, "member");
  assert.equal(c.verified, true);
  assert.equal(c.unlock.player_tag, "#8QCV");
  assert.equal(c.unlock.role, "coLeader");
  assert.deepEqual(c.your_tags.sort(), ["#20QQL8CCRU", "#8QCV"]);
});

test("gate: a verified Elder tag is not outranked by an unverified Elder tag in the same clan", async () => {
  const mcp = fakeMcp({
    players: [
      player({ clan_role: "elder" }),
      player({
        player_tag: "#8QCV",
        is_primary: false,
        relationship: "alt",
        claim_status: "unverified",
        clan_role: "elder",
      }),
    ],
  });
  const g = await runGate({ mcp, token: "t" });
  assert.equal(g.clans[0].role, "elder");
  assert.equal(g.clans[0].verified, true);
  assert.equal(g.clans[0].unlock, null);
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
  assert.deepEqual(g.clans[0].your_tags.sort(), ["#20QQL8CCRU", "#8QCV"]);
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
  // The primary's clan first, as a member until it is verified.
  assert.deepEqual(
    g.clans.map((c) => [c.clan_tag, c.role, c.verified]),
    [
      ["#2PQRJ8LV", "member", false],
      ["#PYLQ2", "elder", true],
    ],
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

test("clansOf: friends and watching never make a clan, even if the row says verified; an unverified alt is a member", () => {
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
  assert.deepEqual(
    clans.map((c) => [c.clan_tag, c.acting_as, c.role, c.unlock?.role]),
    [["#Y", "#B", "member", "leader"]],
  );
});

test("normalizeTag: case, missing #, O-for-0, and refusal of a non-tag", () => {
  assert.equal(normalizeTag("pylq2"), "#PYLQ2");
  assert.equal(normalizeTag("#2PQRJ8LV"), "#2PQRJ8LV");
  assert.equal(normalizeTag("2pqrj8lv"), "#2PQRJ8LV");
  assert.equal(normalizeTag("OTHER"), null);
  assert.equal(normalizeTag(""), null);
});
