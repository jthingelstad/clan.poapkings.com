import { test } from "node:test";
import assert from "node:assert/strict";
import { runGate } from "../src/gate.mjs";
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

test("gate: a person with no primary player", async () => {
  const mcp = fakeMcp({
    players: [player({ is_primary: false, relationship: "alt" })],
  });
  const g = await runGate({ mcp, token: "t" });
  assert.equal(g.reason, "no_primary_player");
  assert.equal(g.principal.kind, "person");
});

test("gate: an unverified primary is refused before the clan check", async () => {
  const mcp = fakeMcp({
    players: [
      player({ claim_status: "unverified", clan_tag: null, clan_role: null }),
    ],
  });
  const g = await runGate({ mcp, token: "t" });
  assert.equal(g.reason, "unverified");
  assert.equal(g.player.player_tag, "#20JJJ2CCRU");
});

test("gate: a verified primary not in a clan", async () => {
  const mcp = fakeMcp({
    players: [player({ clan_tag: null, clan_role: null })],
  });
  const g = await runGate({ mcp, token: "t" });
  assert.equal(g.reason, "no_clan");
});

test("gate: the happy path names the clan and the role", async () => {
  const mcp = fakeMcp();
  const g = await runGate({ mcp, token: "t" });
  assert.equal(g.ok, true);
  assert.equal(g.clan.clan_tag, "#J2RGCRVG");
  assert.equal(g.clan.name, "POAP KINGS");
  assert.equal(g.player.role, "leader");
  assert.equal(g.player.role_label, "Leader");
  assert.equal(g.principal.subject.name, "King Thing");
});

test("gate: the primary's clan wins over an alt's, whatever the principal block says", async () => {
  const mcp = fakeMcp({
    principal: { ...PERSON, clan: { tag: "#OTHER", name: "Elsewhere" } },
    players: [
      player(),
      player({
        player_tag: "#ALT",
        is_primary: false,
        relationship: "alt",
        clan_tag: "#OTHER",
      }),
    ],
  });
  const g = await runGate({ mcp, token: "t" });
  assert.equal(g.clan.clan_tag, "#J2RGCRVG");
  assert.equal(g.clan.name, null);
});

test("gate: a door failure is an error, not a refusal", async () => {
  const mcp = fakeMcp();
  mcp.state.refuse = true;
  const g = await runGate({ mcp, token: "t" });
  assert.equal(g.ok, false);
  assert.equal(g.reason, undefined);
  assert.equal(g.status, 401);
});
