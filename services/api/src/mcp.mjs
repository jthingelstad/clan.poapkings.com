/**
 * A direct MCP client for Elixir's personal door: JSON-RPC over fetch,
 * one message per POST, JSON only (Elixir's protocol page: no SSE, no
 * sessions, no batches). The pattern is elixir-mcp-discord's src/mcp.js,
 * written fresh: that client holds one service token for its whole life,
 * this one is handed a bearer per call because every call here is on
 * behalf of a signed-in person and their token rotates.
 *
 * Error contract: every helper returns `{ ok: true, ... }` or
 * `{ ok: false, error, status?, code?, body? }`. Nothing throws across the
 * module boundary. `status` is the HTTP status when the door refused the
 * request (401 is how an expired access token surfaces); `code` is a tool
 * failure's closed-set code (`not_recorded`, `no_subject`, ...).
 */

export const PRINCIPAL_META_KEY = "elixir.poapkings.com/principal";
const TIMEOUT_MS = 20_000;
export const CLIENT_INFO = { name: "elixir-clan", version: "0.1.0" };

export function createMcpClient({
  url,
  fetch: fetchImpl = globalThis.fetch,
} = {}) {
  if (!url) throw new Error("mcp client needs a door url");
  let nextId = 0;

  async function rpc(token, method, params) {
    const id = ++nextId;
    let response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
          "mcp-protocol-version": "2025-06-18",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      return { ok: false, error: `transport: ${error.message}` };
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: `http ${response.status}`,
      };
    }
    let envelope;
    try {
      envelope = await response.json();
    } catch (error) {
      return { ok: false, error: `malformed envelope: ${error.message}` };
    }
    if (envelope.error) {
      return {
        ok: false,
        error: `rpc ${envelope.error.code}: ${envelope.error.message}`,
        rpcCode: envelope.error.code,
      };
    }
    return { ok: true, body: envelope.result };
  }

  return {
    /** The handshake. The principal block in `_meta` is the fact the gate
     *  reads first; `instructions` is prose for a model and is ignored. */
    async initialize(token) {
      const result = await rpc(token, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: CLIENT_INFO,
      });
      if (!result.ok) return result;
      const block = result.body?._meta?.[PRINCIPAL_META_KEY];
      return {
        ok: true,
        body: result.body,
        version: result.body?.serverInfo?.version ?? null,
        principal: block && typeof block === "object" ? block : null,
      };
    },

    /** One tools/call, unwrapped to the tool's parsed JSON body. A failed
     *  call (isError) is `{ ok: false, code, error, body }` so a caller can
     *  branch on the closed-set code rather than the English. */
    async callTool(token, name, args = {}) {
      const result = await rpc(token, "tools/call", { name, arguments: args });
      if (!result.ok) return result;
      const text = result.body?.content?.[0]?.text;
      if (typeof text !== "string") {
        return { ok: false, error: "no text content in tool result" };
      }
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        return { ok: false, error: "tool answered non-JSON text" };
      }
      if (result.body?.isError) {
        return {
          ok: false,
          code: body?.error?.code ?? "unknown",
          error: body?.error?.message ?? "tool error",
          hint: body?.error?.hint,
          body,
        };
      }
      return { ok: true, body };
    },
  };
}
