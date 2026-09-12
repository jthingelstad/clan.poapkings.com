#!/usr/bin/env node
/**
 * Register Elixir Clan as a public OAuth client with Elixir (dynamic
 * client registration, no authentication, elixir.poapkings.com/docs/
 * protocol). Prints the client_id; set it on the stack with
 *
 *   node infra/scripts/deploy.mjs --param=OAuthClientId=<id>
 *
 * A registration lives 365 days from its last use. Re-run this and set
 * the parameter again when Elixir reports the client unknown.
 *
 *   node infra/scripts/register-client.mjs https://clan.poapkings.com [https://dxxxx.cloudfront.net]
 */

const elixir = (
  process.env.ELIXIR_URL ?? "https://elixir.poapkings.com"
).replace(/\/$/, "");
const origins = process.argv.slice(2);
if (origins.length === 0) {
  console.error("usage: register-client.mjs <origin> [<origin> ...]");
  process.exit(2);
}
const response = await fetch(`${elixir}/oauth/register`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({
    client_name: "Elixir Clan",
    redirect_uris: origins.map((o) => `${o.replace(/\/$/, "")}/auth/callback`),
  }),
});
const body = await response.json();
if (response.status !== 201) {
  console.error(
    `registration failed: ${response.status} ${JSON.stringify(body)}`,
  );
  process.exit(1);
}
console.log(JSON.stringify(body, null, 2));
