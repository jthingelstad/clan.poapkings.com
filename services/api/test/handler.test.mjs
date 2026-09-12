import { test } from "node:test";
import assert from "node:assert/strict";
import {
  harness,
  req,
  signIn,
  cookieHeader,
  fakeMcp,
  player,
  rosterBody,
} from "./fakes.mjs";
import { GATE_TTL_MS, ROSTER_TTL_MS, shapeRoster } from "../src/handler.mjs";

const HOUR = 3600_000;
const DAY = 24 * HOUR;

test("login: sets the login cookie, stores PKCE, sends the browser to Elixir with cr:read", async () => {
  const h = harness();
  const r = await h.handler(req("GET", "/auth/login"));
  assert.equal(r.statusCode, 303);
  assert.match(
    r.headers.location,
    /^https:\/\/elixir\.test\/oauth\/authorize\?state=/,
  );
  const state = new URL(r.headers.location).searchParams.get("state");
  assert.match(
    r.cookies[0],
    new RegExp(
      `^__Host-elixir_clan_login=${state}; Path=/; Secure; HttpOnly; SameSite=Lax`,
    ),
  );
  const login = h.store.items.get(`login#${state}`);
  assert.ok(login.verifier);
  assert.equal(login.redirectUri, "https://clan.test/auth/callback");
  const [, args] = h.oauth.calls[0];
  assert.equal(args.redirectUri, "https://clan.test/auth/callback");
});

test("callback: happy path exchanges with the stored verifier, runs the gate once, lands on /clan", async () => {
  const h = harness();
  const { cb, sessionCookie } = await signIn(h);
  assert.equal(cb.statusCode, 303);
  assert.equal(cb.headers.location, "https://clan.test/clan");
  assert.ok(sessionCookie);
  const exchange = h.oauth.calls.find((c) => c[0] === "exchange")[1];
  assert.equal(exchange.code, "eac_x");
  assert.equal(exchange.redirectUri, "https://clan.test/auth/callback");
  assert.ok(exchange.codeVerifier);
  assert.deepEqual(
    h.mcp.calls.map((c) => c[0]),
    ["initialize", "elixir_my_players"],
  );
  // The login item is single use.
  assert.equal(
    [...h.store.items.keys()].filter((k) => k.startsWith("login#")).length,
    0,
  );
  // /api/me answers from the gate cached at sign-in: no second spend.
  const me = await h.handler(
    req("GET", "/api/me", { cookies: cookieHeader(sessionCookie) }),
  );
  assert.equal(me.statusCode, 200);
  const body = JSON.parse(me.body);
  assert.equal(body.ok, true);
  assert.equal(body.player.role_label, "Leader");
  assert.equal(body.clan.name, "POAP KINGS");
  assert.equal(h.mcp.calls.length, 2);
});

test("callback: a state that does not match the login cookie is refused", async () => {
  const h = harness();
  const start = await h.handler(req("GET", "/auth/login"));
  const state = new URL(start.headers.location).searchParams.get("state");
  const cb = await h.handler(
    req("GET", "/auth/callback", {
      query: { code: "eac_x", state },
      cookies: { "__Host-elixir_clan_login": "other" },
    }),
  );
  assert.equal(cb.headers.location, "https://clan.test/?error=state_mismatch");
  assert.ok(
    !cb.cookies.some((c) => c.startsWith("__Host-elixir_clan_session=")),
  );
});

test("callback: an expired or replayed login is refused", async () => {
  const h = harness();
  const cb = await h.handler(
    req("GET", "/auth/callback", {
      query: { code: "eac_x", state: "gone" },
      cookies: { "__Host-elixir_clan_login": "gone" },
    }),
  );
  assert.equal(cb.headers.location, "https://clan.test/?error=login_expired");
});

test("callback: a failed exchange lands on the landing page with the reason", async () => {
  const h = harness();
  h.oauth.state.failExchange = "invalid_grant";
  const { cb, sessionCookie } = await signIn(h);
  assert.equal(cb.headers.location, "https://clan.test/?error=exchange_failed");
  assert.equal(sessionCookie, null);
});

test("callback: the refusal pages, in gate order, each with a session except the agent", async () => {
  const cases = [
    [
      {
        principal: {
          kind: "agent",
          subject: { type: "clan", tag: "#J2RGCRVG" },
        },
      },
      "not_a_person",
      false,
    ],
    [{ players: [] }, "no_primary_player", true],
    [{ players: [player({ claim_status: "unverified" })] }, "unverified", true],
    [
      { players: [player({ clan_tag: null, clan_role: null })] },
      "no_clan",
      true,
    ],
  ];
  for (const [door, reason, keepsSession] of cases) {
    const h = harness({ door });
    const { cb, sessionCookie } = await signIn(h);
    assert.equal(
      cb.headers.location,
      `https://clan.test/refused/${reason}`,
      reason,
    );
    assert.equal(Boolean(sessionCookie), keepsSession, `${reason} session`);
    if (keepsSession) {
      const me = JSON.parse(
        (
          await h.handler(
            req("GET", "/api/me", { cookies: cookieHeader(sessionCookie) }),
          )
        ).body,
      );
      assert.equal(me.ok, false);
      assert.equal(me.reason, reason);
      const roster = await h.handler(
        req("GET", "/api/roster", { cookies: cookieHeader(sessionCookie) }),
      );
      assert.equal(roster.statusCode, 403);
      assert.equal(JSON.parse(roster.body).reason, reason);
    }
  }
});

test("me: re-runs the gate after its cache window, and ?refresh=1 within the floor does not spend", async () => {
  const h = harness();
  const { sessionCookie } = await signIn(h);
  const cookies = cookieHeader(sessionCookie);
  await h.handler(req("GET", "/api/me", { cookies }));
  assert.equal(h.mcp.calls.length, 2);
  await h.handler(req("GET", "/api/me", { cookies, query: { refresh: "1" } }));
  assert.equal(h.mcp.calls.length, 2, "refresh inside the floor is free");
  h.clock.t += GATE_TTL_MS + 1;
  // The person verified in the meantime.
  h.mcp.state.players = [player()];
  const me = JSON.parse(
    (await h.handler(req("GET", "/api/me", { cookies }))).body,
  );
  assert.equal(me.ok, true);
  assert.equal(h.mcp.calls.length, 4);
});

test("me: no cookie, a forged cookie, and an unknown session all read as signed out", async () => {
  const h = harness();
  for (const cookies of [
    undefined,
    { "__Host-elixir_clan_session": "abc.def" },
  ]) {
    const r = await h.handler(req("GET", "/api/me", { cookies }));
    assert.equal(r.statusCode, 401);
    assert.equal(JSON.parse(r.body).signed_in, false);
  }
});

test("session: the access token is refreshed server-side before it expires, and the new pair is stored first", async () => {
  const h = harness();
  const { sessionCookie } = await signIn(h);
  const cookies = cookieHeader(sessionCookie);
  h.clock.t += HOUR - 30_000; // inside the skew window
  h.mcp.state.acceptedTokens = new Set(["eat_2"]);
  const r = await h.handler(req("GET", "/api/roster", { cookies }));
  assert.equal(r.statusCode, 200);
  const refresh = h.oauth.calls.find((c) => c[0] === "refresh");
  assert.equal(refresh[1].refreshToken, "ert_1");
  const id = sessionCookie.split("=")[1].split(".")[0];
  const stored = h.store.items.get(`session#${id}`);
  assert.equal(stored.accessToken, "eat_2");
  assert.equal(stored.refreshToken, "ert_2");
  assert.equal(h.mcp.calls.at(-1)[1], "eat_2");
});

test("session: a 401 from the door refreshes once and retries; a second 401 signs out", async () => {
  const h = harness();
  const { sessionCookie } = await signIn(h);
  const cookies = cookieHeader(sessionCookie);
  h.mcp.state.acceptedTokens = new Set(["eat_2"]);
  const ok = await h.handler(req("GET", "/api/roster", { cookies }));
  assert.equal(ok.statusCode, 200);
  assert.equal(h.oauth.calls.filter((c) => c[0] === "refresh").length, 1);

  h.mcp.state.acceptedTokens = new Set();
  h.clock.t += ROSTER_TTL_MS + 1;
  const out = await h.handler(req("GET", "/api/roster", { cookies }));
  assert.equal(out.statusCode, 401);
  assert.equal(JSON.parse(out.body).reason, "session_expired");
  assert.ok(out.cookies[0].includes("Max-Age=0"));
});

test("session: a refresh Elixir refuses ends the session and asks for a fresh sign-in", async () => {
  const h = harness();
  const { sessionCookie } = await signIn(h);
  const cookies = cookieHeader(sessionCookie);
  h.clock.t += 2 * HOUR;
  h.oauth.state.failRefresh = "invalid_grant";
  const r = await h.handler(req("GET", "/api/me", { cookies }));
  assert.equal(r.statusCode, 401);
  assert.equal(JSON.parse(r.body).reason, "session_expired");
  const id = sessionCookie.split("=")[1].split(".")[0];
  assert.equal(h.store.items.has(`session#${id}`), false);
});

test("session: the 90-day family ends without asking Elixir", async () => {
  const h = harness();
  const { sessionCookie } = await signIn(h);
  const cookies = cookieHeader(sessionCookie);
  h.clock.t += 91 * DAY;
  const r = await h.handler(req("GET", "/api/me", { cookies }));
  assert.equal(r.statusCode, 401);
  assert.equal(h.oauth.calls.filter((c) => c[0] === "refresh").length, 0);
});

test("logout: POST only; deletes the session and clears the cookie", async () => {
  const h = harness();
  const { sessionCookie } = await signIn(h);
  const cookies = cookieHeader(sessionCookie);
  const nope = await h.handler(req("GET", "/auth/logout", { cookies }));
  assert.equal(nope.statusCode, 404);
  const out = await h.handler(req("POST", "/auth/logout", { cookies }));
  assert.equal(out.statusCode, 303);
  assert.equal(out.headers.location, "https://clan.test/");
  assert.ok(out.cookies[0].startsWith("__Host-elixir_clan_session=; "));
  const me = await h.handler(req("GET", "/api/me", { cookies }));
  assert.equal(me.statusCode, 401);
});

test("roster: names the primary's clan explicitly, marks your row, groups by role, caches per session", async () => {
  const members = [
    {
      player_tag: "#M1",
      name: "Zed",
      role: "member",
      trophies: 9000,
      donations_this_week: 10,
    },
    {
      player_tag: "#20JJJ2CCRU",
      name: "King Thing",
      role: "leader",
      trophies: 8000,
      donations_this_week: 40,
    },
    {
      player_tag: "#E1",
      name: "Amy",
      role: "elder",
      trophies: 7000,
      donations_this_week: 0,
      last_seen_in_game: "2026-09-12T10:00:00.000Z",
    },
    {
      player_tag: "#C1",
      name: "Bo",
      role: "coLeader",
      trophies: 8500,
      donations_this_week: 5,
    },
    {
      player_tag: "#C2",
      name: "Al",
      role: "coLeader",
      trophies: 8600,
      donations_this_week: 5,
    },
  ];
  const h = harness({ door: { roster: rosterBody(members) } });
  const { sessionCookie } = await signIn(h);
  const cookies = cookieHeader(sessionCookie);
  const r = await h.handler(req("GET", "/api/roster", { cookies }));
  assert.equal(r.statusCode, 200);
  const body = JSON.parse(r.body);
  const call = h.mcp.calls.find((c) => c[0] === "clans_roster");
  assert.deepEqual(call[2], { clan_tag: "#J2RGCRVG" });
  assert.deepEqual(
    body.members.map((m) => m.player_tag),
    ["#20JJJ2CCRU", "#C2", "#C1", "#E1", "#M1"],
  );
  assert.equal(body.members[0].you, true);
  assert.equal(body.members[1].you, false);
  assert.equal(body.members[2].role_label, "Co-leader");
  assert.deepEqual(body.role_counts, {
    leader: 1,
    coLeader: 2,
    elder: 1,
    member: 1,
  });
  assert.equal(body.meta.freshness_seconds, 120);
  assert.equal(body.meta.as_of, "2026-09-12T18:00:00.000Z");
  assert.equal(body.members[3].last_seen_in_game, "2026-09-12T10:00:00.000Z");
  assert.equal(body.name, "POAP KINGS");

  const again = await h.handler(req("GET", "/api/roster", { cookies }));
  assert.equal(JSON.parse(again.body).cached_at, body.cached_at);
  assert.equal(h.mcp.calls.filter((c) => c[0] === "clans_roster").length, 1);
  h.clock.t += ROSTER_TTL_MS + 1;
  await h.handler(req("GET", "/api/roster", { cookies }));
  assert.equal(h.mcp.calls.filter((c) => c[0] === "clans_roster").length, 2);
});

test("roster: an empty clan renders as a roster with no members", async () => {
  const h = harness({ door: { roster: rosterBody([]) } });
  const { sessionCookie } = await signIn(h);
  const r = await h.handler(
    req("GET", "/api/roster", { cookies: cookieHeader(sessionCookie) }),
  );
  const body = JSON.parse(r.body);
  assert.deepEqual(body.members, []);
  assert.equal(body.member_count, 0);
  assert.deepEqual(body.role_counts, {});
});

test("roster: a clan Elixir does not record is said plainly, not as an outage", async () => {
  const h = harness({
    door: {
      roster: {
        error: {
          code: "not_recorded",
          message: "#J2RGCRVG is not a recorded clan.",
          hint: "elixir_track_clan",
        },
      },
    },
  });
  const { sessionCookie } = await signIn(h);
  const r = await h.handler(
    req("GET", "/api/roster", { cookies: cookieHeader(sessionCookie) }),
  );
  assert.equal(r.statusCode, 200);
  const body = JSON.parse(r.body);
  assert.equal(body.not_recorded, true);
  assert.equal(body.clan_tag, "#J2RGCRVG");
});

test("roster: a door outage is a 502, and the cached copy is kept", async () => {
  const mcp = fakeMcp({ roster: rosterBody([]) });
  const h = harness({ mcp });
  const { sessionCookie } = await signIn(h);
  const cookies = cookieHeader(sessionCookie);
  await h.handler(req("GET", "/api/roster", { cookies }));
  h.clock.t += ROSTER_TTL_MS + 1;
  mcp.state.roster = { error: { code: "bad_request", message: "nope" } };
  const r = await h.handler(req("GET", "/api/roster", { cookies }));
  assert.equal(r.statusCode, 502);
});

test("shapeRoster never adds fields the tool did not answer", () => {
  const shaped = shapeRoster(
    { clan_tag: "#X", members: [{ player_tag: "#A", role: "member" }] },
    { you: "#Z" },
  );
  const m = shaped.members[0];
  assert.equal(m.trophies, null);
  assert.equal(m.donations_this_week, null);
  assert.equal(m.last_recorded_battle, null);
  assert.equal(m.name, null);
  assert.equal(shaped.meta.freshness_seconds, null);
});

test("unknown routes are 404 JSON; health is open", async () => {
  const h = harness();
  assert.equal((await h.handler(req("GET", "/api/nope"))).statusCode, 404);
  assert.equal(
    JSON.parse((await h.handler(req("GET", "/api/health"))).body).ok,
    true,
  );
});
