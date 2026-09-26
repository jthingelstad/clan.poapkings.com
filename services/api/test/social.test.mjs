/**
 * Social, the clan map (Jamie, 2026-09-26): a person's place from the
 * lists, one per person under each verified tag; the clan's members see
 * each other's, names beside pins; someone off the roster is off the map;
 * a leader turns the clan's social features off; nothing leaves for Elixir.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/store.mjs";
import { createHandler } from "../src/handler.mjs";
import { createMemoryLedger } from "../src/manage/ledger.mjs";
import { createSocialService } from "../src/manage/social.mjs";
import { diskGeo } from "../src/geo.mjs";
import {
  fakeMcp,
  fakeOAuth,
  player,
  req,
  signIn,
  cookieHeader,
  rosterBody,
} from "./fakes.mjs";

const ADA = player();
const BEN = player({
  player_tag: "#8QCV",
  name: "Ben",
  clan_role: "member",
});
const rosterOf = (...members) =>
  rosterBody(
    members.map((m) => ({
      player_tag: m.player_tag,
      name: m.name,
      role: m.clan_role,
    })),
  );

function harness() {
  const clock = { t: Date.parse("2026-09-26T12:00:00Z") };
  const now = () => clock.t;
  const mcp = fakeMcp({ players: [ADA], roster: rosterOf(ADA, BEN) });
  const ledger = createMemoryLedger();
  const handler = createHandler({
    mcp,
    oauth: fakeOAuth({ now }),
    store: createMemoryStore(),
    social: createSocialService({ ledger, geo: diskGeo(), now }),
    sessionSecret: "s",
    appUrl: "https://clan.test",
    elixirUrl: "https://elixir.test",
    now,
    log: { warn() {}, error() {} },
  });
  return { clock, mcp, ledger, handler };
}

async function as(h, who) {
  h.mcp.state.players = [who];
  const { sessionCookie } = await signIn(h);
  const cookies = cookieHeader(sessionCookie);
  return async (method, path, body) => {
    const r = await h.handler(
      req(method, path, {
        cookies,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    return { status: r.statusCode, body: JSON.parse(r.body) };
  };
}

test("a member picks a place from the lists; the clan's members see it, with its time zone", async () => {
  const h = harness();
  const ada = await as(h, ADA);
  assert.deepEqual((await ada("GET", "/api/me/place")).body, { place: null });
  const set = await ada("PUT", "/api/me/place", {
    country: "US",
    region: "TX",
    city: 4671654,
  });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.place.city_name, "Austin");
  assert.equal(set.body.place.region_name, "Texas");
  assert.equal(set.body.place.tz, "America/Chicago");
  assert.equal(set.body.place.precision, "city");

  const ben = await as(h, BEN);
  const region = await ben("PUT", "/api/me/place", {
    country: "CA",
    region: "08",
  });
  assert.equal(region.status, 200, JSON.stringify(region.body));
  assert.equal(region.body.place.precision, "region");
  assert.equal(region.body.place.city, null, "no city picked, none pinned");

  const map = await ben("GET", "/api/clans/2PQRJ8LV/map");
  assert.equal(map.status, 200, JSON.stringify(map.body));
  assert.equal(map.body.members, 2);
  assert.equal(map.body.on_map, 2);
  const a = map.body.entries.find((e) => e.player_tag === ADA.player_tag);
  assert.equal(a.name, "Ada");
  assert.equal(a.you, false);
  assert.equal(a.place.city_name, "Austin");
  assert.equal(map.body.entries.find((e) => e.you).name, "Ben");
  assert.equal(map.body.yours.region_name, region.body.place.region_name);
  assert.match(map.body.attribution, /OpenStreetMap/);
  // Nothing of it goes to Elixir.
  assert.equal(h.mcp.calls.filter((c) => c[0] === "writeFact").length, 0);
});

test("a place is checked against the lists, in words a person can act on", async () => {
  const h = harness();
  const ada = await as(h, ADA);
  for (const [body, field] of [
    [{ country: "ZZ" }, "country"],
    [{ country: "US" }, "region"],
    [{ country: "US", region: "TX", city: 5128581 }, "city"],
  ]) {
    const r = await ada("PUT", "/api/me/place", body);
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "bad_place");
    assert.equal(r.body.field, field);
    assert.ok(r.body.message.length > 10);
  }
});

test("off the roster is off the map; a cleared place is gone", async () => {
  const h = harness();
  const ada = await as(h, ADA);
  const ben = await as(h, BEN);
  await ben("PUT", "/api/me/place", { country: "CA", region: "08" });
  assert.equal((await ada("GET", "/api/clans/2PQRJ8LV/map")).body.on_map, 1);
  // Ben leaves the clan: the next roster read no longer has him.
  h.mcp.state.roster = rosterOf(ADA);
  h.clock.t += 4 * 60_000;
  assert.equal((await ada("GET", "/api/clans/2PQRJ8LV/map")).body.on_map, 0);
  // Back, then he removes his place himself.
  h.mcp.state.roster = rosterOf(ADA, BEN);
  h.clock.t += 4 * 60_000;
  assert.equal((await ada("GET", "/api/clans/2PQRJ8LV/map")).body.on_map, 1);
  assert.equal((await ben("DELETE", "/api/me/place")).status, 200);
  h.clock.t += 4 * 60_000;
  assert.equal((await ada("GET", "/api/clans/2PQRJ8LV/map")).body.on_map, 0);
});

test("one place per person: written under each verified tag, shown in each of their clans", async () => {
  const h = harness();
  const alt = player({
    player_tag: "#9GQLV20",
    name: "Ada alt",
    relationship: "alt",
    is_primary: false,
    clan_tag: "#8PYLQG0",
    clan_role: "member",
  });
  h.mcp.state.players = [ADA, alt];
  const { sessionCookie } = await signIn(h);
  const r = await h.handler(
    req("PUT", "/api/me/place", {
      cookies: cookieHeader(sessionCookie),
      body: JSON.stringify({ country: "US", region: "TX" }),
    }),
  );
  assert.equal(r.statusCode, 200, r.body);
  assert.ok(h.ledger.items.has(`place#${ADA.player_tag}`));
  assert.ok(h.ledger.items.has(`place#${alt.player_tag}`));
});

test("a leader turns the clan's social features off; a member cannot; the rail hears it", async () => {
  const h = harness();
  const ben = await as(h, BEN);
  assert.equal(
    (await ben("PUT", "/api/clans/2PQRJ8LV/social", { enabled: false })).status,
    403,
  );
  const ada = await as(h, ADA);
  assert.equal((await ada("GET", "/api/me")).body.social.enabled, true);
  const off = await ada("PUT", "/api/clans/2PQRJ8LV/social", {
    enabled: false,
  });
  assert.equal(off.status, 200);
  assert.equal(off.body.enabled, false);
  assert.equal(off.body.set_by_name, "Ada");
  const map = await ben("GET", "/api/clans/2PQRJ8LV/map");
  assert.equal(map.status, 409);
  assert.equal(map.body.error, "social_off");
  assert.equal((await ada("GET", "/api/me")).body.social.enabled, false);
  // A person's own place is theirs whatever one clan decides.
  assert.equal(
    (await ben("PUT", "/api/me/place", { country: "CA", region: "08" })).status,
    200,
  );
});
