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
