/** Fakes for every seam. No network, no spend: the MCP client and the
 *  OAuth exchange are scripted, the store is in memory, the clock is a
 *  number the test moves. */

import { createMemoryStore } from "../src/store.mjs";
import { createHandler } from "../src/handler.mjs";

export const PERSON = {
  kind: "person",
  subject: { type: "player", tag: "#20JJJ2CCRU", name: "King Thing" },
  clan: { tag: "#J2RGCRVG", name: "POAP KINGS" },
};

export function player(overrides = {}) {
  return {
    player_tag: "#20JJJ2CCRU",
    name: "King Thing",
    relationship: "primary",
    is_primary: true,
    claim_status: "verified",
    notify: false,
    recording: "active",
    clan_tag: "#J2RGCRVG",
    clan_role: "leader",
    ...overrides,
  };
}

export function rosterBody(members) {
  return {
    clan_tag: "#J2RGCRVG",
    name: "POAP KINGS",
    member_count: members.length,
    members,
    notes: ["last_seen_in_game is the game's own lastSeen."],
    docs: "recording#the-games-own-last-seen",
    meta: {
      as_of: "2026-09-12T18:00:00.000Z",
      freshness_seconds: 120,
      source_polls: {
        clan: {
          observed_at: "2026-09-12T17:58:00.000Z",
          freshness_seconds: 120,
        },
      },
      contract_version: "1.7.0",
    },
  };
}

/**
 * A scripted MCP door. `principal` is what initialize answers;
 * `players` what elixir_my_players answers; `roster` what clans_roster
 * answers (a body, or `{ error: { code, message } }` for a tool failure).
 * `refuse` makes every call answer HTTP 401 until cleared, which is how
 * an expired or revoked access token looks from here.
 */
export function fakeMcp({
  principal = PERSON,
  players = [player()],
  roster = null,
} = {}) {
  const calls = [];
  const state = {
    principal,
    players,
    roster,
    refuse: false,
    acceptedTokens: null,
  };
  const refused = () => ({ ok: false, status: 401, error: "http 401" });
  const tokenOk = (token) =>
    !state.refuse && (!state.acceptedTokens || state.acceptedTokens.has(token));
  return {
    calls,
    state,
    async initialize(token) {
      calls.push(["initialize", token]);
      if (!tokenOk(token)) return refused();
      return {
        ok: true,
        body: {},
        version: "1.7.0+tools.abc",
        principal: state.principal,
      };
    },
    async callTool(token, name, args) {
      calls.push([name, token, args]);
      if (!tokenOk(token)) return refused();
      if (name === "elixir_my_players")
        return {
          ok: true,
          body: {
            players: state.players,
            meta: { as_of: "2026-09-12T18:00:00.000Z" },
          },
        };
      if (name === "clans_roster") {
        if (state.roster?.error)
          return {
            ok: false,
            code: state.roster.error.code,
            error: state.roster.error.message,
            hint: state.roster.error.hint,
          };
        return { ok: true, body: state.roster ?? rosterBody([]) };
      }
      return { ok: false, code: "unknown", error: `no fake for ${name}` };
    },
  };
}

export function fakeOAuth({ now }) {
  const calls = [];
  let n = 0;
  const state = { failExchange: null, failRefresh: null };
  const tokens = () => {
    n += 1;
    return {
      accessToken: `eat_${n}`,
      refreshToken: `ert_${n}`,
      accessExpiresAt: now() + 3600_000,
      scope: "cr:read",
    };
  };
  return {
    calls,
    state,
    async authorizationUrl({ redirectUri, state: s, codeChallenge }) {
      calls.push(["authorize", { redirectUri, state: s, codeChallenge }]);
      return `https://elixir.test/oauth/authorize?state=${s}&code_challenge=${codeChallenge}`;
    },
    async exchange(args) {
      calls.push(["exchange", args]);
      if (state.failExchange)
        return { ok: false, status: 400, error: state.failExchange };
      return { ok: true, tokens: tokens() };
    },
    async refresh(args) {
      calls.push(["refresh", args]);
      if (state.failRefresh)
        return { ok: false, status: 400, error: state.failRefresh };
      return { ok: true, tokens: tokens() };
    },
  };
}

export function harness(opts = {}) {
  const clock = { t: Date.parse("2026-09-12T18:00:00Z") };
  const now = () => clock.t;
  const mcp = opts.mcp ?? fakeMcp(opts.door);
  const oauth = fakeOAuth({ now });
  const store = createMemoryStore();
  const handler = createHandler({
    mcp,
    oauth,
    store,
    sessionSecret: "test-secret",
    appUrl: "https://clan.test",
    elixirUrl: "https://elixir.test",
    now,
    log: { warn() {}, error() {} },
  });
  return { clock, now, mcp, oauth, store, handler };
}

export function req(method, path, { query, cookies } = {}) {
  return {
    rawPath: path,
    requestContext: { http: { method } },
    queryStringParameters: query,
    cookies: cookies
      ? Object.entries(cookies).map(([k, v]) => `${k}=${v}`)
      : [],
  };
}

/** Drive a whole sign-in through the fake door; returns the session cookie. */
export async function signIn(h) {
  const start = await h.handler(req("GET", "/auth/login"));
  const loginCookie = start.cookies[0].split(";")[0];
  const [name, state] = loginCookie.split("=");
  const cb = await h.handler(
    req("GET", "/auth/callback", {
      query: { code: "eac_x", state },
      cookies: { [name]: state },
    }),
  );
  const session = cb.cookies.find((c) =>
    c.startsWith("__Host-elixir_clan_session="),
  );
  return { start, cb, sessionCookie: session ? session.split(";")[0] : null };
}

export function cookieHeader(sessionCookie) {
  const [k, v] = sessionCookie.split("=");
  return { [k]: v };
}
