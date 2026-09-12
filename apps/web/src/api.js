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

export const api = {
  me: (refresh = false) => get(refresh ? "/api/me?refresh=1" : "/api/me"),
  roster: (refresh = false) =>
    get(refresh ? "/api/roster?refresh=1" : "/api/roster"),
};
