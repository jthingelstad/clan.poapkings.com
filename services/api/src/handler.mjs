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
import { normalizeTag, runGate } from "./gate.mjs";
import {
  withTrace,
  current,
  annotate,
  summarize,
  serverTiming,
} from "./trace.mjs";
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
  manage = null,
  awards = null,
  scout = null,
  recruit = null,
  /** the clan's own model: its key and its uses (`manage/model.mjs`) */
  model = null,
  /** Leader Messages drafted by the clan's model (`manage/drafts.mjs`) */
  drafts = null,
  feedback = null,
  /** Verified player tags of the product's maintainer(s): MaintainerTags. */
  maintainerTags = [],
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

  /** The preference key: the primary's tag, or the first tag on the
   *  account for an account with alts but no primary. */
  const prefKey = (gate) =>
    gate.primary?.player_tag ?? gate.identities?.[0]?.player_tag ?? null;

  /**
   * Which clan this session works in. Valid only while it is in the clan
   * set; a remembered preference wins, then a lone clan; more than one
   * with nothing remembered is `null`, and the page shows the chooser.
   */
  async function selectionFor(session, gate) {
    if (!gate.ok) return null;
    const inSet = (tag) => gate.clans.find((c) => c.clan_tag === tag) ?? null;
    if (session.selected && inSet(session.selected.clan_tag))
      return inSet(session.selected.clan_tag);
    let chosen = null;
    const key = prefKey(gate);
    const pref = key ? await store.getPreference(key) : null;
    if (pref?.clan_tag) chosen = inSet(pref.clan_tag);
    if (!chosen && gate.clans.length === 1) chosen = gate.clans[0];
    if (chosen) {
      await store.updateSession(session.id, {
        selected: { clan_tag: chosen.clan_tag, player_tag: chosen.acting_as },
      });
      session.selected = {
        clan_tag: chosen.clan_tag,
        player_tag: chosen.acting_as,
      };
    }
    return chosen;
  }

  /**
   * Who a session is, for feedback: the primary's tag (or the first tag
   * on the account), the name, and whether a VERIFIED tag of theirs is a
   * maintainer's. Works for a refused person too: "I am stuck at
   * unverified" is feedback worth having.
   */
  const personFor = (gate) => {
    const tag = prefKey(gate);
    if (!tag) return null;
    const id = (gate.identities ?? []).find((i) => i.player_tag === tag);
    const maintainer = (gate.identities ?? []).some(
      (i) =>
        i.claim_status === "verified" && maintainerTags.includes(i.player_tag),
    );
    return {
      player_tag: tag,
      name: id?.name ?? gate.primary?.name ?? null,
      maintainer,
    };
  };

  const meBody = (session, gate, checkedAt, selected, person = null) => ({
    signed_in: true,
    maintainer: person?.maintainer === true,
    ok: gate.ok,
    reason: gate.ok ? null : gate.reason,
    principal: gate.principal ?? null,
    identities: gate.identities ?? [],
    clans: gate.clans ?? [],
    primary: gate.primary ?? null,
    selected: selected
      ? {
          clan_tag: selected.clan_tag,
          name: selected.name,
          player_tag: selected.acting_as,
          player_name: selected.acting_as_name,
          role: selected.role,
          role_label: selected.role_label,
          your_tags: selected.your_tags,
        }
      : null,
    checked_at: new Date(checkedAt).toISOString(),
    scope: session.scope ?? null,
    elixir_url: elixirUrl,
  });

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
    const session = { id, selected: null };
    const selected = gate.ok ? await selectionFor(session, gate) : null;
    const to = !gate.ok
      ? `/refused/${gate.reason}`
      : selected
        ? `/clan/${selected.clan_tag.slice(1)}`
        : "/clans";
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
    const selected = await selectionFor(session, answer.gate);
    const person = personFor(answer.gate);
    const body = meBody(
      session,
      answer.gate,
      answer.checkedAt,
      selected,
      person,
    );
    if (feedback && person)
      body.feedback_unseen = await feedback.unseen(person).catch(() => 0);
    // Which pages the selected clan's policy turns on (nothing in clan
    // management exists until a leader saves one), and the rail's Inbox
    // count for a leader: what is waiting, no evaluation.
    if (manage && selected) {
      body.policy = await manage
        .policySummary(selected.clan_tag)
        .catch(() => null);
      // The rail's Actions count: what waits for this person, as who they
      // are in this clan.
      body.open_actions = await manage
        .openActionCount(selected.clan_tag, {
          player_tag: selected.acting_as ?? selected.player_tag,
          role: selected.role,
        })
        .catch(() => 0);
    }
    return json(200, body);
  }

  /** The feedback routes: a person's own, and the maintainer's lane. */
  async function feedbackRoute(event, method, path) {
    const session = await loadSession(event);
    if (!session) return signedOut();
    const gated = await gateFor(session);
    if (gated.signInRequired) return signedOut({ reason: "session_expired" });
    if (gated.error) return json(502, { error: "elixir_unavailable" });
    const person = personFor(gated.gate);
    if (!person) return json(403, { error: "no_player" });
    const body = method === "GET" ? {} : parseBody(event);
    if (body === null) return json(400, { error: "bad_request" });
    try {
      if (method === "GET" && path === "/api/feedback")
        return json(200, {
          feedback: await feedback.list(person),
          maintainer: person.maintainer,
        });
      if (method === "POST" && path === "/api/feedback")
        return json(200, await feedback.file(person, body));
      const one = /^\/api\/feedback\/([A-Za-z0-9_-]{4,16})$/.exec(path);
      if (method === "GET" && one)
        return json(200, await feedback.item(person, one[1]));
      if (method === "GET" && path === "/api/maintain/feedback")
        return json(200, { feedback: await feedback.queue(person) });
      const decide = /^\/api\/maintain\/feedback\/([A-Za-z0-9_-]{4,16})$/.exec(
        path,
      );
      if (method === "POST" && decide)
        return json(200, await feedback.decide(person, decide[1], body));
      return json(404, { error: "not_found" });
    } catch (err) {
      if (err?.status) return json(err.status, { error: err.code });
      throw err;
    }
  }

  /** Choose the clan to work in. Remembered for the next sign-in too. */
  async function select(event) {
    const session = await loadSession(event);
    if (!session) return signedOut();
    let body = {};
    try {
      body = JSON.parse(event.body ?? "{}");
    } catch {
      return json(400, { error: "bad_request" });
    }
    const tag = normalizeTag(body.clan_tag);
    if (!tag) return json(400, { error: "bad_request", hint: "clan_tag" });
    const gated = await gateFor(session);
    if (gated.signInRequired) return signedOut({ reason: "session_expired" });
    if (gated.error) return json(502, { error: "elixir_unavailable" });
    if (!gated.gate.ok)
      return json(403, { error: "gate", reason: gated.gate.reason });
    const chosen = gated.gate.clans.find((c) => c.clan_tag === tag);
    if (!chosen) return json(403, { error: "not_your_clan", clan_tag: tag });
    const selected = {
      clan_tag: chosen.clan_tag,
      player_tag: chosen.acting_as,
    };
    await store.updateSession(session.id, { selected });
    session.selected = selected;
    const key = prefKey(gated.gate);
    if (key)
      await store.putPreference(key, {
        clan_tag: chosen.clan_tag,
        chosen_at: new Date(now()).toISOString(),
      });
    return json(200, meBody(session, gated.gate, gated.checkedAt, chosen));
  }

  async function roster(event) {
    const session = await loadSession(event);
    if (!session) return signedOut();
    const gated = await gateFor(session);
    if (gated.signInRequired) return signedOut({ reason: "session_expired" });
    if (gated.error) return json(502, { error: "elixir_unavailable" });
    if (!gated.gate.ok)
      return json(403, { error: "gate", reason: gated.gate.reason });

    // The clan is named in the query (the page's URL), else the selection.
    // Either way it must be one of the person's verified clans.
    const q = event.queryStringParameters ?? {};
    let clan = null;
    if (q.clan) {
      const tag = normalizeTag(q.clan);
      clan = tag ? gated.gate.clans.find((c) => c.clan_tag === tag) : null;
      if (!clan)
        return json(403, { error: "not_your_clan", clan_tag: tag ?? q.clan });
    } else {
      clan = await selectionFor(session, gated.gate);
      if (!clan) return json(409, { error: "no_selection" });
    }
    const clanTag = clan.clan_tag;
    const t = now();
    const refresh = q.refresh === "1";
    const cached = session.rosters?.[clanTag];
    const fresh =
      cached &&
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
          name: clan.name,
          not_recorded: true,
          hint: r.hint ?? null,
          cached_at: new Date(t).toISOString(),
        });
      log.warn?.("roster_failed", { error: r.error, code: r.code });
      return json(502, { error: "elixir_unavailable" });
    }
    const body = shapeRoster(r.body, { yourTags: clan.your_tags });
    // The roster read is also how the policy gate learns the clan's size.
    if (manage)
      await manage
        .noteSize(clanTag, body.member_count)
        .catch((e) =>
          log.warn?.("clan_size_note_failed", { error: e.message }),
        );
    // Bounded: only clans in the set are ever cached, one entry each.
    const rosters = {};
    for (const c of gated.gate.clans) {
      if (session.rosters?.[c.clan_tag])
        rosters[c.clan_tag] = session.rosters[c.clan_tag];
    }
    rosters[clanTag] = { cachedAt: t, body };
    await store.updateSession(session.id, { rosters });
    session.rosters = rosters;
    return json(200, { ...body, cached_at: new Date(t).toISOString() });
  }

  /**
   * The signed-in person in one of THEIR clans: the session, the gate, the
   * clan from the set and who they are there (tag, name, role). Every
   * Manage route starts here; role checks happen in the service.
   */
  async function clanContext(event, tagInput) {
    const session = await loadSession(event);
    if (!session) return { response: signedOut() };
    const gated = await gateFor(session);
    if (gated.signInRequired)
      return { response: signedOut({ reason: "session_expired" }) };
    if (gated.error)
      return { response: json(502, { error: "elixir_unavailable" }) };
    if (!gated.gate.ok)
      return {
        response: json(403, { error: "gate", reason: gated.gate.reason }),
      };
    const tag = normalizeTag(tagInput);
    const clan = tag ? gated.gate.clans.find((c) => c.clan_tag === tag) : null;
    if (!clan)
      return {
        response: json(403, {
          error: "not_your_clan",
          clan_tag: tag ?? tagInput,
        }),
      };
    const token = await accessToken(session);
    if (!token) return { response: signedOut({ reason: "session_expired" }) };
    return {
      session,
      gate: gated.gate,
      clan,
      token,
      who: {
        player_tag: clan.acting_as,
        name: clan.acting_as_name ?? null,
        role: clan.role,
      },
    };
  }

  function parseBody(event) {
    try {
      return JSON.parse(event.body ?? "{}") ?? {};
    } catch {
      return null;
    }
  }

  async function manageRoute(event, method, path) {
    const m = /^\/api\/clans\/([0-9A-Za-z]{3,12})(\/.*)?$/.exec(path);
    if (!m) return null;
    const rest = m[2] ?? "";
    // Every clan route needs a session: Elixir Clan is an app for a
    // clan's members and publishes nothing (Jamie, 2026-09-25).
    const ctx = await clanContext(event, m[1]);
    if (ctx.response) return ctx.response;
    const { clan, who, token } = ctx;
    const tag = clan.clan_tag;
    annotate({ clan: tag, role: who.role });
    const body =
      method === "GET" || method === "DELETE" ? {} : parseBody(event);
    if (body === null) return json(400, { error: "bad_request" });
    try {
      // Recruiting: every member reads and copies; leaders write the pitch.
      if (recruit && rest === "/recruit") {
        if (method === "GET")
          return json(
            200,
            await recruit.view(tag, who, token, {
              refresh: event.queryStringParameters?.refresh === "1",
            }),
          );
        if (method === "POST")
          return json(
            200,
            await recruit.savePitch(
              tag,
              who,
              body.values ?? {},
              body.note ?? null,
            ),
          );
      }
      // A leader drafts the pitch with the clan's own model.
      if (recruit && method === "POST" && rest === "/recruit/draft")
        return json(
          200,
          await recruit.draft(tag, who, token, body.note ?? null),
        );
      // The clan's own model: leaders add, change and remove its key. It
      // works for any clan, with or without a policy (Recruit does).
      if (model && rest === "/model") {
        if (method === "GET")
          return json(200, await model.status(tag, who, token));
        if (method === "PUT" && body.key)
          return json(
            200,
            await model.setKey(tag, who, {
              key: body.key,
              model: body.model ?? null,
            }),
          );
        if (method === "PUT" && body.model)
          return json(200, await model.setModel(tag, who, body.model));
        if (method === "DELETE") {
          await model.removeKey(tag, who);
          return json(200, { ok: true });
        }
        return json(400, { error: "bad_request" });
      }
      // A Leader Message in the clan's voice, by the clan's own model.
      const draft = /^\/actions\/([A-Za-z0-9_-]+)\/draft$/.exec(rest);
      if (method === "POST" && draft) {
        if (!drafts) return json(404, { error: "not_found" });
        return json(
          200,
          await drafts.leaderMessage(tag, who, token, draft[1], {
            note: body.note ?? null,
            clanName: clan.name ?? null,
          }),
        );
      }
      if (!manage) return json(404, { error: "not_found" });
      if (method === "GET" && rest === "/manage")
        return json(
          200,
          await manage.manageView(tag, who, token, {
            refresh: event.queryStringParameters?.refresh === "1",
          }),
        );
      if (method === "GET" && rest === "/history")
        return json(200, await manage.history(tag, who, token));
      // "You here": a member's own numbers and place in this clan.
      if (method === "GET" && rest === "/me")
        return json(200, await manage.memberView(tag, who, token));
      // A member's own away: their page, their word, the policy's cap.
      if (rest === "/me/away") {
        if (method === "GET") return json(200, await manage.myAway(tag, who));
        if (method === "PUT")
          return json(200, await manage.setAway(tag, who, body, token));
        if (method === "DELETE") {
          await manage.clearAway(tag, who, token);
          return json(200, { ok: true });
        }
      }
      if (method === "GET" && rest === "/policy")
        return json(200, await manage.policyView(tag, who, token));
      if (method === "POST" && rest === "/policy")
        return json(
          200,
          await manage.savePolicy(
            tag,
            who,
            body.values ?? {},
            body.note ?? null,
            token,
          ),
        );
      if (method === "POST" && rest === "/policy/preview")
        return json(
          200,
          await manage.previewPolicy(tag, who, token, body.values ?? {}),
        );
      if (method === "GET" && rest === "/actions") {
        const view = await manage.actionsView(tag, who, token, {
          refresh: event.queryStringParameters?.refresh === "1",
        });
        // Leaders are told whether the clan's model can draft messages.
        if (model && ["leader", "coLeader"].includes(who.role))
          view.model = await model.summary(tag);
        return json(200, view);
      }
      // One action by its number, for "take a look at action 37".
      const byNumber = /^\/actions\/([0-9]{1,7})$/.exec(rest);
      if (method === "GET" && byNumber) {
        const view = await manage.actionByNumber(tag, who, Number(byNumber[1]));
        if (model && ["leader", "coLeader"].includes(who.role))
          view.model = await model.summary(tag);
        return json(200, view);
      }
      const decide = /^\/actions\/([A-Za-z0-9_-]+)\/decide$/.exec(rest);
      if (method === "POST" && decide)
        return json(200, await manage.decide(tag, who, decide[1], body, token));
      // What the clan shares with Elixir (door 3): leaders' switches.
      if (rest === "/sharing") {
        if (method === "GET")
          return json(200, await manage.sharingView(tag, who));
        if (method === "PUT")
          return json(200, await manage.saveSharing(tag, who, body.values));
      }
      const comment = /^\/actions\/([A-Za-z0-9_-]+)\/comments$/.exec(rest);
      if (method === "POST" && comment)
        return json(200, await manage.comment(tag, who, comment[1], body.text));
      const hold = /^\/holds\/([0-9A-Za-z]{3,12})$/.exec(rest);
      if (hold) {
        const ptag = normalizeTag(hold[1]);
        if (!ptag) return json(400, { error: "bad_request" });
        if (method === "PUT")
          return json(200, await manage.setHold(tag, who, ptag, body));
        if (method === "DELETE") {
          await manage.clearHold(tag, who, ptag);
          return json(200, { ok: true });
        }
      }
      const notes = /^\/members\/([0-9A-Za-z]{3,12})\/notes$/.exec(rest);
      if (notes) {
        const ptag = normalizeTag(notes[1]);
        if (!ptag) return json(400, { error: "bad_request" });
        if (method === "GET")
          return json(200, { notes: await manage.notesFor(tag, who, ptag) });
        if (method === "POST")
          return json(200, await manage.addNote(tag, who, ptag, body.text));
      }
      const note = /^\/notes\/([A-Za-z0-9_-]+)$/.exec(rest);
      if (method === "DELETE" && note) {
        await manage.removeNote(tag, who, note[1]);
        return json(200, { ok: true });
      }
      if (method === "GET" && rest === "/standing")
        return json(200, await manage.standing(tag, who, token));
      if (awards) {
        if (method === "GET" && rest === "/awards/manage")
          return json(
            200,
            await awards.manageView(tag, who, token, {
              refresh: event.queryStringParameters?.refresh === "1",
            }),
          );
        if (method === "POST" && rest === "/awards/config")
          return json(
            200,
            await awards.saveConfig(
              tag,
              who,
              body.values ?? {},
              body.note ?? null,
            ),
          );
        if (method === "POST" && rest === "/awards/grants") {
          const ptag = normalizeTag(String(body.player_tag ?? ""));
          if (!ptag) return json(400, { error: "bad_request" });
          return json(
            200,
            await awards.grant(tag, who, { ...body, player_tag: ptag }),
          );
        }
        const grant =
          /^\/awards\/grants\/([0-9]{1,4})\/([a-z][a-z0-9_]{1,31})\/([0-9A-Za-z]{3,12})$/.exec(
            rest,
          );
        if (method === "DELETE" && grant) {
          const ptag = normalizeTag(grant[3]);
          if (!ptag) return json(400, { error: "bad_request" });
          await awards.revoke(tag, who, {
            season_id: Number(grant[1]),
            award_id: grant[2],
            player_tag: ptag,
          });
          return json(200, { ok: true });
        }
        // The clan's trophy case, for every member.
        if (method === "GET" && rest === "/trophies")
          return json(200, await awards.trophyCase(tag, who, token));
        // One member's trophy case.
        const trophy = /^\/members\/([0-9A-Za-z]{3,12})\/grants$/.exec(rest);
        if (method === "GET" && trophy) {
          const ptag = normalizeTag(trophy[1]);
          if (!ptag) return json(400, { error: "bad_request" });
          return json(200, { grants: await awards.forMember(tag, ptag) });
        }
      }
      if (method === "POST" && rest === "/scout") {
        if (!["leader", "coLeader", "elder"].includes(who.role))
          return json(403, { error: "elders_only" });
        // Scout works before a clan has a policy: the applicant's own
        // statistics, with nothing of the clan's to check them against.
        const policy = await manage.policyFor(tag);
        const r = await scout({
          token,
          tagInput: body.tag,
          policy: policy.set ? policy.values : null,
        });
        return json(r.ok ? 200 : r.status === 401 ? 401 : 400, r);
      }
      return json(404, { error: "not_found" });
    } catch (err) {
      if (err?.status) {
        if (err.code === "session_expired")
          return signedOut({ reason: "session_expired" });
        return json(err.status, {
          error: err.code,
          ...(err.errors ? { errors: err.errors } : {}),
          ...(err.detail ?? {}),
        });
      }
      throw err;
    }
  }

  return function handler(event) {
    const method = event.requestContext?.http?.method ?? event.httpMethod;
    const path = event.rawPath ?? event.path ?? "/";
    return withTrace(
      {
        http: routeKey(method, path),
        request_id: event.requestContext?.requestId ?? null,
      },
      async () => {
        const trace = current();
        const res = await dispatch(event, method, path);
        const summary = summarize(trace, res.statusCode ?? 200);
        (summary.level === "warn" ? log.warn : log.info)?.(
          JSON.stringify(summary),
        );
        return {
          ...res,
          headers: {
            ...(res.headers ?? {}),
            "server-timing": serverTiming(summary),
          },
        };
      },
    );
  };

  async function dispatch(event, method, path) {
    try {
      if ((manage || awards || recruit) && path.startsWith("/api/clans/")) {
        const answered = await manageRoute(event, method, path);
        if (answered) return answered;
      }
      if (
        feedback &&
        (path.startsWith("/api/feedback") ||
          path.startsWith("/api/maintain/feedback"))
      )
        return await feedbackRoute(event, method, path);
      if (method === "GET" && path === "/api/health")
        return json(200, { ok: true });
      if (method === "GET" && path === "/auth/login") return await login();
      if (method === "GET" && path === "/auth/callback")
        return await callback(event);
      if (method === "POST" && path === "/auth/logout")
        return await logout(event);
      if (method === "GET" && path === "/api/me") return await me(event);
      if (method === "POST" && path === "/api/select")
        return await select(event);
      if (method === "GET" && path === "/api/roster")
        return await roster(event);
      return json(404, { error: "not_found" });
    } catch (error) {
      log.error?.("unhandled", { path, error: error?.message });
      return json(500, { error: "internal" });
    }
  }
}

/**
 * The request as the log names it: ids and tags replaced by `*` so one
 * route is one series, never a line per member.
 */
export function routeKey(method, path) {
  const generic = path
    .replace(/^\/api\/clans\/[0-9A-Za-z]+/, "/api/clans/*")
    .replace(/\/(actions|notes|holds|members)\/[^/]+/g, "/$1/*")
    .replace(/\/awards\/grants\/.+$/, "/awards/grants/*")
    .replace(/^(\/api\/(?:maintain\/)?feedback)\/[^/]+$/, "$1/*");
  return `${method} ${generic}`;
}

/** The roster as the page wants it: grouped by role rank, then trophies,
 *  the signed-in person's row marked, the API's role spelling kept beside
 *  its label. Nothing is added that the tool did not say. */
export function shapeRoster(body, { yourTags = [] }) {
  const yours = new Set(yourTags);
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
      you: yours.has(m.player_tag),
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
    your_tags: [...yours],
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
