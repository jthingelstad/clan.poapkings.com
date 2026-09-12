/** Same-origin /api/*, cookie-authed. Every answer is `{ ok, status, data }`;
 *  a non-JSON body (an edge error page) is a failure whatever its status. */

const TIMEOUT_MS = 20_000;

async function get(path) {
  let res;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: {},
      error: err?.name === "TimeoutError" ? "timeout" : "network",
    };
  }
  const text = await res.text();
  try {
    return {
      ok: res.ok,
      status: res.status,
      data: text ? JSON.parse(text) : {},
    };
  } catch {
    return { ok: false, status: res.status, data: {}, error: "bad_response" };
  }
}

async function post(path, body) {
  let res;
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
    return {
      ok: false,
      status: 0,
      data: {},
      error: err?.name === "TimeoutError" ? "timeout" : "network",
    };
  }
  const text = await res.text();
  try {
    return {
      ok: res.ok,
      status: res.status,
      data: text ? JSON.parse(text) : {},
    };
  } catch {
    return { ok: false, status: res.status, data: {}, error: "bad_response" };
  }
}

async function del(path) {
  let res;
  try {
    res = await fetch(path, {
      method: "DELETE",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: {},
      error: err?.name === "TimeoutError" ? "timeout" : "network",
    };
  }
  const text = await res.text();
  try {
    return {
      ok: res.ok,
      status: res.status,
      data: text ? JSON.parse(text) : {},
    };
  } catch {
    return { ok: false, status: res.status, data: {}, error: "bad_response" };
  }
}

async function put(path, body) {
  let res;
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
    return {
      ok: false,
      status: 0,
      data: {},
      error: err?.name === "TimeoutError" ? "timeout" : "network",
    };
  }
  const text = await res.text();
  try {
    return {
      ok: res.ok,
      status: res.status,
      data: text ? JSON.parse(text) : {},
    };
  } catch {
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
