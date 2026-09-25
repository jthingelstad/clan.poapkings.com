/**
 * Elixir's JSON API (/api/v1) as Clan's one door to Elixir (2026-09-23).
 * Clan is a program, not an agent, so it reads Elixir the way a program
 * does: through the versioned JSON API, with the signed-in person's OAuth
 * grant for https://elixir.poapkings.com/api/v1 (plan:
 * elixir-family/plans/clan-app-api.md). It used to read through MCP, and
 * the eight-week participation read outgrew MCP's agent-sized result cap
 * at 48 members.
 *
 * The client keeps the shape the MCP client had, so the gate, the manage
 * service, scout and recruit are unchanged:
 *   initialize(token)             -> { ok, principal, version } from GET /me
 *   callTool(token, name, args)   -> { ok, body } | { ok:false, code, error, hint, body, status }
 * Each tool name maps to one /api/v1 operation, and each operation answers
 * with that tool's structured result. A refusal comes back as
 * application/problem+json and is unwrapped to the same `{ code, error,
 * hint, body: { error: { ... } } }` the MCP client returned, so a caller
 * still branches on the closed-set code (not_recorded, live_pending, ...).
 * Nothing throws across the module boundary.
 */

import { timedElixir } from "./trace.mjs";

const TIMEOUT_MS = 20_000;

const enc = (tag) => encodeURIComponent(tag);

/** Tool name -> the /api/v1 request that answers it. */
function requestFor(name, args) {
  switch (name) {
    case "elixir_my_players":
      return {
        method: "GET",
        path: "/me",
        wrap: (d) => ({
          players: d.players,
          meta: { as_of: new Date().toISOString() },
        }),
      };
    case "clans_participation":
      return {
        method: "GET",
        path: `/clans/${enc(args.clan_tag)}/participation`,
        query: args.weeks === undefined ? {} : { weeks: args.weeks },
      };
    case "clans_roster":
      return { method: "GET", path: `/clans/${enc(args.clan_tag)}/roster` };
    case "players_names":
      return {
        method: "POST",
        path: "/players/names",
        body: { player_tags: args.player_tags },
      };
    case "players_profile":
      return {
        method: "GET",
        path: `/players/${enc(args.player_tag)}/profile`,
        query: args.live ? { fresh: 1 } : {},
      };
    case "battles_query":
      return {
        method: "GET",
        path: `/players/${enc(args.player_tag)}/battles`,
        query: {
          ...(args.limit === undefined ? {} : { limit: args.limit }),
          ...(args.live ? { fresh: 1 } : {}),
        },
      };
    case "live_fetch": {
      const m = /^\/clans\/([^/]+)$/.exec(String(args.path ?? ""));
      if (!m) return null;
      return {
        method: "GET",
        path: `/clans/${enc(decodeURIComponent(m[1]))}/live`,
      };
    }
    default:
      return null;
  }
}

export function createElixirApiClient({
  url,
  fetch: fetchImpl = globalThis.fetch,
} = {}) {
  if (!url) throw new Error("elixir api client needs a base url");
  const base = `${url.replace(/\/$/, "")}/api/v1`;

  async function request(token, { method, path, query, body }) {
    const qs = new URLSearchParams(
      Object.entries(query ?? {}).map(([k, v]) => [k, String(v)]),
    ).toString();
    let response;
    try {
      response = await fetchImpl(`${base}${path}${qs ? `?${qs}` : ""}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      return { ok: false, error: `transport: ${error.message}` };
    }
    let text = "";
    let parsed = null;
    try {
      text = await response.text();
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (response.ok && parsed && typeof parsed === "object")
      return { ok: true, data: parsed.data, bytes: text.length };
    // 401 is how an expired or wrong-audience token surfaces; the handler
    // refreshes and retries on it, as it did for MCP.
    const code = parsed?.code ?? null;
    return {
      ok: false,
      status: response.status,
      code: code ?? undefined,
      error: parsed?.detail ?? `http ${response.status}`,
      hint: parsed?.hint,
      body: code
        ? {
            error: {
              code,
              message: parsed?.detail ?? code,
              ...(parsed?.hint ? { hint: parsed.hint } : {}),
              ...(parsed?.retry_after_s !== undefined
                ? { retry_after_s: parsed.retry_after_s }
                : {}),
            },
          }
        : undefined,
      bytes: text.length,
    };
  }

  return {
    /** Who the token belongs to: the principal block MCP's initialize
     *  carried in _meta, now GET /api/v1/me. */
    initialize(token) {
      return timedElixir("me", async () => {
        const r = await request(token, { method: "GET", path: "/me" });
        if (!r.ok) return r;
        const principal = r.data?.principal;
        return {
          ok: true,
          body: r.data,
          version: null,
          principal:
            principal && typeof principal === "object" ? principal : null,
        };
      });
    },

    /** Share a fact about the clan with Elixir (JSON API 2.2.0): an
     *  attested fact, on the person's own grant (clans:attest). */
    writeFact(token, clanTag, fact) {
      return timedElixir("clan_fact", async () => {
        const r = await request(token, {
          method: "POST",
          path: `/clans/${enc(clanTag)}/facts`,
          body: fact,
        });
        return r.ok ? { ok: true, body: r.data } : r;
      });
    },

    /** Take a shared fact back, by the ref Clan gave it; one Elixir no
     *  longer holds is already gone. */
    removeFact(token, clanTag, ref) {
      return timedElixir("clan_fact_remove", async () => {
        const r = await request(token, {
          method: "DELETE",
          path: `/clans/${enc(clanTag)}/facts/${encodeURIComponent(ref)}`,
        });
        if (!r.ok && r.status === 404) return { ok: true, gone: true };
        return r.ok ? { ok: true, body: r.data } : r;
      });
    },

    /** One read, named as the tool it used to be: the body is that tool's
     *  structured result, and a refusal keeps the tool's code. */
    callTool(token, name, args = {}) {
      return timedElixir(name, async () => {
        const req = requestFor(name, args);
        if (!req)
          return { ok: false, error: `no JSON API operation for ${name}` };
        const r = await request(token, req);
        if (!r.ok) return r;
        return {
          ok: true,
          body: req.wrap ? req.wrap(r.data) : r.data,
          bytes: r.bytes,
        };
      });
    },
  };
}
