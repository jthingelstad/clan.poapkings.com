/**
 * The token requests: a configured client secret rides both grants as
 * client_secret in the form (client_secret_post), none rides without
 * one, and no log line ever carries the form.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createOAuthClient } from "../src/oauth.mjs";
import { SLOW_CALL_MS, current, summarize, withTrace } from "../src/trace.mjs";

const ISSUER = "https://elixir.test";
const SECRET = "ecs_test-secret-never-logged";

function fakeFetch({ tokenStatus = 200, slow = false } = {}) {
  const tokenForms = [];
  async function fetchImpl(url, init = {}) {
    if (url === `${ISSUER}/.well-known/oauth-authorization-server`) {
      return Response.json({
        authorization_endpoint: `${ISSUER}/oauth/authorize`,
        token_endpoint: `${ISSUER}/oauth/token`,
      });
    }
    assert.equal(url, `${ISSUER}/oauth/token`);
    assert.equal(init.method, "POST");
    tokenForms.push(Object.fromEntries(new URLSearchParams(init.body)));
    if (slow) mock.timers.tick(SLOW_CALL_MS);
    if (tokenStatus !== 200)
      return Response.json(
        { error: "invalid_grant", error_description: "no" },
        { status: tokenStatus },
      );
    return Response.json({
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3600,
      scope: "cr:read",
    });
  }
  return { fetchImpl, tokenForms };
}

function client(fetchImpl, clientSecret) {
  return createOAuthClient({
    issuer: ISSUER,
    resource: `${ISSUER}/api/v1`,
    clientId: "cid",
    ...(clientSecret === undefined ? {} : { clientSecret }),
    fetch: fetchImpl,
  });
}

async function bothGrants(oauth) {
  const exchanged = await oauth.exchange({
    code: "code",
    codeVerifier: "verifier",
    redirectUri: "https://clan.test/auth/callback",
  });
  const refreshed = await oauth.refresh({ refreshToken: "rt-old" });
  return [exchanged, refreshed];
}

test("with a secret, both token requests carry client_secret beside client_id", async () => {
  const { fetchImpl, tokenForms } = fakeFetch();
  const results = await bothGrants(client(fetchImpl, SECRET));
  assert.ok(results.every((r) => r.ok));
  assert.deepEqual(
    tokenForms.map((f) => f.grant_type),
    ["authorization_code", "refresh_token"],
  );
  for (const form of tokenForms) {
    assert.equal(form.client_id, "cid");
    assert.equal(form.client_secret, SECRET);
  }
});

test("without a secret, neither token request carries client_secret", async () => {
  for (const secret of [undefined, ""]) {
    const { fetchImpl, tokenForms } = fakeFetch();
    const results = await bothGrants(client(fetchImpl, secret));
    assert.ok(results.every((r) => r.ok));
    assert.equal(tokenForms.length, 2);
    for (const form of tokenForms) {
      assert.equal(form.client_id, "cid");
      assert.equal("client_secret" in form, false);
    }
  }
});

test("no log line carries the form: not the secret, the code, the verifier or a token", async (t) => {
  const printed = [];
  for (const level of ["log", "info", "warn", "error"])
    t.mock.method(console, level, (...args) => printed.push(args.join(" ")));
  mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  t.after(() => mock.timers.reset());

  // The request's own line, as the handler writes it at the end.
  const lines = [];
  for (const options of [{ slow: true }, { tokenStatus: 400, slow: true }]) {
    const { fetchImpl } = fakeFetch(options);
    const oauth = client(fetchImpl, SECRET);
    await withTrace({ http: "GET /auth/callback" }, async () => {
      await bothGrants(oauth);
      lines.push(JSON.stringify(summarize(current(), 200)));
    });
  }
  // The slow calls were logged on their own lines.
  assert.ok(printed.some((line) => line.includes("slow_elixir_call")));
  const everything = [...printed, ...lines].join("\n");
  for (const needle of [SECRET, "verifier", "rt-old", "code_verifier"])
    assert.equal(everything.includes(needle), false, needle);
});
