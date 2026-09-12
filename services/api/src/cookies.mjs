/**
 * Two `__Host-` cookies, like Elixir's own session cookie: HttpOnly,
 * Secure, SameSite=Lax, Path=/, no Domain. The session cookie is an
 * opaque id plus an HMAC over it, so a forged or edited id is refused
 * before the table is asked. The signing secret arrives from Secrets
 * Manager through the Lambda environment (a `{{resolve:secretsmanager}}`
 * reference in the template); this module never reads it from anywhere
 * else.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "__Host-elixir_clan_session";
export const LOGIN_COOKIE = "__Host-elixir_clan_login";
export const SESSION_COOKIE_MAX_AGE_S = 90 * 24 * 3600;
export const LOGIN_COOKIE_MAX_AGE_S = 600;

const attrs = "Path=/; Secure; HttpOnly; SameSite=Lax";

export function newSessionId() {
  return randomBytes(32).toString("base64url");
}

function sign(secret, id) {
  return createHmac("sha256", secret).update(id).digest("base64url");
}

export function sessionCookieValue(secret, id) {
  return `${id}.${sign(secret, id)}`;
}

/** The session id, or null when the cookie is missing, malformed or
 *  carries a signature that does not match. */
export function verifySessionCookie(secret, value) {
  if (typeof value !== "string") return null;
  const dot = value.lastIndexOf(".");
  if (dot < 1) return null;
  const id = value.slice(0, dot);
  const given = value.slice(dot + 1);
  const expected = sign(secret, id);
  if (given.length !== expected.length) return null;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected)) ? id : null;
}

export function setSessionCookie(secret, id) {
  return `${SESSION_COOKIE}=${sessionCookieValue(secret, id)}; ${attrs}; Max-Age=${SESSION_COOKIE_MAX_AGE_S}`;
}
export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; ${attrs}; Max-Age=0`;
}
export function setLoginCookie(state) {
  return `${LOGIN_COOKIE}=${state}; ${attrs}; Max-Age=${LOGIN_COOKIE_MAX_AGE_S}`;
}
export function clearLoginCookie() {
  return `${LOGIN_COOKIE}=; ${attrs}; Max-Age=0`;
}

/** Cookies as the HTTP API v2 event carries them (`cookies: []`), with the
 *  raw header as a fallback for a local runner. */
export function readCookies(event) {
  const list = event.cookies ?? String(event.headers?.cookie ?? "").split("; ");
  const out = {};
  for (const c of list) {
    const eq = c.indexOf("=");
    if (eq < 1) continue;
    out[c.slice(0, eq)] = c.slice(eq + 1);
  }
  return out;
}
