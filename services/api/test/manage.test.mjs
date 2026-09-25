import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/store.mjs";
import { createHandler } from "../src/handler.mjs";
import { createMemoryLedger } from "../src/manage/ledger.mjs";
import { createManageService, ManageError } from "../src/manage/service.mjs";
import { createScout } from "../src/manage/scout.mjs";
import {
  fakeMcp,
  fakeOAuth,
  player,
  req,
  signIn,
  cookieHeader,
  rosterBody,
  ledgerWithPolicy,
} from "./fakes.mjs";
import {
  member,
  participation,
  NOW,
  EXAMPLE_POLICY,
} from "../../engine/test/fixture.mjs";

const DAY = 86400_000;

/** A door that also answers clans_participation and the scout's live reads. */
function door({ players, part, profile = null, log = null, roster = null }) {
  // The roster states the clan's size as the participation read does.
  const mcp = fakeMcp({
    players,
    roster: roster ?? {
      ...rosterBody([]),
      member_count: part?.members?.length ?? 0,
    },
  });
  const inner = mcp.callTool.bind(mcp);
  mcp.callTool = async (token, name, args) => {
    mcp.calls.push([name, token, args]);
    if (mcp.state.refuse) return { ok: false, status: 401, error: "http 401" };
    if (name === "clans_participation") return { ok: true, body: part };
    if (name === "players_profile")
      return (
        profile ?? {
          ok: false,
          code: "live_pending",
          error: "queued",
          hint: "Call again in 45 s.",
          body: {
            error: {
              code: "live_pending",
              hint: "Call again in 45 s.",
              retry_after_s: 45,
            },
          },
        }
      );
    if (name === "battles_query")
      return log ?? { ok: true, body: { battles: [] } };
    return inner(token, name, args);
  };
  return mcp;
}

function harness({
  players = [player()],
  part,
  policy = EXAMPLE_POLICY,
  ledger = policy
    ? ledgerWithPolicy(createMemoryLedger(), "#2PQRJ8LV", policy)
    : createMemoryLedger(),
  ...rest
} = {}) {
  const clock = { t: NOW.getTime() };
  const now = () => clock.t;
  const mcp = door({ players, part, ...rest });
  const oauth = fakeOAuth({ now });
  const store = createMemoryStore();
  const manage = createManageService({
    ledger,
    mcp,
    now,
    log: { warn() {}, error() {} },
  });
  const handler = createHandler({
    mcp,
    oauth,
    store,
    manage,
    scout: createScout({ mcp, now }),
    sessionSecret: "s",
    appUrl: "https://clan.test",
    elixirUrl: "https://elixir.test",
    now,
    log: { warn() {}, error() {} },
  });
  return { clock, mcp, store, ledger, manage, handler };
}

const others = Array.from({ length: 10 }, (_, i) => member(`#O${i}`));
const idle = member("#8QCV", {
  name: "Sleepy",
  lastBattleDaysAgo: 20,
  war: [0, 0, 0, 0, 0, 0],
});
const king = member("#20QQL8CCRU", { name: "Ada", role: "leader" });
const partClan = () =>
  participation([king, ...others, idle], {
    clan_tag: "#2PQRJ8LV",
    name: "Example Clan",
  });

async function leader(h) {
  const { sessionCookie } = await signIn(h);
  return cookieHeader(sessionCookie);
}
const api = async (h, cookies, method, path, body) => {
  const [rawPath, qs] = path.split("?");
  const query = qs ? Object.fromEntries(new URLSearchParams(qs)) : undefined;
  const r = await h.handler(
    req(method, rawPath, {
      cookies,
      query,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
};

test("manage: a leader opens Manage; one participation read, cards raised, cached for minutes", async () => {
  const h = harness({ part: partClan() });
  const cookies = await leader(h);
  const r = await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/manage");
  assert.equal(r.status, 200);
  assert.equal(r.body.cached, false);
  assert.equal(r.body.policy_version, 1);
  assert.equal(r.body.band.roster_size, 12);
  const removal = r.body.inbox.filter((c) => c.type === "removal");
  assert.equal(removal.length, 1);
  assert.equal(removal[0].player_tag, "#8QCV");
  assert.equal(removal[0].status, "proposed");
  assert.match(removal[0].evidence.rationale.headline, /20 battle-free days/);
  assert.ok(removal[0].evidence.facts.find((f) => f.key === "last_battle"));
  assert.equal(
    h.mcp.calls.filter((c) => c[0] === "clans_participation").length,
    1,
  );
  const again = await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/manage");
  assert.equal(again.body.cached, true);
  assert.equal(
    h.mcp.calls.filter((c) => c[0] === "clans_participation").length,
    1,
  );
  assert.ok(
    again.body.board.find((m) => m.player_tag === "#8QCV").bucket ===
      "actionable",
  );
});

test("manage: the board explains held judgments from an existing cached snapshot", async () => {
  const h = harness({
    part: participation(
      [
        king,
        ...others,
        member("#HELD", { war: [null, null, null, null, null, null] }),
      ],
      { clan_tag: "#2PQRJ8LV" },
    ),
  });
  const cookies = await leader(h);
  await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/manage");
  const r = await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/manage");
  assert.equal(r.body.cached, true);
  const held = r.body.board.find((m) => m.player_tag === "#HELD");
  assert.equal(held.judgment.promotion, "held");
  assert.deepEqual(held.judgment_reasons, [
    "Promotion held: war record incomplete in the review window.",
  ]);
  assert.equal(
    r.body.inbox.some((c) => c.player_tag === "#HELD"),
    false,
  );
});

test("manage: a member is refused; a foreign clan is refused", async () => {
  const h = harness({
    players: [player({ clan_role: "member" })],
    part: partClan(),
  });
  const cookies = await leader(h);
  assert.equal(
    (await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/manage")).status,
    403,
  );
  assert.equal(
    (await api(h, cookies, "GET", "/api/clans/PYLQ2/manage")).status,
    403,
  );
});

test("cards: decide freezes; a second decision is refused; declined blocks re-nomination for the cooldown", async () => {
  const h = harness({ part: partClan() });
  const cookies = await leader(h);
  const first = await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/manage");
  const card = first.body.inbox.find((c) => c.type === "removal");
  const bad = await api(
    h,
    cookies,
    "POST",
    `/api/clans/2PQRJ8LV/actions/${card.card_id}/decide`,
    { status: "declined" },
  );
  assert.equal(bad.status, 400);
  const declined = await api(
    h,
    cookies,
    "POST",
    `/api/clans/2PQRJ8LV/actions/${card.card_id}/decide`,
    { status: "declined", reason: "not_now" },
  );
  assert.equal(declined.status, 200);
  assert.equal(declined.body.decided_by, "#20QQL8CCRU");
  assert.equal(declined.body.decided_by_name, "Ada");
  const twice = await api(
    h,
    cookies,
    "POST",
    `/api/clans/2PQRJ8LV/actions/${card.card_id}/decide`,
    { status: "done" },
  );
  assert.equal(twice.status, 409);
  const next = await api(
    h,
    cookies,
    "GET",
    "/api/clans/2PQRJ8LV/manage?refresh=1",
  );
  assert.equal(
    next.body.inbox.filter((c) => c.type === "removal").length,
    0,
    "inside the cooldown, no new card",
  );
  h.clock.t += 8 * DAY;
  const later = await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/manage");
  assert.equal(
    later.body.inbox.filter((c) => c.type === "removal").length,
    1,
    "re-nominated after the cooldown",
  );
  const hist = await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/history");
  assert.equal(hist.body.cards[0].status, "declined");
});

test("cards: auto-withdraw when the member plays; done removal verified when the membership closes", async () => {
  const h = harness({ part: partClan() });
  const cookies = await leader(h);
  const first = await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/manage");
  const card = first.body.inbox.find((c) => c.type === "removal");
  // The member played: the card is withdrawn with the reason.
  const played = participation(
    [
      king,
      ...others,
      member("#8QCV", {
        name: "Sleepy",
        lastBattleDaysAgo: 0.2,
        war: [0, 0, 0, 0, 0, 0],
      }),
    ],
    { clan_tag: "#2PQRJ8LV" },
  );
  h.mcp.callTool = ((orig) => (token, name, args) =>
    name === "clans_participation"
      ? Promise.resolve({ ok: true, body: played })
      : orig(token, name, args))(h.mcp.callTool);
  h.clock.t += 6 * 60_000;
  const second = await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/manage");
  assert.equal(
    second.body.inbox.length,
    second.body.inbox.filter((c) => c.card_id !== card.card_id).length,
  );
  const hist = await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/history");
  const w = hist.body.cards.find((c) => c.card_id === card.card_id);
  assert.equal(w.status, "withdrawn");
  assert.match(w.withdraw_reason, /played/);
});

test("cards: a done removal is verified when the record no longer lists the member; otherwise flagged after the window", async () => {
  const h = harness({ part: partClan() });
  const cookies = await leader(h);
  const first = await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/manage");
  const card = first.body.inbox.find((c) => c.type === "removal");
  await api(
    h,
    cookies,
    "POST",
    `/api/clans/2PQRJ8LV/actions/${card.card_id}/decide`,
    { status: "done" },
  );
  const gone = participation([king, ...others], { clan_tag: "#2PQRJ8LV" });
  h.mcp.callTool = ((orig) => (token, name, args) =>
    name === "clans_participation"
      ? Promise.resolve({ ok: true, body: gone })
      : orig(token, name, args))(h.mcp.callTool);
  h.clock.t += 6 * 3600_000;
  await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/manage");
  const hist = await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/history");
  const done = hist.body.cards.find((c) => c.card_id === card.card_id);
  assert.equal(done.outcome.classification, "member_kicked");
  assert.equal(done.outcome.delay_hours, 6);

  // A done card with no change inside the window is flagged, not reversed.
  const h2 = harness({ part: partClan() });
  const c2 = await leader(h2);
  const f2 = await api(h2, c2, "GET", "/api/clans/2PQRJ8LV/manage");
  const card2 = f2.body.inbox.find((c) => c.type === "removal");
  await api(
    h2,
    c2,
    "POST",
    `/api/clans/2PQRJ8LV/actions/${card2.card_id}/decide`,
    { status: "done" },
  );
  h2.clock.t += 49 * 3600_000;
  await api(h2, c2, "GET", "/api/clans/2PQRJ8LV/manage");
  const h2hist = await api(h2, c2, "GET", "/api/clans/2PQRJ8LV/history");
  assert.ok(
    h2hist.body.cards.find((c) => c.card_id === card2.card_id).outcome
      .flagged_at,
  );
});

test("holds pause the clock and show on the member; a member cannot set one", async () => {
  const h = harness({ part: partClan() });
  const cookies = await leader(h);
  const set = await api(h, cookies, "PUT", "/api/clans/2PQRJ8LV/holds/8QCV", {
    until: new Date(NOW.getTime() + 3 * DAY).toISOString(),
    note: "away",
  });
  assert.equal(set.status, 200);
  assert.equal(set.body.by, "#20QQL8CCRU");
  assert.equal(set.body.by_name, "Ada");
  const view = await api(
    h,
    cookies,
    "GET",
    "/api/clans/2PQRJ8LV/manage?refresh=1",
  );
  const row = view.body.board.find((m) => m.player_tag === "#8QCV");
  assert.equal(row.removal.shielded, "hold");
  // History names the held member and the leader who set it, whether the
  // row was stamped (by_name) or is named from the ledger (player_name).
  const history = await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/history");
  const hold = history.body.holds.find((x) => x.player_tag === "#8QCV");
  assert.equal(hold.by_name, "Ada");
  assert.equal(hold.player_name, row.name);
  assert.equal(row.bucket, "held");
  assert.equal(
    view.body.inbox.filter((c) => c.player_tag === "#8QCV").length,
    0,
  );
  assert.equal(
    (await api(h, cookies, "DELETE", "/api/clans/2PQRJ8LV/holds/8QCV")).status,
    200,
  );
});

test("notes: elders write and read elder notes; leaders write leader notes and read both; members see none", async () => {
  // One clan ledger, three people.
  const ledger = ledgerWithPolicy(
    createMemoryLedger(),
    "#2PQRJ8LV",
    EXAMPLE_POLICY,
  );
  const he = harness({
    players: [player({ player_tag: "#8QCV", name: "Amy", clan_role: "elder" })],
    part: partClan(),
    ledger,
  });
  const eCookies = await leader(he);
  const eNote = await api(
    he,
    eCookies,
    "POST",
    "/api/clans/2PQRJ8LV/members/2PP/notes",
    { text: "Great in war." },
  );
  assert.equal(eNote.status, 200);
  assert.equal(eNote.body.tier, "elder");
  const hl = harness({ part: partClan(), ledger });
  const lCookies = await leader(hl);
  const lNote = await api(
    hl,
    lCookies,
    "POST",
    "/api/clans/2PQRJ8LV/members/2PP/notes",
    { text: "Talked about elder." },
  );
  assert.equal(lNote.body.tier, "leader");
  const leaderSees = await api(
    hl,
    lCookies,
    "GET",
    "/api/clans/2PQRJ8LV/members/2PP/notes",
  );
  assert.deepEqual(leaderSees.body.notes.map((n) => n.tier).sort(), [
    "elder",
    "leader",
  ]);
  const elderSees = await api(
    he,
    eCookies,
    "GET",
    "/api/clans/2PQRJ8LV/members/2PP/notes",
  );
  assert.deepEqual(
    elderSees.body.notes.map((n) => n.tier),
    ["elder"],
  );
  const hm = harness({
    players: [player({ player_tag: "#O2", clan_role: "member" })],
    part: partClan(),
    ledger,
  });
  const mCookies = await leader(hm);
  assert.equal(
    (await api(hm, mCookies, "GET", "/api/clans/2PQRJ8LV/members/2PP/notes"))
      .status,
    403,
  );
  assert.equal(
    (await api(hm, mCookies, "GET", "/api/clans/2PQRJ8LV/manage")).status,
    403,
  );
});

test("policy: versions are immutable, validated in a leader's words, previewable before save", async () => {
  const h = harness({ part: partClan(), policy: null });
  const cookies = await leader(h);
  const view = await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/policy");
  assert.equal(view.body.current.version, 0);
  assert.equal(view.body.set, false);
  assert.equal(view.body.can_edit, true);
  assert.ok(view.body.fields.at_risk_days.why);
  assert.equal(view.body.current.values.elder_mode, "manual");
  const bad = await api(h, cookies, "POST", "/api/clans/2PQRJ8LV/policy", {
    values: { band_ceiling_share: 0.1 },
  });
  assert.equal(bad.status, 400);
  assert.match(
    bad.body.errors.band_ceiling_share,
    /upper share cannot be below/,
  );
  // Before the first save there is nothing current to compare against.
  const first = await api(
    h,
    cookies,
    "POST",
    "/api/clans/2PQRJ8LV/policy/preview",
    { values: EXAMPLE_POLICY },
  );
  assert.equal(first.status, 200);
  assert.equal(first.body.current, null);
  assert.equal(
    first.body.draft.members.find((m) => m.player_tag === "#8QCV").removal,
    "recommended",
  );
  const v1 = await api(h, cookies, "POST", "/api/clans/2PQRJ8LV/policy", {
    values: EXAMPLE_POLICY,
    note: "our rules",
  });
  assert.equal(v1.body.version, 1);
  const draft = { ...EXAMPLE_POLICY, at_risk_days: 30, confirm_days: 30 };
  const preview = await api(
    h,
    cookies,
    "POST",
    "/api/clans/2PQRJ8LV/policy/preview",
    { values: draft },
  );
  assert.equal(preview.status, 200);
  assert.equal(
    preview.body.current.members.find((m) => m.player_tag === "#8QCV").removal,
    "recommended",
  );
  assert.equal(
    preview.body.draft.members.find((m) => m.player_tag === "#8QCV").removal,
    "watch",
  );
  assert.deepEqual(
    preview.body.changes.map((c) => c.key),
    ["at_risk_days", "confirm_days"],
  );
  const saved = await api(h, cookies, "POST", "/api/clans/2PQRJ8LV/policy", {
    values: draft,
    note: "more rope",
  });
  assert.equal(saved.body.version, 2);
  const saved2 = await api(h, cookies, "POST", "/api/clans/2PQRJ8LV/policy", {
    values: { ...draft, at_risk_days: 6 },
  });
  assert.equal(saved2.body.version, 3);
  const versions = (await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/policy"))
    .body.versions;
  assert.deepEqual(
    versions.map((v) => v.version),
    [3, 2, 1],
  );
  // A new version invalidates the cached evaluation.
  const view2 = await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/manage");
  assert.equal(view2.body.policy_version, 3);
  assert.equal(view2.body.cached, false);
});

test("before a leader saves a policy, no clan management runs: the roster, the policy editor and Scout still work", async () => {
  const h = harness({ part: partClan(), policy: null });
  const cookies = await leader(h);
  for (const [method, path, body] of [
    ["GET", "/api/clans/2PQRJ8LV/manage"],
    ["GET", "/api/clans/2PQRJ8LV/history"],
    ["GET", "/api/clans/2PQRJ8LV/standing"],
    ["PUT", "/api/clans/2PQRJ8LV/holds/2PP", { until: null }],
    ["GET", "/api/clans/2PQRJ8LV/members/2PP/notes"],
    ["POST", "/api/clans/2PQRJ8LV/members/2PP/notes", { text: "hi" }],
    ["POST", "/api/clans/2PQRJ8LV/actions/abc/decide", { status: "done" }],
  ]) {
    const r = await api(h, cookies, method, path, body);
    assert.equal(r.status, 409, `${method} ${path}`);
    assert.equal(r.body.error, "no_policy", `${method} ${path}`);
  }
  // Nothing was evaluated and nothing was asked of Elixir for it.
  assert.equal(
    h.mcp.calls.filter((c) => c[0] === "clans_participation").length,
    0,
  );
  assert.equal(await h.ledger.latestVerdicts("#2PQRJ8LV"), null);
  const away = await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/me/away");
  assert.deepEqual(away.body, { allowed: false, max_days: 0, hold: null });
  assert.equal(
    (await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/policy")).status,
    200,
  );
  assert.equal(
    (await api(h, cookies, "GET", "/api/roster?clan=2PQRJ8LV")).status,
    200,
  );
  // The chrome learns there is no policy, and the Inbox counts nothing.
  const me = await api(h, cookies, "GET", "/api/me");
  assert.equal(me.body.policy.set, false);
  assert.equal(me.body.open_actions, 0);
});
test("standing for members: evidence in a player's terms, no internals; private when the policy says so", async () => {
  const h = harness({
    players: [player({ player_tag: "#O2", clan_role: "member" })],
    part: partClan(),
  });
  const cookies = await leader(h);
  const s = await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/standing");
  assert.equal(s.status, 200);
  assert.ok(s.body.rows.length > 0);
  assert.ok(!/\b(score|percentile|rank|slot)\b/i.test(JSON.stringify(s.body)));
  assert.ok(s.body.you);
  assert.equal(s.body.you.inactivity, null);
  // How the clan runs, from its policy, for every member.
  assert.deepEqual(
    s.body.how.map((x) => x.key),
    ["counts", "minimums", "elder", "removal"],
  );
  // A leader keeps where everyone stands to leaders: a member still sees
  // how the clan runs and their own line.
  const hl = harness({ part: partClan(), ledger: h.ledger });
  const lc = await leader(hl);
  await api(hl, lc, "POST", "/api/clans/2PQRJ8LV/policy", {
    values: { ...EXAMPLE_POLICY, members_see_standing: false },
  });
  const priv = await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/standing");
  assert.equal(priv.status, 200);
  assert.equal(priv.body.rows, null);
  assert.ok(priv.body.how.length > 0);
  assert.ok(priv.body.you);
  // A clan whose leaders choose Elders and track no inactivity evaluates
  // nothing for Standing: it is the rules alone.
  const calls = h.mcp.calls.length;
  await api(hl, lc, "POST", "/api/clans/2PQRJ8LV/policy", {
    values: { elder_mode: "manual" },
  });
  const manual = await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/standing");
  assert.deepEqual(manual.body.how, [
    { key: "elder", title: "Elder", lines: ["Leaders choose Elders."] },
  ]);
  assert.equal(manual.body.rows, null);
  assert.equal(
    h.mcp.calls.slice(calls).filter((c) => c[0] === "clans_participation")
      .length,
    0,
  );
});

test("nothing under a clan answers without a session: no public pages or documents", async () => {
  const h = harness({ part: partClan() });
  for (const path of [
    "/api/clans/2PQRJ8LV/how-elder-works",
    "/api/clans/2PQRJ8LV/awards",
    "/api/clans/2PQRJ8LV/policy",
  ])
    assert.equal((await h.handler(req("GET", path))).statusCode, 401, path);
  // Signed in, the old public routes are simply not routes.
  const cookies = await leader(h);
  for (const path of [
    "/api/clans/2PQRJ8LV/how-elder-works",
    "/api/clans/2PQRJ8LV/awards",
  ])
    assert.equal((await api(h, cookies, "GET", path)).status, 404, path);
});

test("scout: a pasted tag is read live, pending is passed through, and the policy answer is this app's", async () => {
  const profile = {
    ok: true,
    body: {
      player_tag: "#2PP",
      name: "Newcomer",
      snapshot: {
        trophies: 7000,
        donations_this_week: 40,
        lifetime: {
          battle_count: 500,
          wins: 300,
          losses: 200,
          collection_level: 900,
        },
        path_of_legend: { current: { leagueNumber: 4, trophies: 0 } },
      },
      attributes: { best_trophies: 7200, years_played: 3 },
      badges: [{ name: "ClanWarWins", progress: 12 }],
      meta: { as_of: NOW.toISOString(), freshness_seconds: 30 },
    },
  };
  const mk = (daysAgo, type, outcome) => ({
    battle_time: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
    type,
    me: { outcome },
  });
  const log = {
    ok: true,
    body: {
      battles: [
        mk(0.5, "pathOfLegend", "win"),
        mk(1, "pathOfLegend", "loss"),
        mk(2, "riverRacePvP", "win"),
        mk(3, "riverRaceDuel", "win"),
        mk(20, "PvP", "win"),
      ],
      meta: { as_of: NOW.toISOString() },
    },
  };
  const h = harness({ part: partClan(), profile, log });
  const cookies = await leader(h);
  const r = await api(h, cookies, "POST", "/api/clans/2PQRJ8LV/scout", {
    tag: "2pp",
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.player_tag, "#2PP");
  assert.equal(r.body.pending, null);
  assert.equal(r.body.profile.trophies, 7000);
  assert.equal(r.body.profile.clan_war_wins, 12);
  assert.equal(r.body.log.win_rate, 0.8);
  // A 1v1 is one deck; a duel without its rounds counts two.
  const minimums = r.body.policy_answer.minimums;
  assert.deepEqual(minimums.results.war, { value: 3, needed: 1, passes: true });
  assert.deepEqual(minimums.results.ranked, {
    value: 2,
    needed: 5,
    passes: false,
  });
  assert.equal(minimums.rule, "any");
  assert.equal(minimums.passes, true);
  assert.equal(minimums.bounded_by_log, false);
  assert.equal(r.body.policy_answer.inactivity.state, "active");
  assert.match(r.body.policy_answer.tenure_note, /28 days/);
  // Scout works before a clan has a policy: statistics, no clan verdict.
  const unset = harness({ part: partClan(), profile, log, policy: null });
  const uc = await leader(unset);
  const u = await api(unset, uc, "POST", "/api/clans/2PQRJ8LV/scout", {
    tag: "2pp",
  });
  assert.equal(u.status, 200);
  assert.equal(u.body.profile.trophies, 7000);
  assert.equal(u.body.policy_answer, null);
  const pending = harness({ part: partClan() });
  const pc = await leader(pending);
  const p = await api(pending, pc, "POST", "/api/clans/2PQRJ8LV/scout", {
    tag: "#2PP",
  });
  assert.equal(p.status, 200);
  assert.deepEqual(p.body.pending, { retry_after_s: 45 });
  assert.equal(p.body.profile, null);
  const badTag = await api(pending, pc, "POST", "/api/clans/2PQRJ8LV/scout", {
    tag: "nope",
  });
  assert.equal(badTag.status, 400);
});

test("ManageError carries a status and code", () => {
  const e = new ManageError(403, "leaders_only");
  assert.equal(e.status, 403);
  assert.equal(e.code, "leaders_only");
});

// ---- fourth push (2026-09-12): departures, away, the timeline, copy ---------

const leftEvents = (extra = []) => ({
  ...rosterBody([]),
  member_count: 12,
  events_recorded_since: "2026-09-03T00:00:00.000Z",
  recent_events: [
    {
      type: "member_left",
      at: "2026-09-11T20:00:00.000Z",
      detail: { player_tag: "#GONE1", name: "Gone One", role: "member" },
    },
    {
      type: "member_joined",
      at: "2026-09-10T20:00:00.000Z",
      detail: { player_tag: "#NEW1", name: "New One", role: "member" },
    },
    {
      type: "role_changed",
      at: "2026-09-09T20:00:00.000Z",
      detail: {
        player_tag: "#O1",
        name: "O1",
        role_before: "member",
        role_after: "elder",
      },
    },
    ...extra,
  ],
});

test("departures: every unexplained member_left raises one card; Kicked / Left / Ignore answers it; a Done removal explains its own", async () => {
  const h = harness({ part: partClan(), roster: leftEvents() });
  const cookies = await leader(h);
  const first = await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/manage");
  const dep = first.body.inbox.filter((c) => c.type === "departure");
  assert.equal(dep.length, 1);
  assert.equal(dep[0].player_tag, "#GONE1");
  assert.equal(dep[0].evidence.left_at, "2026-09-11T20:00:00.000Z");
  assert.equal(dep[0].copy, null, "nothing to paste until it is classified");
  // A second look raises no duplicate.
  const again = await api(
    h,
    cookies,
    "GET",
    "/api/clans/2PQRJ8LV/manage?refresh=1",
  );
  assert.equal(
    again.body.inbox.filter((c) => c.type === "departure").length,
    1,
  );
  // It is answered, never declined.
  const declined = await api(
    h,
    cookies,
    "POST",
    `/api/clans/2PQRJ8LV/actions/${dep[0].card_id}/decide`,
    {
      status: "declined",
      reason: "not_now",
    },
  );
  assert.equal(declined.status, 400);
  assert.equal(declined.body.error, "bad_classification");
  const left = await api(
    h,
    cookies,
    "POST",
    `/api/clans/2PQRJ8LV/actions/${dep[0].card_id}/decide`,
    {
      classification: "leave",
      note: "  player decided to leave the game  ",
    },
  );
  assert.equal(left.status, 200, JSON.stringify(left.body));
  assert.equal(left.body.status, "done");
  assert.equal(left.body.outcome.classification, "member_left");
  assert.equal(
    left.body.decision_note,
    "player decided to leave the game",
    "the leader's note rides the decision",
  );
  // The timeline carries it, with a farewell to paste and a welcome for the join.
  const hist = await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/history");
  assert.equal(hist.status, 200);
  const t = hist.body.timeline;
  assert.deepEqual(
    t.map((e) => [e.type, e.player_tag, e.classification]),
    [
      ["member_left", "#GONE1", "member_left"],
      ["member_joined", "#NEW1", null],
      ["role_changed", "#O1", null],
    ],
  );
  assert.equal(t[0].note, "player decided to leave the game");
  assert.equal(t[1].note, null);
  assert.match(t[0].copy, /Thanks for your time with us Gone One/);
  assert.equal(t[1].copy, "Welcome to the clan, New One!");
  assert.equal(t[2].role_after, "elder");

  // Sleepy is carded for removal, marked Done, then leaves: no departure card.
  const removal = first.body.inbox.find((c) => c.type === "removal");
  await api(
    h,
    cookies,
    "POST",
    `/api/clans/2PQRJ8LV/actions/${removal.card_id}/decide`,
    { status: "done" },
  );
  h.mcp.state.roster = leftEvents([
    {
      type: "member_left",
      at: "2026-09-12T21:00:00.000Z",
      detail: { player_tag: "#8QCV", name: "Sleepy", role: "member" },
    },
  ]);
  h.clock.t += 60 * 60_000;
  const after = await api(
    h,
    cookies,
    "GET",
    "/api/clans/2PQRJ8LV/manage?refresh=1",
  );
  assert.ok(
    !after.body.inbox.some(
      (c) => c.type === "departure" && c.player_tag === "#8QCV",
    ),
  );
  const hist2 = await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/history");
  const sleepy = hist2.body.timeline.find((e) => e.player_tag === "#8QCV");
  assert.equal(
    sleepy.classification,
    "member_kicked",
    "the removal card explains it",
  );
  assert.equal(sleepy.copy, null, "no farewell for a kick");
});

test("departures: a member_left that carries only a tag is named from Elixir's corpus, once, and the ledger remembers", async () => {
  // Elixir's roster event before 2026-09-13: no name, and the departing
  // role spelled role_at_departure. The member never had a verdict line
  // here, so nothing local knows who #VGJJ is.
  const h = harness({
    part: partClan(),
    roster: leftEvents([
      {
        type: "member_left",
        at: "2026-09-11T10:00:00.000Z",
        detail: {
          roster_size_before: 48,
          roster_size_after: 47,
          player_tag: "#VGJJ",
          role_at_departure: "elder",
          joined_observed_at: "2026-09-03T00:00:00.000Z",
        },
      },
    ]),
  });
  h.mcp.callTool = ((orig) => (token, name, args) => {
    if (name === "players_names") {
      h.mcp.calls.push([name, token, args]);
      return {
        ok: true,
        body: {
          names: args.player_tags
            .filter((t) => t === "#VGJJ")
            .map((t) => ({ player_tag: t, name: "Ditaka", source: "roster" })),
          unknown: args.player_tags
            .filter((t) => t !== "#VGJJ")
            .map((t) => ({ player_tag: t, in_corpus: false })),
        },
      };
    }
    return orig(token, name, args);
  })(h.mcp.callTool);
  const cookies = await leader(h);
  const first = await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/manage");
  const card = first.body.inbox.find(
    (c) => c.type === "departure" && c.player_tag === "#VGJJ",
  );
  assert.ok(card, "the departure is carded");
  assert.equal(card.player_name, "Ditaka", "named from players_names");
  assert.equal(card.role_at_raise, "elder", "role_at_departure is read");
  const named = first.body.inbox.find((c) => c.player_tag === "#GONE1");
  assert.equal(named.player_name, "Gone One", "an event with a name keeps it");
  const lookups = h.mcp.calls.filter(([n]) => n === "players_names");
  assert.equal(lookups.length, 1, "one bulk read");
  assert.deepEqual(lookups[0][2], { player_tags: ["#VGJJ"] });
  // The next evaluation asks nothing: the ledger carries the name now.
  h.clock.t += 60 * 60_000;
  const again = await api(
    h,
    cookies,
    "GET",
    "/api/clans/2PQRJ8LV/manage?refresh=1",
  );
  assert.equal(
    again.body.inbox.find((c) => c.player_tag === "#VGJJ").player_name,
    "Ditaka",
  );
  assert.equal(h.mcp.calls.filter(([n]) => n === "players_names").length, 1);
  // The timeline names the row from the card it raised.
  const hist = await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/history");
  const row = hist.body.timeline.find((e) => e.player_tag === "#VGJJ");
  assert.equal(row.name, "Ditaka");
  assert.equal(row.role, "elder");
});

test("cards: the inbox carries paste-ready in-game copy, clan-chat safe", async () => {
  const h = harness({ part: partClan() });
  const cookies = await leader(h);
  const r = await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/manage");
  const removal = r.body.inbox.find((c) => c.type === "removal");
  assert.match(
    removal.copy,
    /^Sleepy was removed for inactivity \(20 days without a battle\)/,
  );
  assert.ok(removal.copy.length <= 200);
  assert.doesNotMatch(removal.copy, /[&]|\+\d/);
});

test("away: a member marks themselves away within the policy's cap; the clock pauses; a leader can clear it; a leader's hold is not theirs to move", async () => {
  const ledger = ledgerWithPolicy(
    createMemoryLedger(),
    "#2PQRJ8LV",
    EXAMPLE_POLICY,
  );
  const member = harness({
    players: [
      player({ player_tag: "#8QCV", name: "Sleepy", clan_role: "member" }),
    ],
    part: partClan(),
    ledger,
  });
  const mc = await leader(member);
  const before = await api(member, mc, "GET", "/api/clans/2PQRJ8LV/me/away");
  assert.deepEqual(before.body, { allowed: true, max_days: 30, hold: null });
  const tooLong = await api(member, mc, "PUT", "/api/clans/2PQRJ8LV/me/away", {
    until: new Date(NOW.getTime() + 45 * DAY).toISOString(),
  });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.body.error, "too_long");
  const set = await api(member, mc, "PUT", "/api/clans/2PQRJ8LV/me/away", {
    until: new Date(NOW.getTime() + 10 * DAY).toISOString(),
    note: "Holiday, back on the 22nd",
  });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.kind, "away");
  assert.equal(set.body.by, "#8QCV");

  const lead = harness({ part: partClan(), ledger });
  const lc = await leader(lead);
  const view = await api(
    lead,
    lc,
    "GET",
    "/api/clans/2PQRJ8LV/manage?refresh=1",
  );
  const row = view.body.board.find((m) => m.player_tag === "#8QCV");
  assert.equal(row.hold.kind, "away");
  assert.equal(
    row.removal.state,
    "at_risk",
    "on hold the clock stops at at-risk",
  );
  assert.ok(
    !view.body.inbox.some(
      (c) => c.type === "removal" && c.player_tag === "#8QCV",
    ),
  );

  // A leader replaces it with their own hold; the member can no longer move it.
  await api(lead, lc, "PUT", "/api/clans/2PQRJ8LV/holds/8QCV", {
    until: null,
    note: "leader hold",
  });
  const blocked = await api(
    member,
    mc,
    "DELETE",
    "/api/clans/2PQRJ8LV/me/away",
  );
  assert.equal(blocked.status, 409);
  await api(lead, lc, "DELETE", "/api/clans/2PQRJ8LV/holds/8QCV");
  const cleared = await api(member, mc, "GET", "/api/clans/2PQRJ8LV/me/away");
  assert.equal(cleared.body.hold, null);

  // The policy can turn it off.
  const pol = (await api(lead, lc, "GET", "/api/clans/2PQRJ8LV/policy")).body
    .current.values;
  await api(lead, lc, "POST", "/api/clans/2PQRJ8LV/policy", {
    values: { ...pol, away_max_days: 0 },
  });
  const off = await api(member, mc, "PUT", "/api/clans/2PQRJ8LV/me/away", {
    until: new Date(NOW.getTime() + 2 * DAY).toISOString(),
  });
  assert.equal(off.status, 403);
});

// ---- the smallest clan a policy engages with (Jamie, 2026-09-25) ------------

const smallClan = (n) =>
  participation([king, ...others.slice(0, n - 1)], {
    clan_tag: "#2PQRJ8LV",
    name: "Example Clan",
  });

test("below 10 members Elixir Clan is a statistics view: the roster works, no policy can be created", async () => {
  const h = harness({ part: smallClan(6), policy: null });
  const cookies = await leader(h);
  const roster = await api(h, cookies, "GET", "/api/roster?clan=2PQRJ8LV");
  assert.equal(roster.status, 200);
  const view = await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/policy");
  assert.equal(view.status, 200);
  assert.equal(view.body.members, 6);
  assert.equal(view.body.min_members, 10);
  assert.equal(view.body.big_enough, false);
  const save = await api(h, cookies, "POST", "/api/clans/2PQRJ8LV/policy", {
    values: EXAMPLE_POLICY,
  });
  assert.equal(save.status, 409);
  assert.deepEqual(save.body, {
    error: "too_few_members",
    members: 6,
    min_members: 10,
  });
  assert.equal(await h.ledger.currentPolicy("#2PQRJ8LV"), null);
  const preview = await api(
    h,
    cookies,
    "POST",
    "/api/clans/2PQRJ8LV/policy/preview",
    { values: EXAMPLE_POLICY },
  );
  assert.equal(preview.body.error, "too_few_members");
  // Scout still reads an applicant; it judges nobody in the clan.
  assert.equal(
    (await api(h, cookies, "POST", "/api/clans/2PQRJ8LV/scout", { tag: "2PP" }))
      .status,
    200,
  );
  const me = await api(h, cookies, "GET", "/api/me");
  assert.equal(me.body.policy.members, 6);
  assert.equal(me.body.policy.active, false);
});

test("a clan with a policy that falls below 10 pauses, keeps its policy, and resumes at 10", async () => {
  const ledger = ledgerWithPolicy(
    createMemoryLedger(),
    "#2PQRJ8LV",
    EXAMPLE_POLICY,
  );
  const small = harness({ part: smallClan(8), ledger });
  const sc = await leader(small);
  for (const path of [
    "/api/clans/2PQRJ8LV/manage",
    "/api/clans/2PQRJ8LV/standing",
    "/api/clans/2PQRJ8LV/history",
    "/api/clans/2PQRJ8LV/members/2PP/notes",
  ]) {
    const r = await api(small, sc, "GET", path);
    assert.equal(r.status, 409, path);
    assert.equal(r.body.error, "too_few_members", path);
    assert.equal(r.body.members, 8, path);
  }
  // Nothing was judged: no card, no snapshot, the policy kept.
  assert.deepEqual(await ledger.cards("#2PQRJ8LV"), []);
  assert.equal(await ledger.latestVerdicts("#2PQRJ8LV"), null);
  assert.equal((await ledger.currentPolicy("#2PQRJ8LV")).version, 1);
  const me = await api(small, sc, "GET", "/api/me");
  assert.equal(me.body.policy.set, true);
  assert.equal(me.body.policy.active, false);
  assert.equal(me.body.open_actions, 0);
  // The clan grows back to 12: the next evaluation re-reads and resumes.
  const grown = harness({ part: partClan(), ledger });
  const gc = await leader(grown);
  const r = await api(grown, gc, "GET", "/api/clans/2PQRJ8LV/manage");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await ledger.clanSize("#2PQRJ8LV")).members, 12);
  assert.equal(
    (await api(grown, gc, "GET", "/api/me")).body.policy.active,
    true,
  );
});

// ---- actions and their logs (Jamie, 2026-09-25) ------------------------------

test("actions: a leader's action carries a log of what raised it; completing and commenting add to it", async () => {
  const h = harness({ part: partClan() });
  const cookies = await leader(h);
  const view = await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/actions");
  assert.equal(view.status, 200, JSON.stringify(view.body));
  const removal = view.body.open.find((a) => a.type === "removal");
  assert.equal(removal.label, "Remove from the clan");
  assert.deepEqual(removal.audience, { kind: "leaders" });
  assert.equal(removal.can_act, true);
  const raised = removal.log[0];
  assert.equal(raised.kind, "raised");
  assert.deepEqual(raised.by, { system: "elixir-clan" });
  assert.match(raised.text, /20 battle-free days/);
  assert.equal(raised.detail.policy_version, 1);
  assert.deepEqual(raised.detail.clauses, ["at_risk_days", "confirm_days"]);
  assert.ok(raised.detail.facts.some((f) => f.startsWith("Last battle:")));
  assert.deepEqual(raised.detail.prior, []);
  // Anyone who may see it can comment, before or after it closes.
  const said = await api(
    h,
    cookies,
    "POST",
    `/api/clans/2PQRJ8LV/actions/${removal.card_id}/comments`,
    { text: "Messaged them in game first." },
  );
  assert.equal(said.status, 200);
  const done = await api(
    h,
    cookies,
    "POST",
    `/api/clans/2PQRJ8LV/actions/${removal.card_id}/decide`,
    { status: "done", note: "Kicked after the message." },
  );
  assert.equal(done.status, 200);
  await api(
    h,
    cookies,
    "POST",
    `/api/clans/2PQRJ8LV/actions/${removal.card_id}/comments`,
    { text: "Right call." },
  );
  const after = await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/actions");
  const closed = after.body.recent.find((a) => a.card_id === removal.card_id);
  assert.equal(closed.can_act, false);
  assert.deepEqual(
    closed.log.map((e) => [e.kind, e.text]),
    [
      ["raised", raised.text],
      ["comment", "Messaged them in game first."],
      ["completed", "Kicked after the message."],
      ["comment", "Right call."],
    ],
  );
  assert.equal(closed.log[2].by.tag, "#20QQL8CCRU");
  assert.equal(closed.log[2].by.role, "leader");
  const empty = await api(
    h,
    cookies,
    "POST",
    `/api/clans/2PQRJ8LV/actions/${removal.card_id}/comments`,
    { text: "   " },
  );
  assert.equal(empty.status, 400);
});

test("actions: a re-raised action names the earlier one it follows; a withdrawal is logged with why", async () => {
  const h = harness({ part: partClan() });
  const cookies = await leader(h);
  const first = (
    await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/actions")
  ).body.open.find((a) => a.type === "removal");
  await api(
    h,
    cookies,
    "POST",
    `/api/clans/2PQRJ8LV/actions/${first.card_id}/decide`,
    { status: "declined", reason: "knows_the_member" },
  );
  h.clock.t += 8 * DAY;
  const again = (
    await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/actions?refresh=1")
  ).body.open.find((a) => a.type === "removal");
  assert.notEqual(again.card_id, first.card_id);
  assert.deepEqual(
    again.log[0].detail.prior.map((p) => [p.card_id, p.status, p.reason]),
    [[first.card_id, "declined", "knows_the_member"]],
  );
});

test("actions: members and elders see only what is theirs; a leader's action is refused to them", async () => {
  const lh = harness({ part: partClan() });
  const lc = await leader(lh);
  const removal = (
    await api(lh, lc, "GET", "/api/clans/2PQRJ8LV/actions")
  ).body.open.find((a) => a.type === "removal");
  const eh = harness({
    players: [player({ player_tag: "#O1", clan_role: "elder" })],
    part: partClan(),
    ledger: lh.ledger,
  });
  const ec = await leader(eh);
  const elderView = await api(eh, ec, "GET", "/api/clans/2PQRJ8LV/actions");
  assert.equal(elderView.status, 200);
  assert.ok(!elderView.body.open.some((a) => a.type === "removal"));
  const refused = await api(
    eh,
    ec,
    "POST",
    `/api/clans/2PQRJ8LV/actions/${removal.card_id}/decide`,
    { status: "done" },
  );
  assert.equal(refused.status, 403);
  const hidden = await api(
    eh,
    ec,
    "POST",
    `/api/clans/2PQRJ8LV/actions/${removal.card_id}/comments`,
    { text: "hm" },
  );
  assert.equal(hidden.status, 404);
  assert.equal((await api(eh, ec, "GET", "/api/me")).body.open_actions, 0);
  const leaderOpen = (await api(lh, lc, "GET", "/api/clans/2PQRJ8LV/actions"))
    .body.open.length;
  assert.ok(leaderOpen >= 1);
  assert.equal(
    (await api(lh, lc, "GET", "/api/me")).body.open_actions,
    leaderOpen,
  );
});

test("actions: a newcomer's welcome is for elders and leaders, with a line for clan chat", async () => {
  const ledger = ledgerWithPolicy(createMemoryLedger(), "#2PQRJ8LV", {
    ...EXAMPLE_POLICY,
    welcome_enabled: true,
  });
  const joined = {
    ...rosterBody(
      partClan().members.map((m) => ({ player_tag: m.player_tag })),
    ),
    recent_events: [
      {
        type: "member_joined",
        at: new Date(NOW.getTime() - DAY).toISOString(),
        detail: { player_tag: "#O3", name: "Newbie", role: "member" },
      },
    ],
  };
  const eh = harness({
    players: [player({ player_tag: "#O1", clan_role: "elder" })],
    part: partClan(),
    ledger,
    roster: joined,
  });
  const ec = await leader(eh);
  const view = await api(eh, ec, "GET", "/api/clans/2PQRJ8LV/actions");
  const welcome = view.body.open.find((a) => a.type === "welcome");
  assert.ok(welcome, JSON.stringify(view.body.open.map((a) => a.type)));
  assert.equal(welcome.label, "Welcome a newcomer");
  assert.deepEqual(welcome.audience, { kind: "elders" });
  assert.equal(welcome.copy, "Welcome to the clan, Newbie!");
  assert.match(welcome.log[0].text, /Newbie joined the clan/);
  // An elder completes it without a reason; the log says who.
  const done = await api(
    eh,
    ec,
    "POST",
    `/api/clans/2PQRJ8LV/actions/${welcome.card_id}/decide`,
    { status: "done" },
  );
  assert.equal(done.status, 200);
  const log = await ledger.actionLog("#2PQRJ8LV", welcome.card_id);
  assert.deepEqual(
    log.map((e) => [e.kind, e.by.tag ?? e.by.system]),
    [
      ["raised", "elixir-clan"],
      ["completed", "#O1"],
    ],
  );
  // One welcome per join: the next look raises none.
  eh.clock.t += 10 * 60_000;
  const next = await api(
    eh,
    ec,
    "GET",
    "/api/clans/2PQRJ8LV/actions?refresh=1",
  );
  assert.ok(!next.body.open.some((a) => a.type === "welcome"));
});

test("actions: a quiet member is asked if they are away, on their own actions, and marking away completes it", async () => {
  const ledger = ledgerWithPolicy(createMemoryLedger(), "#2PQRJ8LV", {
    ...EXAMPLE_POLICY,
    away_suggestions_enabled: true,
  });
  const mh = harness({
    players: [
      player({ player_tag: "#8QCV", name: "Sleepy", clan_role: "member" }),
    ],
    part: partClan(),
    ledger,
  });
  const mc = await leader(mh);
  const view = await api(mh, mc, "GET", "/api/clans/2PQRJ8LV/actions");
  assert.equal(view.status, 200, JSON.stringify(view.body));
  assert.deepEqual(
    view.body.open.map((a) => [a.type, a.audience]),
    [["away", { kind: "member", player_tag: "#8QCV" }]],
    "the member sees their own away question, never the removal",
  );
  assert.equal((await api(mh, mc, "GET", "/api/me")).body.open_actions, 1);
  const away = view.body.open[0];
  await api(mh, mc, "PUT", "/api/clans/2PQRJ8LV/me/away", {
    until: new Date(NOW.getTime() + 7 * DAY).toISOString(),
  });
  const closed = await ledger.card("#2PQRJ8LV", away.card_id);
  assert.equal(closed.status, "done");
  const log = await ledger.actionLog("#2PQRJ8LV", away.card_id);
  assert.equal(log.at(-1).kind, "completed");
  assert.match(log.at(-1).text, /^Marked away until/);
  // A leader never sees the member's own question.
  const lh = harness({ part: partClan(), ledger });
  const lc = await leader(lh);
  const leaderView = await api(lh, lc, "GET", "/api/clans/2PQRJ8LV/actions");
  assert.ok(
    ![...leaderView.body.open, ...leaderView.body.recent].some(
      (a) => a.type === "away",
    ),
  );
});

test("actions: an action from before logs were kept gets its log reconstructed from its own fields", async () => {
  const ledger = ledgerWithPolicy(
    createMemoryLedger(),
    "#2PQRJ8LV",
    EXAMPLE_POLICY,
  );
  await ledger.putCard("#2PQRJ8LV", {
    card_id: "legacy1",
    clan_tag: "#2PQRJ8LV",
    player_tag: "#GONE",
    player_name: "Gone",
    type: "removal",
    status: "done",
    raised_at: new Date(NOW.getTime() - 3 * DAY).toISOString(),
    decided_at: new Date(NOW.getTime() - 2 * DAY).toISOString(),
    decided_by: "#20QQL8CCRU",
    policy_version: 0,
    evidence: { rationale: { headline: "12 battle-free days." } },
    outcome: {
      verified_at: new Date(NOW.getTime() - DAY).toISOString(),
      classification: "member_kicked",
    },
  });
  const h = harness({ part: partClan(), ledger });
  const cookies = await leader(h);
  const view = await api(h, cookies, "GET", "/api/clans/2PQRJ8LV/actions");
  const legacy = view.body.recent.find((a) => a.card_id === "legacy1");
  assert.deepEqual(
    legacy.log.map((e) => e.kind),
    ["raised", "completed", "outcome_verified"],
  );
  assert.ok(legacy.log.every((e) => e.detail?.reconstructed === true));
  assert.equal(legacy.log[0].text, "12 battle-free days.");
});
