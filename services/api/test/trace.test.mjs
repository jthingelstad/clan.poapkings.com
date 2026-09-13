/**
 * One story per request: the line, the EMF line, the Server-Timing header.
 * A log group holding only START/END/REPORT told nobody where 20 seconds
 * went; this is what says it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/store.mjs";
import { createHandler } from "../src/handler.mjs";
import { createMemoryLedger } from "../src/manage/ledger.mjs";
import {
  createManageService,
  fetchParticipation,
} from "../src/manage/service.mjs";
import { createAwardsService } from "../src/manage/awards.mjs";
import {
  fakeMcp,
  fakeOAuth,
  player,
  req,
  signIn,
  cookieHeader,
} from "./fakes.mjs";
import { member, participation, NOW } from "../../engine/test/fixture.mjs";
import { emf, serverTiming, summarize, timedElixir } from "../src/trace.mjs";
import { routeKey } from "../src/handler.mjs";

/** The logger the handler is given: the story and the metric, captured. */
function capturing() {
  const lines = [];
  return {
    lines,
    log: {
      info: (l) => lines.push(["log", l]),
      warn: (l) => lines.push(["warn", l]),
      error() {},
      metric: (l) => lines.push(["out", l]),
    },
  };
}
const capture = async (fn, cap) => {
  cap.lines.length = 0;
  const r = await fn();
  return { r, lines: [...cap.lines] };
};

test("every request ends with one JSON line naming the route, the status, the time, and each Elixir call with its request_id; plus EMF and Server-Timing", async () => {
  const now = () => NOW.getTime();
  const part = participation(
    [member("#20JJJ2CCRU", { name: "King Thing", role: "leader" })],
    {
      clan_tag: "#J2RGCRVG",
    },
  );
  part.meta.request_id = "req-elixir-1";
  const mcp = fakeMcp({ players: [player()] });
  const inner = mcp.rawCallTool.bind(mcp);
  mcp.callTool = (token, name, args) =>
    timedElixir(name, async () => {
      if (name === "clans_participation") return { ok: true, body: part };
      return inner(token, name, args);
    });
  const ledger = createMemoryLedger();
  const cap = capturing();
  const handler = createHandler({
    mcp,
    oauth: fakeOAuth({ now }),
    store: createMemoryStore(),
    manage: createManageService({ ledger, mcp, now }),
    awards: createAwardsService({
      ledger,
      now,
      participationFor: (t, c) => fetchParticipation(mcp, t, c),
    }),
    sessionSecret: "s",
    appUrl: "https://clan.test",
    elixirUrl: "https://elixir.test",
    now,
    log: cap.log,
  });
  const h = { handler };
  const { r: cookie } = await capture(
    async () => cookieHeader((await signIn(h)).sessionCookie),
    cap,
  );
  const { r, lines } = await capture(
    () =>
      handler(req("GET", "/api/clans/J2RGCRVG/manage", { cookies: cookie })),
    cap,
  );
  assert.equal(r.statusCode, 200);
  assert.match(
    r.headers["server-timing"],
    /^total;dur=\d+, elixir;dur=\d+;desc="\d+ calls", store;dur=\d+;desc="\d+ ops", own;dur=\d+/,
  );
  const story = lines
    .filter(([k]) => k === "log" || k === "warn")
    .map(([, l]) => JSON.parse(l));
  assert.equal(story.length, 1, "one line per request");
  const line = story[0];
  assert.equal(line.http, "GET /api/clans/*/manage", "the route, not the tag");
  assert.equal(line.status, 200);
  assert.equal(line.clan, "#J2RGCRVG");
  assert.equal(line.role, "leader");
  assert.ok(line.ms >= 0 && line.elixir_calls >= 2, JSON.stringify(line));
  const calls = line.elixir.map((c) => c.call);
  assert.ok(calls.includes("clans_participation"), calls.join(","));
  assert.equal(
    line.elixir.find((c) => c.call === "clans_participation").request_id,
    "req-elixir-1",
    "Elixir's own request id rides on the call",
  );
  assert.ok(!JSON.stringify(line).includes("eat_"), "never a token");
  const metrics = lines
    .filter(([k]) => k === "out")
    .map(([, l]) => JSON.parse(l));
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].Route, "GET /api/clans/*/manage");
  assert.equal(metrics[0]._aws.CloudWatchMetrics[0].Namespace, "ElixirClan");
  assert.equal(metrics[0].Errors5xx, 0);
});

test("route keys hide ids and tags; a slow or failed request logs at warn", async () => {
  const now = () => NOW.getTime();
  const cap = capturing();
  const handler = createHandler({
    mcp: fakeMcp(),
    oauth: fakeOAuth({ now }),
    store: createMemoryStore(),
    sessionSecret: "s",
    appUrl: "https://clan.test",
    elixirUrl: "https://elixir.test",
    now,
    log: cap.log,
  });
  const { lines } = await capture(
    () => handler(req("GET", "/api/roster", {})),
    cap,
  );
  const line = JSON.parse(lines.find(([k]) => k === "log" || k === "warn")[1]);
  assert.equal(line.http, "GET /api/roster");
  assert.equal(line.status, 401);
  assert.equal(
    routeKey("GET", "/api/clans/J2RGCRVG/members/8QCV/notes"),
    "GET /api/clans/*/members/*/notes",
  );
  assert.equal(
    routeKey("POST", "/api/clans/J2RGCRVG/cards/abc_1/decide"),
    "POST /api/clans/*/cards/*/decide",
  );
  assert.equal(
    routeKey("DELETE", "/api/clans/J2RGCRVG/awards/grants/135/free_pass/8QCV"),
    "DELETE /api/clans/*/awards/grants/*",
  );
  assert.equal(
    routeKey("GET", "/api/maintain/feedback/abc123"),
    "GET /api/maintain/feedback/*",
  );
  assert.equal(routeKey("GET", "/api/feedback"), "GET /api/feedback");

  const slow = summarize(
    {
      started: Date.now() - 9000,
      meta: { http: "GET /api/me" },
      elixir: [{ call: "x", ms: 8500, ok: true }],
      store: [],
      notes: [],
      cold: true,
    },
    200,
  );
  assert.equal(slow.level, "warn");
  assert.equal(slow.cold, true);
  assert.match(serverTiming(slow), /cold$/);
  assert.equal(JSON.parse(emf(slow)).ColdStarts, 1);
  const failed = summarize(
    {
      started: Date.now(),
      meta: {},
      elixir: [],
      store: [],
      notes: [],
      cold: false,
    },
    502,
  );
  assert.equal(failed.level, "warn");
  assert.equal(JSON.parse(emf(failed)).Errors5xx, 1);
});
