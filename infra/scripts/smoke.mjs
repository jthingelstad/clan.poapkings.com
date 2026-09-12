#!/usr/bin/env node
/**
 * Read-only checks against the deployed site. Runs after every deploy;
 * no sign-in, no spend. The one write it causes is a pending-login item
 * with a ten-minute TTL, from following /auth/login as far as the
 * redirect to Elixir.
 *
 *   node infra/scripts/smoke.mjs            the stack's AppUrl (or its CloudFront hostname)
 *   SMOKE_ORIGIN=https://... node infra/scripts/smoke.mjs
 */

import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import { REGION, STACK } from "./stack.mjs";

async function origin() {
  if (process.env.SMOKE_ORIGIN)
    return process.env.SMOKE_ORIGIN.replace(/\/$/, "");
  const cfn = new CloudFormationClient({ region: REGION });
  const { Stacks } = await cfn.send(
    new DescribeStacksCommand({ StackName: STACK }),
  );
  // The app's own origin decides the OAuth redirect_uri, so that is where
  // the login check has to run; before AppUrl is set, the distribution.
  const appUrl = Stacks[0].Parameters?.find(
    (p) => p.ParameterKey === "AppUrl",
  )?.ParameterValue;
  if (appUrl) return appUrl.replace(/\/$/, "");
  const domain = Stacks[0].Outputs.find(
    (o) => o.OutputKey === "DistributionDomainName",
  ).OutputValue;
  return `https://${domain}`;
}

async function fetchRetry(url, init, attempts = 6) {
  let last;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
        ...init,
      });
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw last;
}

const base = await origin();
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push(ok);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};

const home = await fetchRetry(`${base}/`);
const homeText = await home.text();
check(
  "GET / is the app shell",
  home.status === 200 && homeText.includes("Elixir Clan"),
  String(home.status),
);
check(
  "security headers present",
  Boolean(home.headers.get("content-security-policy")) &&
    Boolean(home.headers.get("strict-transport-security")),
);

const route = await fetchRetry(`${base}/clan`);
check(
  "GET /clan serves the app shell (SPA router)",
  route.status === 200 && (await route.text()).includes("Elixir Clan"),
  String(route.status),
);

const missing = await fetchRetry(`${base}/nope.txt`);
check(
  "a missing file is honestly a miss",
  missing.status === 403 || missing.status === 404,
  String(missing.status),
);

const health = await fetchRetry(`${base}/api/health`);
let healthBody = {};
try {
  healthBody = await health.json();
} catch {
  healthBody = {};
}
check(
  "GET /api/health",
  health.status === 200 && healthBody.ok === true,
  String(health.status),
);

const me = await fetchRetry(`${base}/api/me`);
let meBody = {};
try {
  meBody = await me.json();
} catch {
  meBody = {};
}
check(
  "GET /api/me signed out is 401 JSON",
  me.status === 401 && meBody.signed_in === false,
  String(me.status),
);

// The public awards document: a GET with no session answers JSON either
// way (the document, or 404 not_published) and carries its cache header.
const awards = await fetchRetry(`${base}/api/clans/J2RGCRVG/awards`);
let awardsBody = {};
try {
  awardsBody = await awards.json();
} catch {
  awardsBody = {};
}
check(
  "GET /api/clans/<TAG>/awards is public JSON",
  (awards.status === 200 && Array.isArray(awardsBody.seasons)) ||
    (awards.status === 404 && awardsBody.error === "not_published"),
  String(awards.status),
);
check(
  "the awards document is edge-cacheable",
  (awards.headers.get("cache-control") ?? "").includes("max-age=300"),
);

const login = await fetchRetry(`${base}/auth/login`);
const location = login.headers.get("location") ?? "";
const loginOk =
  login.status === 303 &&
  location.includes("/oauth/authorize") &&
  location.includes("scope=cr%3Aread") &&
  location.includes("code_challenge_method=S256") &&
  location.includes(
    `redirect_uri=${encodeURIComponent(`${base}/auth/callback`)}`,
  );
check(
  "GET /auth/login sends the browser to Elixir with cr:read and PKCE",
  loginOk,
  loginOk ? "" : `${login.status} ${location.slice(0, 120)}`,
);
check(
  "login sets the __Host- login cookie",
  (login.headers.get("set-cookie") ?? "").includes("__Host-elixir_clan_login="),
);

if (checks.every(Boolean)) {
  console.log(`smoke passed at ${base}`);
} else {
  console.error(`smoke FAILED at ${base}`);
  process.exit(1);
}
