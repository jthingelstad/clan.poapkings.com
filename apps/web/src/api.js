/** Same-origin /api/*, cookie-authed. Every answer is `{ ok, status, data }`;
 *  a non-JSON body (an edge error page) is a failure whatever its status. */

import { routeLabel, trackEvent } from "./analytics.js";

const TIMEOUT_MS = 20_000;
/** A request the person waited this long for is said so in the console,
 *  with the server's own timing beside the wall clock: the difference is
 *  the time in front of the edge, which no server log can see. */
const SLOW_MS = 3_000;

function report(method, path, started, res, error) {
  const ms = Math.round(performance.now() - started);
  // A failure that never reached the origin is the class of problem only
  // the browser can count (Elixir's lesson); a slow one is counted too.
  if (error) trackEvent(`web.api_${error}`, routeLabel(method, path));
  else if (ms >= SLOW_MS) trackEvent("web.api_slow", routeLabel(method, path));
  if (ms < SLOW_MS && !error) return;
  const timing = res?.headers?.get?.("server-timing") ?? null;
  console.warn("[elixir-clan] slow request", {
    request: `${method} ${path}`,
    wall_ms: ms,
    status: res?.status ?? 0,
    server_timing: timing,
    ...(error ? { error } : {}),
  });
}

async function get(path) {
  let res;
  const started = performance.now();
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    report(
      "GET",
      path,
      started,
      null,
      err?.name === "TimeoutError" ? "timeout" : "network",
    );
    return {
      ok: false,
      status: 0,
      data: {},
      error: err?.name === "TimeoutError" ? "timeout" : "network",
    };
  }
  const text = await res.text();
  report("GET", path, started, res);
  try {
    return {
      ok: res.ok,
      status: res.status,
      data: text ? JSON.parse(text) : {},
    };
  } catch {
    trackEvent("web.api_bad_response", routeLabel("GET", path));
    return { ok: false, status: res.status, data: {}, error: "bad_response" };
  }
}

async function post(path, body) {
  let res;
  const started = performance.now();
  try {
    res = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    report(
      "POST",
      path,
      started,
      null,
      err?.name === "TimeoutError" ? "timeout" : "network",
    );
    return {
      ok: false,
      status: 0,
      data: {},
      error: err?.name === "TimeoutError" ? "timeout" : "network",
    };
  }
  const text = await res.text();
  report("POST", path, started, res);
  try {
    return {
      ok: res.ok,
      status: res.status,
      data: text ? JSON.parse(text) : {},
    };
  } catch {
    trackEvent("web.api_bad_response", routeLabel("POST", path));
    return { ok: false, status: res.status, data: {}, error: "bad_response" };
  }
}

async function del(path) {
  let res;
  const started = performance.now();
  try {
    res = await fetch(path, {
      method: "DELETE",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    report(
      "DELETE",
      path,
      started,
      null,
      err?.name === "TimeoutError" ? "timeout" : "network",
    );
    return {
      ok: false,
      status: 0,
      data: {},
      error: err?.name === "TimeoutError" ? "timeout" : "network",
    };
  }
  const text = await res.text();
  report("DELETE", path, started, res);
  try {
    return {
      ok: res.ok,
      status: res.status,
      data: text ? JSON.parse(text) : {},
    };
  } catch {
    trackEvent("web.api_bad_response", routeLabel("DELETE", path));
    return { ok: false, status: res.status, data: {}, error: "bad_response" };
  }
}

async function put(path, body) {
  let res;
  const started = performance.now();
  try {
    res = await fetch(path, {
      method: "PUT",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    report(
      "PUT",
      path,
      started,
      null,
      err?.name === "TimeoutError" ? "timeout" : "network",
    );
    return {
      ok: false,
      status: 0,
      data: {},
      error: err?.name === "TimeoutError" ? "timeout" : "network",
    };
  }
  const text = await res.text();
  report("PUT", path, started, res);
  try {
    return {
      ok: res.ok,
      status: res.status,
      data: text ? JSON.parse(text) : {},
    };
  } catch {
    trackEvent("web.api_bad_response", routeLabel("PUT", path));
    return { ok: false, status: res.status, data: {}, error: "bad_response" };
  }
}

const clanBase = (tag) => `/api/clans/${String(tag).replace(/^#/, "")}`;

export const manageApi = {
  manage: (tag, refresh = false) =>
    get(`${clanBase(tag)}/manage${refresh ? "?refresh=1" : ""}`),
  history: (tag) => get(`${clanBase(tag)}/history`),
  policy: (tag) => get(`${clanBase(tag)}/policy`),
  savePolicy: (tag, values, note) =>
    post(`${clanBase(tag)}/policy`, { values, note }),
  previewPolicy: (tag, values) =>
    post(`${clanBase(tag)}/policy/preview`, { values }),
  decide: (tag, cardId, body) =>
    post(`${clanBase(tag)}/cards/${cardId}/decide`, body),
  setHold: (tag, playerTag, body) =>
    put(`${clanBase(tag)}/holds/${String(playerTag).replace(/^#/, "")}`, body),
  clearHold: (tag, playerTag) =>
    del(`${clanBase(tag)}/holds/${String(playerTag).replace(/^#/, "")}`),
  notes: (tag, playerTag) =>
    get(
      `${clanBase(tag)}/members/${String(playerTag).replace(/^#/, "")}/notes`,
    ),
  addNote: (tag, playerTag, text) =>
    post(
      `${clanBase(tag)}/members/${String(playerTag).replace(/^#/, "")}/notes`,
      { text },
    ),
  removeNote: (tag, noteId) => del(`${clanBase(tag)}/notes/${noteId}`),
  standing: (tag) => get(`${clanBase(tag)}/standing`),
  scout: (tag, playerTag) => post(`${clanBase(tag)}/scout`, { tag: playerTag }),
  howElderWorks: (tag) => get(`${clanBase(tag)}/how-elder-works`),
  // Away: the member's own word (2026-09-12).
  myAway: (tag) => get(`${clanBase(tag)}/me/away`),
  setAway: (tag, body) => put(`${clanBase(tag)}/me/away`, body),
  clearAway: (tag) => del(`${clanBase(tag)}/me/away`),
  // Awards (2026-09-12): the leader view, the document, grants by hand,
  // and a member's trophy case.
  awards: (tag, refresh = false) =>
    get(`${clanBase(tag)}/awards/manage${refresh ? "?refresh=1" : ""}`),
  saveAwards: (tag, values, note) =>
    post(`${clanBase(tag)}/awards/config`, { values, note }),
  grantAward: (tag, body) => post(`${clanBase(tag)}/awards/grants`, body),
  revokeAward: (tag, seasonId, awardId, playerTag) =>
    del(
      `${clanBase(tag)}/awards/grants/${seasonId}/${awardId}/${String(playerTag).replace(/^#/, "")}`,
    ),
  memberAwards: (tag, playerTag) =>
    get(
      `${clanBase(tag)}/members/${String(playerTag).replace(/^#/, "")}/awards`,
    ),
};

export const feedbackApi = {
  list: () => get("/api/feedback"),
  file: (body) => post("/api/feedback", body),
  item: (id) => get(`/api/feedback/${id}`),
  queue: () => get("/api/maintain/feedback"),
  decide: (id, body) => post(`/api/maintain/feedback/${id}`, body),
};

export const api = {
  me: (refresh = false) => get(refresh ? "/api/me?refresh=1" : "/api/me"),
  roster: (clanTag, refresh = false) => {
    const q = new URLSearchParams();
    if (clanTag) q.set("clan", clanTag);
    if (refresh) q.set("refresh", "1");
    const qs = q.toString();
    return get(qs ? `/api/roster?${qs}` : "/api/roster");
  },
  select: (clanTag) => post("/api/select", { clan_tag: clanTag }),
};
