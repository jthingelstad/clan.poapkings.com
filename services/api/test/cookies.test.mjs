import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sessionCookieValue,
  verifySessionCookie,
  setSessionCookie,
  readCookies,
} from "../src/cookies.mjs";

test("session cookie: signed value round-trips, a tampered one is refused", () => {
  const v = sessionCookieValue("s", "abc");
  assert.equal(verifySessionCookie("s", v), "abc");
  assert.equal(verifySessionCookie("other", v), null);
  assert.equal(verifySessionCookie("s", `${v}x`), null);
  assert.equal(verifySessionCookie("s", "abc"), null);
  assert.equal(verifySessionCookie("s", undefined), null);
});

test("session cookie: __Host- prefix with the attributes the prefix requires", () => {
  const c = setSessionCookie("s", "abc");
  assert.match(c, /^__Host-elixir_clan_session=abc\./);
  for (const attr of ["Path=/", "Secure", "HttpOnly", "SameSite=Lax"])
    assert.ok(c.includes(attr), attr);
  assert.ok(!c.includes("Domain="));
});

test("readCookies takes the HTTP API v2 array or the raw header", () => {
  assert.deepEqual(readCookies({ cookies: ["a=1", "b=2=3"] }), {
    a: "1",
    b: "2=3",
  });
  assert.deepEqual(readCookies({ headers: { cookie: "a=1; b=2" } }), {
    a: "1",
    b: "2",
  });
});
