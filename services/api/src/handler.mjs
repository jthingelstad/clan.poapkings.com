/**
 * The Lambda behind /auth/* and /api/*, as a factory so every seam is
 * injected: the MCP client, the OAuth exchange, the store and the clock.
 * Tests hand in fakes; index.mjs hands in the real ones from the
 * environment.
 *
 * What a person is here: an Elixir session and nothing else. There are
 * no accounts, no passwords, no roles of our own; in-game role is the
 * app role and comes from the roster on every read.
 *
 * Quota discipline: every call spends the signed-in person's Elixir daily
 * budget, so the gate answer and the roster are cached per session for a
 * few minutes, `?refresh=1` is rate-limited, and nothing here polls.
 */

import {
  clearLoginCookie,
  clearSessionCookie,
  newSessionId,
  readCookies,
  LOGIN_COOKIE,
  SESSION_COOKIE,
  setLoginCookie,
  setSessionCookie,
  verifySessionCookie,
} from "./cookies.mjs";
import { runGate } from "./gate.mjs";
import { pkcePair, randomState } from "./oauth.mjs";
import { roleLabel, roleRank } from "./roles.mjs";

export const GATE_TTL_MS = 2 * 60_000;
export const ROSTER_TTL_MS = 3 * 60_000;
export const REFRESH_FLOOR_MS = 30_000;
const ACCESS_SKEW_MS = 60_000;
const FAMILY_MS = 90 * 24 * 3600_000;
const REFRESH_MS = 30 * 24 * 3600_000;
const SESSION_TTL_S = 90 * 24 * 3600;

const json = (statusCode, body, extra = {}) => ({
  statusCode,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extra.headers,
  },
  cookies: extra.cookies,
  body: JSON.stringify(body),
});

const redirect = (location, cookies) => ({
  statusCode: 303,
  headers: { location, "cache-control": "no-store" },
  cookies,
  body: "",
});

export function createHandler({
  mcp,
  oauth,
  store,
  sessionSecret,
  appUrl,
  elixirUrl,
  now = () => Date.now(),
  log = console,
}) {
  for (const [k, v] of Object.entries({
    mcp,
    oauth,
    store,
    sessionSecret,
    appUrl,
    elixirUrl,
  })) {
    if (!v) throw new Error(`handler needs ${k}`);
  }
  const redirectUri = `${appUrl}/auth/callback`;

  // ---- sessions ---------------------------------------------------------

  async function loadSession(event) {
    const id = verifySessionCookie(
      sessionSecret,
      readCookies(event)[SESSION_COOKIE],
    );
    if (!id) return null;
    const session = await store.getSession(id);
    return session ? { id, ...session } : null;
  }

  /**
   * A usable access token for this session, refreshing when it is about
   * to expire. `null` means sign in again: the family ran out, or Elixir
   * refused the refresh (a revoked grant, a rotated token).
   */
  async function accessToken(session, { force = false } = {}) {
    const t = now();
    if (session.familyExpiresAt && session.familyExpiresAt <= t) {
      await store.deleteSession(session.id);
      return null;
    }
    if (!force && session.accessExpiresAt - t > ACCESS_SKEW_MS)
      return session.accessToken;
    if (!session.refreshToken) {
      await store.deleteSession(session.id);
      return null;
    }
    const refreshed = await oauth.refresh({
      refreshToken: session.refreshToken,
    });
    if (!refreshed.ok) {
      log.warn?.("refresh_failed", { error: refreshed.error });
      if (refreshed.status === 400) await store.deleteSession(session.id);
      return null;
    }
    const patch = {
      accessToken: refreshed.tokens.accessToken,
      accessExpiresAt: refreshed.tokens.accessExpiresAt,
      refreshToken: refreshed.tokens.refreshToken ?? session.refreshToken,
      refreshExpiresAt: t + REFRESH_MS,
      scope: refreshed.tokens.scope,
    };
    // Stored BEFORE any further use: a rotated refresh token presented
    // twice revokes the whole grant on Elixir's side.
    await store.updateSession(session.id, patch);
    Object.assign(session, patch);
    return session.accessToken;
  }

  /** Run `fn(token)`; on a 401 from the door, refresh once and retry. */
  async function withToken(session, fn) {
    let token = await accessToken(session);
    if (!token) return { signInRequired: true };
    let result = await fn(token);
    if (result?.status === 401) {
      token = await accessToken(session, { force: true });
      if (!token) return { signInRequired: true };
      result = await fn(token);
      if (result?.status === 401) {
        await store.deleteSession(session.id);
        return { signInRequired: true };
      }
    }
    return { result };
  }

  async function gateFor(session, { refresh = false } = {}) {
    const t = now();
    const cached = session.gate;
    if (
      cached &&
      !refresh &&
      typeof cached.checkedAt === "number" &&
      t - cached.checkedAt < GATE_TTL_MS
    )
      return { gate: cached.result, checkedAt: cached.checkedAt };
    if (cached && refresh && t - cached.checkedAt < REFRESH_FLOOR_MS)
      return { gate: cached.result, checkedAt: cached.checkedAt };
    const ran = await withToken(session, (token) => runGate({ mcp, token }));
    if (ran.signInRequired) return { signInRequired: true };
    const gate = ran.result;
    if (gate.error) return { error: gate.error };
    await store.updateSession(session.id, {
      gate: { result: gate, checkedAt: t },
    });
    session.gate = { result: gate, checkedAt: t };
    return { gate, checkedAt: t };
  }

  const signedOut = (extra) =>
    json(
      401,
      { signed_in: false, ...extra },
      { cookies: [clearSessionCookie()] },
    );

  // ---- routes -----------------------------------------------------------

  async function login() {
    if (oauth.configured === false)
      return redirect(`${appUrl}/?error=not_configured`);
    const state = randomState();
    const { verifier, challenge } = pkcePair();
    await store.putLogin(state, { verifier, redirectUri }, now());
    let url;
    try {
      url = await oauth.authorizationUrl({
        redirectUri,
        state,
        codeChallenge: challenge,
      });
    } catch (error) {
      log.error?.("discovery_failed", { error: error.message });
      return redirect(`${appUrl}/?error=elixir_unavailable`);
    }
    return redirect(url, [setLoginCookie(state)]);
  }

  async function callback(event) {
    const q = event.queryStringParameters ?? {};
    const cookies = readCookies(event);
    const cleared = [clearLoginCookie()];
    const fail = (code) => redirect(`${appUrl}/?error=${code}`, cleared);

    if (!q.state || !q.code) return fail("missing_code");
    if (cookies[LOGIN_COOKIE] !== q.state) return fail("state_mismatch");
    if (q.iss && q.iss !== elixirUrl) return fail("wrong_issuer");
    const login = await store.takeLogin(q.state);
    if (!login) return fail("login_expired");

    const exchanged = await oauth.exchange({
      code: q.code,
      codeVerifier: login.verifier,
      redirectUri: login.redirectUri,
    });
    if (!exchanged.ok) {
      log.warn?.("exchange_failed", { error: exchanged.error });
      return fail("exchange_failed");
    }

    const t = now();
    const gate = await runGate({ mcp, token: exchanged.tokens.accessToken });
    if (gate.error) {
      log.warn?.("gate_unavailable", { error: gate.error });
      return fail("elixir_unavailable");
    }
    // An agent's or integration's grant gets no session at all: there is
    // no person to remember, and the page says what to do instead.
    if (gate.reason === "not_a_person")
      return redirect(`${appUrl}/refused/not_a_person`, cleared);

    const id = newSessionId();
    await store.putSession(id, {
      accessToken: exchanged.tokens.accessToken,
      accessExpiresAt: exchanged.tokens.accessExpiresAt,
      refreshToken: exchanged.tokens.refreshToken,
      refreshExpiresAt: t + REFRESH_MS,
      familyExpiresAt: t + FAMILY_MS,
      scope: exchanged.tokens.scope,
      createdAt: t,
      gate: { result: gate, checkedAt: t },
      ttl: Math.floor(t / 1000) + SESSION_TTL_S,
    });
    const to = gate.ok ? "/clan" : `/refused/${gate.reason}`;
    return redirect(`${appUrl}${to}`, [
      ...cleared,
      setSessionCookie(sessionSecret, id),
    ]);
  }

  async function logout(event) {
    const session = await loadSession(event);
    if (session) await store.deleteSession(session.id);
    return redirect(`${appUrl}/`, [clearSessionCookie()]);
  }

  async function me(event) {
    const session = await loadSession(event);
    if (!session) return signedOut();
    const refresh = event.queryStringParameters?.refresh === "1";
    const answer = await gateFor(session, { refresh });
    if (answer.signInRequired) return signedOut({ reason: "session_expired" });
    if (answer.error)
      return json(502, { signed_in: true, error: "elixir_unavailable" });
    const g = answer.gate;
    return json(200, {
      signed_in: true,
      ok: g.ok,
      reason: g.ok ? null : g.reason,
      principal: g.principal ?? null,
      player: g.player ?? null,
      clan: g.clan ?? null,
      checked_at: new Date(answer.checkedAt).toISOString(),
      scope: session.scope ?? null,
      elixir_url: elixirUrl,
    });
  }

  async function roster(event) {
    const session = await loadSession(event);
    if (!session) return signedOut();
    const gated = await gateFor(session);
    if (gated.signInRequired) return signedOut({ reason: "session_expired" });
    if (gated.error) return json(502, { error: "elixir_unavailable" });
    if (!gated.gate.ok)
      return json(403, { error: "gate", reason: gated.gate.reason });

    const clanTag = gated.gate.clan.clan_tag;
    const you = gated.gate.player.player_tag;
    const t = now();
    const refresh = event.queryStringParameters?.refresh === "1";
    const cached = session.roster;
    const fresh =
      cached &&
      cached.clanTag === clanTag &&
      typeof cached.cachedAt === "number" &&
      t - cached.cachedAt < (refresh ? REFRESH_FLOOR_MS : ROSTER_TTL_MS);
    if (fresh)
      return json(200, {
        ...cached.body,
        cached_at: new Date(cached.cachedAt).toISOString(),
      });

    // The clan is named explicitly rather than left to the tool's default,
    // which is the first RECORDED clan among the account's claims and can
    // be an alt's clan when the primary's is not recorded.
    const ran = await withToken(session, (token) =>
      mcp.callTool(token, "clans_roster", { clan_tag: clanTag }),
    );
    if (ran.signInRequired) return signedOut({ reason: "session_expired" });
    const r = ran.result;
    if (!r.ok) {
      if (r.code === "not_recorded" || r.code === "no_subject")
        return json(200, {
          clan_tag: clanTag,
          not_recorded: true,
          hint: r.hint ?? null,
          cached_at: new Date(t).toISOString(),
        });
      log.warn?.("roster_failed", { error: r.error, code: r.code });
      return json(502, { error: "elixir_unavailable" });
    }
    const body = shapeRoster(r.body, { you });
    await store.updateSession(session.id, {
      roster: { clanTag, cachedAt: t, body },
    });
    return json(200, { ...body, cached_at: new Date(t).toISOString() });
  }

  return async function handler(event) {
    const method = event.requestContext?.http?.method ?? event.httpMethod;
    const path = event.rawPath ?? event.path ?? "/";
    try {
      if (method === "GET" && path === "/api/health")
        return json(200, { ok: true });
      if (method === "GET" && path === "/auth/login") return await login();
      if (method === "GET" && path === "/auth/callback")
        return await callback(event);
      if (method === "POST" && path === "/auth/logout")
        return await logout(event);
      if (method === "GET" && path === "/api/me") return await me(event);
      if (method === "GET" && path === "/api/roster")
        return await roster(event);
      return json(404, { error: "not_found" });
    } catch (error) {
      log.error?.("unhandled", { path, error: error?.message });
      return json(500, { error: "internal" });
    }
  };
}

/** The roster as the page wants it: grouped by role rank, then trophies,
 *  the signed-in person's row marked, the API's role spelling kept beside
 *  its label. Nothing is added that the tool did not say. */
export function shapeRoster(body, { you }) {
  const members = (body.members ?? [])
    .map((m) => ({
      player_tag: m.player_tag,
      name: m.name ?? null,
      role: m.role ?? null,
      role_label: roleLabel(m.role),
      trophies: m.trophies ?? null,
      donations_this_week: m.donations_this_week ?? null,
      last_recorded_battle: m.last_recorded_battle ?? null,
      last_seen_in_game: m.last_seen_in_game ?? null,
      first_observed_in_clan: m.first_observed_in_clan ?? null,
      you: m.player_tag === you,
    }))
    .sort(
      (a, b) =>
        roleRank(a.role) - roleRank(b.role) ||
        (b.trophies ?? -1) - (a.trophies ?? -1) ||
        String(a.name).localeCompare(String(b.name)),
    );
  const roleCounts = {};
  for (const m of members) roleCounts[m.role] = (roleCounts[m.role] ?? 0) + 1;
  return {
    clan_tag: body.clan_tag,
    name: body.name ?? null,
    member_count: body.member_count ?? members.length,
    role_counts: roleCounts,
    members,
    notes: Array.isArray(body.notes) ? body.notes : [],
    docs: body.docs ?? null,
    meta: {
      as_of: body.meta?.as_of ?? null,
      freshness_seconds: body.meta?.freshness_seconds ?? null,
      source_polls: body.meta?.source_polls ?? null,
      completeness_note: body.meta?.completeness_note ?? null,
      contract_version: body.meta?.contract_version ?? null,
      disclaimer: body.meta?.disclaimer ?? null,
    },
  };
}
