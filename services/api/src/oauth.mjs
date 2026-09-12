/**
 * OAuth 2.1 against Elixir, as a public client: discovery, PKCE, the
 * authorization URL, the code exchange and the refresh. Nothing here is
 * privileged; it is the same door any third-party MCP client uses
 * (elixir.poapkings.com/docs/protocol, "OAuth 2.1").
 *
 * Two facts from that page shape this file: `resource` is REQUIRED at
 * both the authorize and token steps and must be the exact door URL the
 * token is for (RFC 8707); and there is no client secret, PKCE is the
 * proof. Refresh rotates the pair on every use, and presenting an
 * already-rotated refresh token revokes the whole grant, so a refresh
 * must be stored before it is used again.
 */

import { createHash, randomBytes } from "node:crypto";

export const SCOPE = "cr:read";
const DISCOVERY_TTL_MS = 300_000;

export function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function randomState() {
  return randomBytes(24).toString("base64url");
}

export function createOAuthClient({
  issuer,
  resource,
  clientId,
  fetch: fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  if (!issuer) throw new Error("oauth client needs an issuer");
  if (!resource) throw new Error("oauth client needs a resource");
  let discovered = null;
  let discoveredAt = 0;

  async function discovery() {
    if (discovered && now() - discoveredAt < DISCOVERY_TTL_MS)
      return discovered;
    const response = await fetchImpl(
      `${issuer}/.well-known/oauth-authorization-server`,
      { headers: { accept: "application/json" } },
    );
    if (!response.ok) throw new Error(`discovery http ${response.status}`);
    const doc = await response.json();
    for (const key of ["authorization_endpoint", "token_endpoint"]) {
      if (typeof doc[key] !== "string")
        throw new Error(`discovery lacks ${key}`);
    }
    discovered = doc;
    discoveredAt = now();
    return doc;
  }

  async function tokenRequest(form) {
    const { token_endpoint } = await discovery();
    let response;
    try {
      response = await fetchImpl(token_endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams(form).toString(),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      return { ok: false, error: `transport: ${error.message}` };
    }
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: body?.error ?? `http ${response.status}`,
        description: body?.error_description,
      };
    }
    if (typeof body?.access_token !== "string")
      return { ok: false, error: "token response lacks access_token" };
    return {
      ok: true,
      tokens: {
        accessToken: body.access_token,
        refreshToken: body.refresh_token ?? null,
        // expires_in is seconds from now; store the instant.
        accessExpiresAt: now() + Number(body.expires_in ?? 3600) * 1000,
        scope: body.scope ?? "",
      },
    };
  }

  return {
    /** False until Elixir has issued a client_id (register-client.mjs). */
    configured: Boolean(clientId),
    discovery,

    /** Where to send the browser. `state` and the PKCE verifier are the
     *  caller's to keep until the callback. */
    async authorizationUrl({ redirectUri, state, codeChallenge }) {
      const { authorization_endpoint } = await discovery();
      const url = new URL(authorization_endpoint);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("scope", SCOPE);
      url.searchParams.set("resource", resource);
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      return url.toString();
    },

    exchange({ code, codeVerifier, redirectUri }) {
      return tokenRequest({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
        resource,
      });
    },

    refresh({ refreshToken }) {
      return tokenRequest({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: refreshToken,
        resource,
      });
    },
  };
}
