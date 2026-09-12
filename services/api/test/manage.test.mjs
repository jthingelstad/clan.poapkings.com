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
} from "./fakes.mjs";
import { member, participation, NOW } from "../../engine/test/fixture.mjs";

const DAY = 86400_000;

/** A door that also answers clans_participation and the scout's live reads. */
function door({ players, part, profile = null, log = null }) {
  const mcp = fakeMcp({ players });
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
            error: { code: "live_pending", hint: "Call again in 45 s." },
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
  ledger = createMemoryLedger(),
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
const king = member("#20JJJ2CCRU", { name: "King Thing", role: "leader" });
const partClan = () =>
  participation([king, ...others, idle], {
    clan_tag: "#J2RGCRVG",
    name: "POAP KINGS",
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
  const r = await api(h, cookies, "GET", "/api/clans/J2RGCRVG/manage");
  assert.equal(r.status, 200);
  assert.equal(r.body.cached, false);
  assert.equal(r.body.policy_version, 0, "defaults until a policy is saved");
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
  const again = await api(h, cookies, "GET", "/api/clans/J2RGCRVG/manage");
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

test("manage: a member is refused; a foreign clan is refused", async () => {
  const h = harness({
    players: [player({ clan_role: "member" })],
    part: partClan(),
  });
  const cookies = await leader(h);
  assert.equal(
    (await api(h, cookies, "GET", "/api/clans/J2RGCRVG/manage")).status,
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
  const first = await api(h, cookies, "GET", "/api/clans/J2RGCRVG/manage");
  const card = first.body.inbox.find((c) => c.type === "removal");
  const bad = await api(
    h,
    cookies,
    "POST",
    `/api/clans/J2RGCRVG/cards/${card.card_id}/decide`,
    { status: "declined" },
  );
  assert.equal(bad.status, 400);
  const declined = await api(
    h,
    cookies,
    "POST",
    `/api/clans/J2RGCRVG/cards/${card.card_id}/decide`,
    { status: "declined", reason: "not_now" },
  );
  assert.equal(declined.status, 200);
  assert.equal(declined.body.decided_by, "#20JJJ2CCRU");
  const twice = await api(
    h,
    cookies,
    "POST",
    `/api/clans/J2RGCRVG/cards/${card.card_id}/decide`,
    { status: "done" },
  );
  assert.equal(twice.status, 409);
  const next = await api(
    h,
    cookies,
    "GET",
    "/api/clans/J2RGCRVG/manage?refresh=1",
  );
  assert.equal(
    next.body.inbox.filter((c) => c.type === "removal").length,
    0,
    "inside the cooldown, no new card",
  );
  h.clock.t += 8 * DAY;
  const later = await api(h, cookies, "GET", "/api/clans/J2RGCRVG/manage");
  assert.equal(
    later.body.inbox.filter((c) => c.type === "removal").length,
    1,
    "re-nominated after the cooldown",
  );
  const hist = await api(h, cookies, "GET", "/api/clans/J2RGCRVG/history");
  assert.equal(hist.body.cards[0].status, "declined");
});

test("cards: auto-withdraw when the member plays; done removal verified when the membership closes", async () => {
  const h = harness({ part: partClan() });
  const cookies = await leader(h);
  const first = await api(h, cookies, "GET", "/api/clans/J2RGCRVG/manage");
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
    { clan_tag: "#J2RGCRVG" },
  );
  h.mcp.callTool = ((orig) => (token, name, args) =>
    name === "clans_participation"
      ? Promise.resolve({ ok: true, body: played })
      : orig(token, name, args))(h.mcp.callTool);
  h.clock.t += 6 * 60_000;
  const second = await api(h, cookies, "GET", "/api/clans/J2RGCRVG/manage");
  assert.equal(
    second.body.inbox.length,
    second.body.inbox.filter((c) => c.card_id !== card.card_id).length,
  );
  const hist = await api(h, cookies, "GET", "/api/clans/J2RGCRVG/history");
  const w = hist.body.cards.find((c) => c.card_id === card.card_id);
  assert.equal(w.status, "withdrawn");
  assert.match(w.withdraw_reason, /played/);
});

test("cards: a done removal is verified when the record no longer lists the member; otherwise flagged after the window", async () => {
  const h = harness({ part: partClan() });
  const cookies = await leader(h);
  const first = await api(h, cookies, "GET", "/api/clans/J2RGCRVG/manage");
  const card = first.body.inbox.find((c) => c.type === "removal");
  await api(
    h,
    cookies,
    "POST",
    `/api/clans/J2RGCRVG/cards/${card.card_id}/decide`,
    { status: "done" },
  );
  const gone = participation([king, ...others], { clan_tag: "#J2RGCRVG" });
  h.mcp.callTool = ((orig) => (token, name, args) =>
    name === "clans_participation"
      ? Promise.resolve({ ok: true, body: gone })
      : orig(token, name, args))(h.mcp.callTool);
  h.clock.t += 6 * 3600_000;
  await api(h, cookies, "GET", "/api/clans/J2RGCRVG/manage");
  const hist = await api(h, cookies, "GET", "/api/clans/J2RGCRVG/history");
  const done = hist.body.cards.find((c) => c.card_id === card.card_id);
  assert.equal(done.outcome.classification, "member_kicked");
  assert.equal(done.outcome.delay_hours, 6);

  // A done card with no change inside the window is flagged, not reversed.
  const h2 = harness({ part: partClan() });
  const c2 = await leader(h2);
  const f2 = await api(h2, c2, "GET", "/api/clans/J2RGCRVG/manage");
  const card2 = f2.body.inbox.find((c) => c.type === "removal");
  await api(
    h2,
    c2,
    "POST",
    `/api/clans/J2RGCRVG/cards/${card2.card_id}/decide`,
    { status: "done" },
  );
  h2.clock.t += 49 * 3600_000;
  await api(h2, c2, "GET", "/api/clans/J2RGCRVG/manage");
  const h2hist = await api(h2, c2, "GET", "/api/clans/J2RGCRVG/history");
  assert.ok(
    h2hist.body.cards.find((c) => c.card_id === card2.card_id).outcome
      .flagged_at,
  );
});

test("holds pause the clock and show on the member; a member cannot set one", async () => {
  const h = harness({ part: partClan() });
  const cookies = await leader(h);
  const set = await api(h, cookies, "PUT", "/api/clans/J2RGCRVG/holds/8QCV", {
    until: new Date(NOW.getTime() + 3 * DAY).toISOString(),
    note: "away",
  });
  assert.equal(set.status, 200);
  const view = await api(
    h,
    cookies,
    "GET",
    "/api/clans/J2RGCRVG/manage?refresh=1",
  );
  const row = view.body.board.find((m) => m.player_tag === "#8QCV");
  assert.equal(row.removal.shielded, "hold");
  assert.equal(row.bucket, "held");
  assert.equal(
    view.body.inbox.filter((c) => c.player_tag === "#8QCV").length,
    0,
  );
  assert.equal(
    (await api(h, cookies, "DELETE", "/api/clans/J2RGCRVG/holds/8QCV")).status,
    200,
  );
});

test("notes: elders write and read elder notes; leaders write leader notes and read both; members see none", async () => {
  const ledger = createMemoryLedger(); // one clan ledger, three people
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
    "/api/clans/J2RGCRVG/members/2PP/notes",
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
    "/api/clans/J2RGCRVG/members/2PP/notes",
    { text: "Talked about elder." },
  );
  assert.equal(lNote.body.tier, "leader");
  const leaderSees = await api(
    hl,
    lCookies,
    "GET",
    "/api/clans/J2RGCRVG/members/2PP/notes",
  );
  assert.deepEqual(leaderSees.body.notes.map((n) => n.tier).sort(), [
    "elder",
    "leader",
  ]);
  const elderSees = await api(
    he,
    eCookies,
    "GET",
    "/api/clans/J2RGCRVG/members/2PP/notes",
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
    (await api(hm, mCookies, "GET", "/api/clans/J2RGCRVG/members/2PP/notes"))
      .status,
    403,
  );
  assert.equal(
    (await api(hm, mCookies, "GET", "/api/clans/J2RGCRVG/manage")).status,
    403,
  );
});

test("policy: versions are immutable, validated in a leader's words, previewable before save", async () => {
  const h = harness({ part: partClan() });
  const cookies = await leader(h);
  const view = await api(h, cookies, "GET", "/api/clans/J2RGCRVG/policy");
  assert.equal(view.body.current.version, 0);
  assert.equal(view.body.can_edit, true);
  assert.ok(view.body.fields.at_risk_days.why);
  const bad = await api(h, cookies, "POST", "/api/clans/J2RGCRVG/policy", {
    values: { band_ceiling_share: 0.1 },
  });
  assert.equal(bad.status, 400);
  assert.match(bad.body.errors.band_ceiling_share, /cannot be below the floor/);
  const preview = await api(
    h,
    cookies,
    "POST",
    "/api/clans/J2RGCRVG/policy/preview",
    { values: { at_risk_days: 30, confirm_days: 30 } },
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
  const saved = await api(h, cookies, "POST", "/api/clans/J2RGCRVG/policy", {
    values: { at_risk_days: 30, confirm_days: 30 },
    note: "more rope",
  });
  assert.equal(saved.body.version, 1);
  const saved2 = await api(h, cookies, "POST", "/api/clans/J2RGCRVG/policy", {
    values: { at_risk_days: 6 },
  });
  assert.equal(saved2.body.version, 2);
  const versions = (await api(h, cookies, "GET", "/api/clans/J2RGCRVG/policy"))
    .body.versions;
  assert.deepEqual(
    versions.map((v) => v.version),
    [2, 1],
  );
  // A new version invalidates the cached evaluation.
  const view2 = await api(h, cookies, "GET", "/api/clans/J2RGCRVG/manage");
  assert.equal(view2.body.policy_version, 2);
  assert.equal(view2.body.cached, false);
});

test("standing for members: evidence in a player's terms, no internals; private when the policy says so", async () => {
  const h = harness({
    players: [player({ player_tag: "#O2", clan_role: "member" })],
    part: partClan(),
  });
  const cookies = await leader(h);
  const s = await api(h, cookies, "GET", "/api/clans/J2RGCRVG/standing");
  assert.equal(s.status, 200);
  assert.ok(s.body.rows.length > 0);
  assert.ok(!/\b(score|percentile|rank|slot)\b/i.test(JSON.stringify(s.body)));
  assert.ok(s.body.you);
  assert.equal(s.body.you.inactivity, null);
  // A leader turns transparency off: members are refused.
  const hl = harness({ part: partClan(), ledger: h.ledger });
  const lc = await leader(hl);
  await api(hl, lc, "POST", "/api/clans/J2RGCRVG/policy", {
    values: { members_see_standing: false },
  });
  assert.equal(
    (await api(h, cookies, "GET", "/api/clans/J2RGCRVG/standing")).status,
    403,
  );
});

test("how-elder-works is public and renders from the current policy", async () => {
  const h = harness({ part: partClan() });
  const r = await h.handler(req("GET", "/api/clans/J2RGCRVG/how-elder-works"));
  assert.equal(r.statusCode, 200);
  const body = JSON.parse(r.body);
  assert.equal(body.values.tenure_min_days, 28);
  assert.ok(body.groups.length >= 8);
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
          battleCount: 500,
          wins: 300,
          losses: 200,
          collectionLevel: 900,
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
  const r = await api(h, cookies, "POST", "/api/clans/J2RGCRVG/scout", {
    tag: "2pp",
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.player_tag, "#2PP");
  assert.equal(r.body.pending, null);
  assert.equal(r.body.profile.trophies, 7000);
  assert.equal(r.body.profile.clan_war_wins, 12);
  assert.equal(r.body.log.win_rate, 0.8);
  assert.equal(r.body.policy_answer.floor.war.days, 2);
  assert.equal(r.body.policy_answer.floor.ranked.battles, 2);
  assert.equal(r.body.policy_answer.floor.passes, true);
  assert.equal(r.body.policy_answer.floor.bounded_by_log, false);
  assert.equal(r.body.policy_answer.inactivity.state, "active");
  const pending = harness({ part: partClan() });
  const pc = await leader(pending);
  const p = await api(pending, pc, "POST", "/api/clans/J2RGCRVG/scout", {
    tag: "#2PP",
  });
  assert.equal(p.status, 200);
  assert.deepEqual(p.body.pending, { retry_after_s: 45 });
  assert.equal(p.body.profile, null);
  const badTag = await api(pending, pc, "POST", "/api/clans/J2RGCRVG/scout", {
    tag: "nope",
  });
  assert.equal(badTag.status, 400);
});

test("ManageError carries a status and code", () => {
  const e = new ManageError(403, "leaders_only");
  assert.equal(e.status, 403);
  assert.equal(e.code, "leaders_only");
});
