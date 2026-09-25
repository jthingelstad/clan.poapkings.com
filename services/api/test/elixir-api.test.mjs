import { test } from "node:test";
import assert from "node:assert/strict";
import { createElixirApiClient } from "../src/elixir-api.mjs";

/** A fetch that records requests and answers from a table. */
function fakeFetch(answers) {
  const seen = [];
  const fn = async (url, init) => {
    seen.push({
      url,
      method: init.method,
      auth: init.headers.authorization,
      body: init.body,
    });
    const { status = 200, body } = answers(url, init) ?? {
      status: 404,
      body: { code: "not_found" },
    };
    return new Response(JSON.stringify(body), { status });
  };
  return { fn, seen };
}

test("the /api/v1 client keeps the MCP client's interface: initialize reads /me, a tool name maps to one operation", async () => {
  const { fn, seen } = fakeFetch((url) => {
    if (url.endsWith("/api/v1/me"))
      return {
        body: {
          data: {
            principal: { kind: "person", subject: { tag: "#AA" } },
            players: [{ player_tag: "#AA" }],
          },
          request_id: "r1",
        },
      };
    if (url.includes("/api/v1/clans/%232PQRJ8LV/participation?weeks=8"))
      return { body: { data: { members: [], weeks: [] }, request_id: "r2" } };
    return undefined;
  });
  const api = createElixirApiClient({
    url: "https://elixir.example",
    fetch: fn,
  });
  const init = await api.initialize("eat_x");
  assert.equal(init.ok, true);
  assert.equal(init.principal.kind, "person");
  const mine = await api.callTool("eat_x", "elixir_my_players", {});
  assert.deepEqual(mine.body.players, [{ player_tag: "#AA" }]);
  assert.ok(mine.body.meta.as_of);
  const part = await api.callTool("eat_x", "clans_participation", {
    clan_tag: "#2PQRJ8LV",
    weeks: 8,
  });
  assert.equal(part.ok, true);
  assert.deepEqual(part.body, { members: [], weeks: [] });
  assert.ok(seen.every((s) => s.auth === "Bearer eat_x"));
});

test("a problem is unwrapped to the tool's code, hint and retry_after_s; a 401 keeps its status", async () => {
  const { fn, seen } = fakeFetch((url) => {
    if (url.includes("/players/%23AA/profile?fresh=1"))
      return {
        status: 503,
        body: {
          code: "live_pending",
          detail: "queued",
          hint: "retry",
          retry_after_s: 12,
        },
      };
    if (url.includes("/clans/%23BB/roster"))
      return { status: 404, body: { code: "not_recorded", detail: "no" } };
    if (url.includes("/players/names"))
      return { status: 401, body: { code: "unauthenticated" } };
    return undefined;
  });
  const api = createElixirApiClient({
    url: "https://elixir.example",
    fetch: fn,
  });
  const live = await api.callTool("t", "players_profile", {
    player_tag: "#AA",
    live: true,
  });
  assert.equal(live.ok, false);
  assert.equal(live.code, "live_pending");
  assert.equal(live.body.error.retry_after_s, 12);
  assert.equal(live.hint, "retry");
  const roster = await api.callTool("t", "clans_roster", { clan_tag: "#BB" });
  assert.equal(roster.code, "not_recorded");
  const names = await api.callTool("t", "players_names", {
    player_tags: ["#AA"],
  });
  assert.equal(names.status, 401);
  assert.equal(JSON.parse(seen.at(-1).body).player_tags[0], "#AA");
  // live_fetch's one path maps to the clan live read.
  await api.callTool("t", "live_fetch", { path: "/clans/%23CC" });
  assert.ok(seen.at(-1).url.endsWith("/api/v1/clans/%23CC/live"));
  const none = await api.callTool("t", "battles_compare", {});
  assert.equal(none.ok, false);
});
