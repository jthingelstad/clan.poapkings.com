/**
 * One story per request (2026-09-12, after "several requests in the
 * browser are very slow" and a log group holding nothing but START, END
 * and REPORT: 146 invocations in six hours, p90 2.7 s, five of them 16 to
 * 22 s, and not one line saying where the time went).
 *
 * A request opens a trace; every Elixir call, every call to a clan's own
 * model and every table operation made on its behalf is timed into it (AsyncLocalStorage, so nothing is
 * threaded through arguments); the handler closes it with ONE JSON line
 * (the route, the status, the total, each upstream call with its
 * duration and Elixir's own request_id for correlation) and a
 * Server-Timing header so
 * the browser's own timing can be read against the server's. Time spent
 * in front of the edge is the difference.
 *
 * Never a token, never a cookie, never a body. Tags are in-game public.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage();

/** A single upstream call slower than this gets its own warning line. */
export const SLOW_CALL_MS = 5_000;
/** A request slower than this is logged at warn level, not info. */
export const SLOW_REQUEST_MS = 8_000;

let coldStart = true;

/** Start a trace and run `fn` inside it. Returns fn's result. */
export function withTrace(meta, fn) {
  const trace = {
    started: Date.now(),
    meta,
    elixir: [],
    model: [],
    store: [],
    notes: [],
    cold: coldStart,
  };
  coldStart = false;
  return storage.run(trace, fn);
}

export function current() {
  return storage.getStore() ?? null;
}

/** Add a fact to the request's line (the route it resolved to, the clan). */
export function annotate(fields) {
  const t = current();
  if (t) Object.assign(t.meta, fields);
}

/** Time one Elixir call into the trace. `describe(result)` names it. */
export async function timedElixir(label, fn) {
  const t = current();
  const started = Date.now();
  const result = await fn();
  const ms = Date.now() - started;
  const entry = {
    call: label,
    ms,
    ok: result?.ok !== false,
    ...(result?.status ? { status: result.status } : {}),
    ...(result?.code ? { code: result.code } : {}),
    ...(result?.rpcCode !== undefined ? { rpc: result.rpcCode } : {}),
    // Elixir stamps meta.request_id on every tool answer: the key that
    // opens ITS call log for this same call.
    ...(result?.body?.meta?.request_id
      ? { request_id: result.body.meta.request_id }
      : {}),
    ...(result?.bytes ? { bytes: result.bytes } : {}),
  };
  if (t) t.elixir.push(entry);
  if (ms >= SLOW_CALL_MS)
    console.warn(
      JSON.stringify({
        at: new Date().toISOString(),
        level: "warn",
        slow_elixir_call: entry,
        http: t?.meta?.http ?? null,
      }),
    );
  return result;
}

/** Time one table operation into the trace. */
export async function timedStore(op, fn) {
  const t = current();
  const started = Date.now();
  try {
    return await fn();
  } finally {
    if (t) t.store.push({ op, ms: Date.now() - started });
  }
}

/**
 * Time one call to a clan's own model (Anthropic, on the clan's key) into
 * the trace: the call, its time, its status and the tokens it spent.
 * Never the key, the prompt or the answer.
 */
export async function timedModel(label, fn) {
  const t = current();
  const started = Date.now();
  const result = await fn();
  const entry = {
    call: label,
    ms: Date.now() - started,
    ok: result?.ok !== false,
    ...(result?.status ? { status: result.status } : {}),
    ...(result?.code ? { code: result.code } : {}),
    ...(result?.usage
      ? {
          input_tokens: result.usage.input_tokens,
          output_tokens: result.usage.output_tokens,
        }
      : {}),
  };
  if (t) t.model.push(entry);
  return result;
}

/** Close the trace: the summary the handler logs and stamps. */
export function summarize(trace, status) {
  const ms = Date.now() - trace.started;
  const elixirMs = trace.elixir.reduce((s, c) => s + c.ms, 0);
  const storeMs = trace.store.reduce((s, c) => s + c.ms, 0);
  const models = trace.model ?? [];
  const modelMs = models.reduce((s, c) => s + c.ms, 0);
  return {
    at: new Date().toISOString(),
    level: ms >= SLOW_REQUEST_MS || status >= 500 ? "warn" : "info",
    ...trace.meta,
    status,
    ms,
    elixir_ms: elixirMs,
    elixir_calls: trace.elixir.length,
    store_ms: storeMs,
    store_ops: trace.store.length,
    ...(models.length ? { model_ms: modelMs, model_calls: models.length } : {}),
    ...(trace.cold ? { cold: true } : {}),
    ...(trace.elixir.length ? { elixir: trace.elixir } : {}),
    ...(models.length ? { model: models } : {}),
    ...(trace.notes.length ? { notes: trace.notes } : {}),
  };
}

/** The Server-Timing header: total, Elixir, the table, the rest. */
export function serverTiming(summary) {
  const modelMs = summary.model_ms ?? 0;
  const own = Math.max(
    0,
    summary.ms - summary.elixir_ms - summary.store_ms - modelMs,
  );
  return [
    `total;dur=${summary.ms}`,
    `elixir;dur=${summary.elixir_ms};desc="${summary.elixir_calls} calls"`,
    ...(summary.model_calls
      ? [`model;dur=${modelMs};desc="${summary.model_calls} calls"`]
      : []),
    `store;dur=${summary.store_ms};desc="${summary.store_ops} ops"`,
    `own;dur=${own}`,
    ...(summary.cold ? ["cold"] : []),
  ].join(", ");
}
