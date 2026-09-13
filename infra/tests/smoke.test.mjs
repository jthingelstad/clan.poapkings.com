import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("the default deployment smoke makes only reads that cannot create a login or change member data", () => {
  const mockFetch = `
    globalThis.fetch = async (url, init = {}) => {
      const path = new URL(url).pathname;
      console.log("REQUEST " + (init.method ?? "GET") + " " + path);
      const headers = {"content-security-policy": "script-src 'self' https://tinylytics.app", "strict-transport-security": "max-age=31536000", "cache-control": "public, max-age=300"};
      let body = "Elixir Clan", status = 200;
      if (path === "/nope.txt") status = 404;
      if (path === "/api/health") body = JSON.stringify({ok:true});
      if (path === "/api/me") { status = 401; body = JSON.stringify({signed_in:false}); }
      if (path.endsWith("/awards")) { status = 404; body = JSON.stringify({error:"not_published"}); }
      if (path === "/auth/login") {
        status = 303;
        headers.location = "https://elixir.test/oauth/authorize?scope=cr%3Aread&code_challenge_method=S256&redirect_uri=https%3A%2F%2Fclan.test%2Fauth%2Fcallback";
        headers["set-cookie"] = "__Host-elixir_clan_login=fixture";
      }
      return new Response(body, {status, headers});
    };
  `;
  const output = execFileSync(
    process.execPath,
    [
      "--import",
      `data:text/javascript,${encodeURIComponent(mockFetch)}`,
      "infra/scripts/smoke.mjs",
    ],
    {
      cwd: new URL("../../", import.meta.url),
      env: { ...process.env, SMOKE_ORIGIN: "https://clan.test" },
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.match(output, /smoke passed/);
  const requests = output
    .split("\n")
    .filter((line) => line.startsWith("REQUEST "));
  assert.deepEqual(requests, [
    "REQUEST GET /",
    "REQUEST GET /clan",
    "REQUEST GET /nope.txt",
    "REQUEST GET /api/health",
    "REQUEST GET /api/me",
    "REQUEST GET /api/clans/J2RGCRVG/awards",
  ]);
});
