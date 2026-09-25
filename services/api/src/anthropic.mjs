/**
 * Anthropic's API on a clan's own key (bring your own tokens, 2026-09-25):
 * the model list, which is how a key is checked when a leader adds it (it
 * spends nothing), and one message whose answer is a single forced tool
 * call, so a model's words arrive in the shape the engine checks. Elixir
 * Clan funds no model use; every call here is on the key it is handed.
 *
 * Timed into the request's trace (`timedModel`): the call, its time, its
 * status and its tokens. Never the key, the prompt or the answer. A
 * refusal carries Anthropic's own error type and message, which name the
 * problem (an invalid key, a low balance, an unknown model), never a key.
 */

import { timedModel } from "./trace.mjs";

export const ANTHROPIC_URL = "https://api.anthropic.com";
export const ANTHROPIC_VERSION = "2023-06-01";
/** Under the Lambda's 25 s and the gateway's 29 s, with room to answer. */
export const MODEL_TIMEOUT_MS = 20_000;

export function createAnthropicClient({
  fetch = globalThis.fetch,
  url = ANTHROPIC_URL,
  timeoutMs = MODEL_TIMEOUT_MS,
} = {}) {
  async function call(key, path, init) {
    let res;
    try {
      res = await fetch(`${url}${path}`, {
        ...init,
        headers: {
          "x-api-key": key,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      return {
        ok: false,
        status: 0,
        code: e?.name === "TimeoutError" ? "timeout" : "network",
      };
    }
    let body = null;
    try {
      body = await res.json();
    } catch {
      // An answer that is not JSON is judged by its status alone.
    }
    if (!res.ok)
      return {
        ok: false,
        status: res.status,
        code: body?.error?.type ?? "error",
        message: String(body?.error?.message ?? "").slice(0, 300) || null,
      };
    return { ok: true, status: res.status, body };
  }

  return {
    /** The models a key can reach: `{ ok, models: [{ id, name }] }`. */
    models(key) {
      return timedModel("models", async () => {
        const r = await call(key, "/v1/models?limit=100", { method: "GET" });
        if (!r.ok) return r;
        return {
          ok: true,
          status: r.status,
          models: (r.body?.data ?? [])
            .filter((m) => typeof m?.id === "string")
            .map((m) => ({ id: m.id, name: m.display_name ?? m.id })),
        };
      });
    },

    /**
     * One message answered by one call of `tool`: `{ ok, input, model,
     * usage }`, or a refusal. `system`, `prompt`, `tool` and `max_tokens`
     * come from the engine (`words.mjs`).
     */
    write(key, { model, system, prompt, tool, max_tokens }) {
      return timedModel("messages", async () => {
        const r = await call(key, "/v1/messages", {
          method: "POST",
          body: JSON.stringify({
            model,
            max_tokens,
            system,
            messages: [{ role: "user", content: prompt }],
            tools: [tool],
            tool_choice: { type: "tool", name: tool.name },
          }),
        });
        if (!r.ok) return r;
        const usage = {
          input_tokens: r.body?.usage?.input_tokens ?? null,
          output_tokens: r.body?.usage?.output_tokens ?? null,
        };
        const use = (r.body?.content ?? []).find(
          (c) => c?.type === "tool_use" && c.name === tool.name,
        );
        if (!use)
          return {
            ok: false,
            status: r.status,
            code: "no_answer",
            message: `The model stopped without an answer (${r.body?.stop_reason ?? "unknown"}).`,
            usage,
          };
        return {
          ok: true,
          status: r.status,
          input: use.input ?? null,
          model: r.body?.model ?? model,
          usage,
        };
      });
    },
  };
}
