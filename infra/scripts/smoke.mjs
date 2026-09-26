#!/usr/bin/env node
/**
 * Read-only checks against the deployed site. Runs after every deploy;
 * no sign-in, no spend, no writes. /auth/login is deliberately excluded:
 * even its GET creates a pending-login item. The injected handler tests
 * cover the OAuth redirect, cr:read, PKCE and login cookie offline.
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

// Every read prints how long it took and, for the API, the server's own
// Server-Timing, so a slow smoke says where the time went.
const timed = async (url, init) => {
  const t = Date.now();
  const res = await fetchRetry(url, init);
  const timing = res.headers.get("server-timing");
  console.log(
    `     ${Date.now() - t} ms  ${url.slice(base.length)}${timing ? `  [${timing}]` : ""}`,
  );
  return res;
};

const home = await timed(`${base}/`);
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
const csp = home.headers.get("content-security-policy") ?? "";
const scriptSrc = /script-src ([^;]+)/.exec(csp)?.[1] ?? "";
check(
  "app shell CSP allows only tinylytics as third-party script",
  scriptSrc
    .split(/\s+/)
    .filter((s) => s.startsWith("http"))
    .every((s) => s === "https://tinylytics.app"),
  scriptSrc,
);

// Images from a third party: the analytics pixel and, for the clan map
// (Social, 2026-09-26), OpenStreetMap's tiles. Nothing else.
const imgSrc = /img-src ([^;]+)/.exec(csp)?.[1] ?? "";
check(
  "app shell CSP allows images only from tinylytics and OpenStreetMap's tiles",
  imgSrc
    .split(/\s+/)
    .filter((s) => s.startsWith("http"))
    .every((s) =>
      ["https://tinylytics.app", "https://tile.openstreetmap.org"].includes(s),
    ),
  imgSrc,
);

const route = await timed(`${base}/clan`);
check(
  "GET /clan serves the app shell (SPA router)",
  route.status === 200 && (await route.text()).includes("Elixir Clan"),
  String(route.status),
);

const missing = await timed(`${base}/nope.txt`);
check(
  "a missing file is honestly a miss",
  missing.status === 403 || missing.status === 404,
  String(missing.status),
);

const health = await timed(`${base}/api/health`);
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

const me = await timed(`${base}/api/me`);
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

// Nothing under a clan answers without a session: Elixir Clan publishes
// no public pages or documents (Jamie, 2026-09-25). The tag is invented.
const clanRead = await timed(`${base}/api/clans/2PPQQRRV/awards`);
check(
  "a clan route with no session is 401",
  clanRead.status === 401,
  String(clanRead.status),
);

if (checks.every(Boolean)) {
  console.log(`smoke passed at ${base}`);
} else {
  console.error(`smoke FAILED at ${base}`);
  process.exit(1);
}
