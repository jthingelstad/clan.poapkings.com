/**
 * Feedback over the real handler: a person files with the page attached
 * and reads their own; the maintainer (a verified tag in MaintainerTags,
 * never a clan role) reads the queue and answers; opening a reply marks
 * it seen and the chrome's count moves; a refused person can still file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/store.mjs";
import { createHandler } from "../src/handler.mjs";
import { createMemoryLedger } from "../src/manage/ledger.mjs";
import { createFeedbackService } from "../src/feedback.mjs";
import {
  fakeMcp,
  fakeOAuth,
  player,
  req,
  signIn,
  cookieHeader,
} from "./fakes.mjs";

function harness({ players = [player()], ledger = createMemoryLedger() } = {}) {
  const clock = { t: Date.parse("2026-09-12T20:00:00Z") };
  const now = () => clock.t;
  const mcp = fakeMcp({ players });
  const notified = [];
  const handler = createHandler({
    mcp,
    oauth: fakeOAuth({ now }),
    store: createMemoryStore(),
    feedback: createFeedbackService({
      ledger,
      now,
      notify: async (spec) => notified.push(spec),
      log: { error() {} },
    }),
    maintainerTags: ["#20QQL8CCRU"],
    sessionSecret: "s",
    appUrl: "https://clan.test",
    elixirUrl: "https://elixir.test",
    now,
    log: { warn() {}, error() {} },
  });
  return { clock, ledger, handler, notified };
}

const api = async (h, cookies, method, path, body) => {
  const r = await h.handler(
    req(method, path, {
      cookies,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
};
const signedIn = async (h) => cookieHeader((await signIn(h)).sessionCookie);

test("feedback: a member files with the page attached, sees it on their list, and the maintainer is told once", async () => {
  const ledger = createMemoryLedger();
  const member = harness({
    players: [
      player({ player_tag: "#8QCV", name: "Amy", clan_role: "member" }),
    ],
    ledger,
  });
  const cookies = await signedIn(member);
  const me = await api(member, cookies, "GET", "/api/me");
  assert.equal(me.body.maintainer, false);
  assert.equal(me.body.feedback_unseen, 0);

  const filed = await api(member, cookies, "POST", "/api/feedback", {
    message: "The **removal clock** says 20 days but I played yesterday.",
    category: "judgment",
    context: {
      path: "/clan/2PQRJ8LV/standing",
      clan_tag: "#2PQRJ8LV",
      clan_name: "Example Clan",
      role: "member",
    },
  });
  assert.equal(filed.status, 200, JSON.stringify(filed.body));
  assert.equal(filed.body.status, "new");
  assert.equal(filed.body.category, "judgment");
  assert.deepEqual(filed.body.context, {
    path: "/clan/2PQRJ8LV/standing",
    clan_tag: "#2PQRJ8LV",
    clan_name: "Example Clan",
    role: "member",
  });
  assert.equal(member.notified.length, 1);
  assert.equal(member.notified[0].from, "Amy (#8QCV)");
  assert.equal(member.notified[0].clan_tag, "#2PQRJ8LV");
  assert.equal(member.notified[0].clan_name, "Example Clan");
  assert.match(member.notified[0].excerpt, /removal clock/);

  const list = await api(member, cookies, "GET", "/api/feedback");
  assert.equal(list.body.feedback.length, 1);
  assert.equal(list.body.maintainer, false);

  const bad = await api(member, cookies, "POST", "/api/feedback", {
    message: "",
  });
  assert.equal(bad.status, 400);
  const nonsense = await api(member, cookies, "POST", "/api/feedback", {
    message: "x",
    category: "nope",
  });
  assert.equal(
    nonsense.body.category,
    "general",
    "an unknown category is general",
  );
});

test("feedback: the maintainer reads the queue and answers; the person sees the reply, opening it marks it seen; a member cannot reach the lane", async () => {
  const ledger = createMemoryLedger();
  const member = harness({
    players: [
      player({ player_tag: "#8QCV", name: "Amy", clan_role: "member" }),
    ],
    ledger,
  });
  const mc = await signedIn(member);
  const filed = await api(member, mc, "POST", "/api/feedback", {
    message: "Scout should show the applicant's clan history.",
    category: "feature",
  });
  const id = filed.body.feedback_id;

  const refused = await api(member, mc, "GET", "/api/maintain/feedback");
  assert.equal(refused.status, 403);

  const jamie = harness({ players: [player()], ledger });
  const jc = await signedIn(jamie);
  assert.equal((await api(jamie, jc, "GET", "/api/me")).body.maintainer, true);
  const queue = await api(jamie, jc, "GET", "/api/maintain/feedback");
  assert.equal(queue.status, 200);
  assert.equal(queue.body.feedback.length, 1);
  assert.equal(queue.body.feedback[0].person_name, "Amy");
  assert.equal(queue.body.feedback[0].status, "new");

  const answered = await api(
    jamie,
    jc,
    "POST",
    `/api/maintain/feedback/${id}`,
    {
      status: "planned",
      response: "Yes: it is on the list for the next push.",
    },
  );
  assert.equal(answered.status, 200, JSON.stringify(answered.body));
  assert.equal(answered.body.status, "planned");
  assert.ok(answered.body.responded_at);

  const meAfter = await api(member, mc, "GET", "/api/me");
  assert.equal(meAfter.body.feedback_unseen, 1);
  const item = await api(member, mc, "GET", `/api/feedback/${id}`);
  assert.equal(item.status, 200);
  assert.match(item.body.response, /next push/);
  assert.ok(item.body.response_seen_at, "opening it marks the reply seen");
  assert.equal(
    (await api(member, mc, "GET", "/api/me")).body.feedback_unseen,
    0,
  );

  // A second reply is unseen again; shipped_in is free text.
  await api(jamie, jc, "POST", `/api/maintain/feedback/${id}`, {
    status: "done",
    response: "Shipped.",
    shipped_in: "fourth push, 2026-09-13",
  });
  assert.equal(
    (await api(member, mc, "GET", "/api/me")).body.feedback_unseen,
    1,
  );
  const done = await api(member, mc, "GET", `/api/feedback/${id}`);
  assert.equal(done.body.shipped_in, "fourth push, 2026-09-13");

  // Another person's item is nobody's business.
  const stranger = harness({
    players: [player({ player_tag: "#O2", name: "Bo", clan_role: "member" })],
    ledger,
  });
  const sc = await signedIn(stranger);
  assert.equal(
    (await api(stranger, sc, "GET", `/api/feedback/${id}`)).status,
    404,
  );
  const badStatus = await api(
    jamie,
    jc,
    "POST",
    `/api/maintain/feedback/${id}`,
    {
      status: "nope",
    },
  );
  assert.equal(badStatus.status, 400);
  // The maintainer's own feedback tells nobody.
  await api(jamie, jc, "POST", "/api/feedback", { message: "note to self" });
  assert.equal(jamie.notified.length, 0);
});

test("feedback: a person the gate refuses can still file (that is feedback worth having)", async () => {
  const h = harness({
    players: [
      player({ player_tag: "#8QCV", name: "Amy", claim_status: "unverified" }),
    ],
  });
  const cookies = await signedIn(h);
  const me = await api(h, cookies, "GET", "/api/me");
  assert.equal(me.body.ok, false);
  const filed = await api(h, cookies, "POST", "/api/feedback", {
    message: "Stuck at unverified: the battle never showed.",
    category: "bug",
  });
  assert.equal(filed.status, 200, JSON.stringify(filed.body));
  assert.equal(h.notified[0].from, "Amy (#8QCV)");
});
