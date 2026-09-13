/**
 * Awards over the real handler: grants written once when a season has
 * closed, the live races, a leaders' pick by hand, the versioned
 * document, the trophy case, and the public document with its switch.
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

function harness({ players = [player()], part } = {}) {
  const clock = { t: NOW.getTime() };
  const now = () => clock.t;
  const mcp = fakeMcp({ players });
  const inner = mcp.callTool.bind(mcp);
  mcp.callTool = async (token, name, args) => {
    mcp.calls.push([name, token, args]);
    if (name === "clans_participation") return { ok: true, body: part };
    return inner(token, name, args);
  };
  const ledger = createMemoryLedger();
  const handler = createHandler({
    mcp,
    oauth: fakeOAuth({ now }),
    store: createMemoryStore(),
    manage: createManageService({ ledger, mcp, now }),
    awards: createAwardsService({
      ledger,
      now,
      participationFor: (token, tag) => fetchParticipation(mcp, token, tag),
    }),
    scout: createScout({ mcp, now }),
    sessionSecret: "s",
    appUrl: "https://clan.test",
    elixirUrl: "https://elixir.test",
    now,
    log: { warn() {}, error() {} },
  });
  return { clock, mcp, ledger, handler };
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
  return {
    status: r.statusCode,
    headers: r.headers,
    body: r.body ? JSON.parse(r.body) : null,
  };
};
const signedIn = async (h) => cookieHeader((await signIn(h)).sessionCookie);

const king = member("#20JJJ2CCRU", {
  name: "King Thing",
  role: "leader",
  war: [16, 16, 16, 16, 16, 8],
});
const levy = member("#U8RYG9Y2U", {
  name: "King Levy",
  role: "coLeader",
  war: [16, 16, 16, 16, 12, 8],
  donations: [500, 500, 500, 500, 500, 100],
});
const amy = member("#8QCV", {
  name: "Amy",
  role: "member",
  tenureDays: 25,
  war: [0, 0, 0, 0, 14, 8],
});
const partClan = () =>
  participation([king, levy, amy], {
    clan_tag: "#J2RGCRVG",
    name: "POAP KINGS",
  });
const BASE = "/api/clans/J2RGCRVG/awards";

test("awards: the first look after a season closes writes the grants once; the open season is live", async () => {
  const h = harness({ part: partClan() });
  const cookies = await signedIn(h);
  const r = await api(h, cookies, "GET", `${BASE}/manage`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.can_edit, true);
  assert.deepEqual(r.body.can_grant, ["free_pass"]);
  assert.equal(r.body.config_version, 0);
  const s135 = r.body.seasons.find((s) => s.season_id === 135);
  assert.equal(s135.closed, true);
  const champ = s135.awards.find((a) => a.award_id === "war_champ");
  assert.equal(champ.state, "closed");
  assert.deepEqual(
    champ.rows.map((x) => [x.player_tag, x.official_rank]),
    [
      ["#20JJJ2CCRU", 1],
      ["#U8RYG9Y2U", 2],
      ["#8QCV", 3],
    ],
  );
  const grants = r.body.grants;
  assert.deepEqual(
    grants
      .filter((g) => g.award_id === "war_champ")
      .map((g) => [g.rank, g.player_name, g.metric_value, g.manual]),
    [
      [1, "King Thing", 16000, false],
      [2, "King Levy", 15200, false],
      [3, "Amy", 2800, false],
    ],
  );
  assert.deepEqual(
    grants.filter((g) => g.award_id === "iron_king").map((g) => g.player_tag),
    ["#20JJJ2CCRU"],
  );
  assert.deepEqual(
    grants.filter((g) => g.award_id === "rookie_mvp").map((g) => g.player_tag),
    ["#8QCV"],
    "Amy joined in the last week of 135: her first season",
  );
  const s136 = r.body.seasons.find((s) => s.season_id === 136);
  assert.equal(
    s136.awards.find((a) => a.award_id === "war_champ").state,
    "live",
  );
  assert.ok(!grants.some((g) => g.season_id === 136));

  // A second look is cached and grants nothing more.
  const again = await api(h, cookies, "GET", `${BASE}/manage`);
  assert.equal(again.body.cached, true);
  assert.equal(again.body.grants.length, grants.length);
  const forced = await api(h, cookies, "GET", `${BASE}/manage?refresh=1`);
  assert.equal(forced.body.cached, false);
  assert.equal(forced.body.grants.length, grants.length, "idempotent");
});

test("awards: a leaders' pick is granted by hand with a note, shows in the season, and can be taken back; computed grants cannot", async () => {
  const h = harness({ part: partClan() });
  const cookies = await signedIn(h);
  await api(h, cookies, "GET", `${BASE}/manage`);
  const g = await api(h, cookies, "POST", `${BASE}/grants`, {
    award_id: "free_pass",
    player_tag: "U8RYG9Y2U",
    player_name: "King Levy",
    season_id: 135,
    note: "Second on points; King Thing held it last season.",
  });
  assert.equal(g.status, 200, JSON.stringify(g.body));
  assert.equal(g.body.player_tag, "#U8RYG9Y2U");
  assert.equal(g.body.manual, true);
  assert.equal(g.body.granted_by, "#20JJJ2CCRU");
  const view = await api(h, cookies, "GET", `${BASE}/manage`);
  const fp = view.body.seasons
    .find((s) => s.season_id === 135)
    .awards.find((a) => a.award_id === "free_pass");
  assert.equal(fp.state, "manual");
  assert.equal(fp.rows[0].name, "King Levy");
  assert.match(fp.rows[0].note, /held it last season/);

  const notManual = await api(h, cookies, "POST", `${BASE}/grants`, {
    award_id: "war_champ",
    player_tag: "8QCV",
    season_id: 135,
  });
  assert.equal(notManual.status, 400);
  assert.equal(notManual.body.error, "not_manual");

  const keep = await api(
    h,
    cookies,
    "DELETE",
    `${BASE}/grants/135/war_champ/20JJJ2CCRU`,
  );
  assert.equal(keep.status, 400, "a computed grant is the record's");
  const gone = await api(
    h,
    cookies,
    "DELETE",
    `${BASE}/grants/135/free_pass/U8RYG9Y2U`,
  );
  assert.equal(gone.status, 200);
  const after = await api(h, cookies, "GET", `${BASE}/manage`);
  assert.ok(!after.body.grants.some((x) => x.award_id === "free_pass"));
});

test("awards: an elder sees Manage ▸ Awards and grants only what elders may; a member is refused", async () => {
  const elderH = harness({
    players: [player({ player_tag: "#8QCV", name: "Amy", clan_role: "elder" })],
    part: partClan(),
  });
  const cookies = await signedIn(elderH);
  const r = await api(elderH, cookies, "GET", `${BASE}/manage`);
  assert.equal(r.status, 200);
  assert.equal(r.body.can_edit, false);
  assert.deepEqual(
    r.body.can_grant,
    [],
    "Free Pass is leaders-only by default",
  );
  const refused = await api(elderH, cookies, "POST", `${BASE}/grants`, {
    award_id: "free_pass",
    player_tag: "20JJJ2CCRU",
    season_id: 135,
  });
  assert.equal(refused.status, 403);
  const config = await api(elderH, cookies, "POST", `${BASE}/config`, {
    values: {},
  });
  assert.equal(config.status, 403);

  const memberH = harness({
    players: [
      player({ player_tag: "#8QCV", name: "Amy", clan_role: "member" }),
    ],
    part: partClan(),
  });
  const mc = await signedIn(memberH);
  assert.equal((await api(memberH, mc, "GET", `${BASE}/manage`)).status, 403);
});

test("awards: a leader renames, retunes, adds and switches off awards; every save is a version; bad values are refused in words", async () => {
  const h = harness({ part: partClan() });
  const cookies = await signedIn(h);
  const before = (await api(h, cookies, "GET", `${BASE}/manage`)).body;
  const values = structuredClone(before.config);
  values.awards[0].name = "Boat Captain";
  values.awards[1].params.decks_per_day = 3;
  values.awards[3].enabled = false;
  values.awards.push({
    id: "clanmate",
    kind: "leaders_pick",
    name: "Clanmate of the Month",
    description: "Whoever made the clan better this month.",
    enabled: true,
    params: { granted_by: "elders" },
  });
  values.publish = true;
  const saved = await api(h, cookies, "POST", `${BASE}/config`, {
    values,
    note: "renamed, loosened Iron King, added a pick",
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.version, 1);
  const after = (await api(h, cookies, "GET", `${BASE}/manage?refresh=1`)).body;
  assert.equal(after.config_version, 1);
  assert.equal(after.config.awards[0].name, "Boat Captain");
  assert.equal(after.config.publish, true);
  assert.deepEqual(after.can_grant, ["free_pass", "clanmate"]);
  assert.equal(
    after.versions[0].note,
    "renamed, loosened Iron King, added a pick",
  );
  // The live race carries the new name; the old grants keep the name they were given.
  const s136 = after.seasons.find((s) => s.season_id === 136);
  assert.equal(
    s136.awards.find((a) => a.award_id === "war_champ").name,
    "Boat Captain",
  );
  assert.equal(
    s136.awards.find((a) => a.award_id === "rookie_mvp").state,
    "off",
  );
  assert.equal(
    after.grants.find((g) => g.award_id === "war_champ" && g.rank === 1).name,
    "War Champ",
  );

  const bad = await api(h, cookies, "POST", `${BASE}/config`, {
    values: {
      awards: [
        { id: "x", kind: "donations_podium", name: "", params: { podium: 9 } },
      ],
    },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "invalid_awards");
  assert.match(bad.body.errors["awards.0.name"], /1 to 40/);
  assert.match(bad.body.errors["awards.0.params.podium"], /between 1 and 3/);
});

test("awards: the public document needs no session, is off until published, and carries every grant with cache headers", async () => {
  const h = harness({ part: partClan() });
  const anon = await api(h, undefined, "GET", BASE);
  assert.equal(anon.status, 404);
  assert.equal(anon.body.error, "not_published");
  assert.equal(anon.headers["cache-control"], "public, max-age=300");

  const cookies = await signedIn(h);
  const view = (await api(h, cookies, "GET", `${BASE}/manage`)).body;
  await api(h, cookies, "POST", `${BASE}/grants`, {
    award_id: "free_pass",
    player_tag: "U8RYG9Y2U",
    player_name: "King Levy",
    season_id: 135,
    note: "rotation",
  });
  const values = structuredClone(view.config);
  values.publish = true;
  await api(h, cookies, "POST", `${BASE}/config`, { values });

  const doc = await api(h, undefined, "GET", BASE);
  assert.equal(doc.status, 200);
  assert.equal(doc.headers["access-control-allow-origin"], "*");
  assert.equal(doc.body.contract, "1.0.0");
  assert.equal(doc.body.clan_tag, "#J2RGCRVG");
  assert.deepEqual(
    doc.body.awards.map((a) => [a.id, a.manual]),
    [
      ["war_champ", false],
      ["iron_king", false],
      ["donation_champ", false],
      ["rookie_mvp", false],
      ["free_pass", true],
    ],
  );
  assert.ok(doc.body.awards[0].rule.length > 10);
  const s135 = doc.body.seasons.find((s) => s.season_id === 135);
  assert.ok(
    s135.grants.find(
      (g) => g.award_id === "free_pass" && g.manual && g.note === "rotation",
    ),
  );
  assert.ok(
    s135.grants.find(
      (g) =>
        g.award_id === "war_champ" &&
        g.rank === 1 &&
        g.player_name === "King Thing",
    ),
  );
  assert.ok(
    !doc.body.seasons.some((s) => s.season_id === 136),
    "nothing granted for the open season",
  );
});

test("awards: a member's trophy case lists their grants, newest season first", async () => {
  const h = harness({ part: partClan() });
  const cookies = await signedIn(h);
  await api(h, cookies, "GET", `${BASE}/manage`);
  const r = await api(
    h,
    cookies,
    "GET",
    "/api/clans/J2RGCRVG/members/20JJJ2CCRU/grants",
  );
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.body.grants.map((g) => [g.season_id, g.award_id, g.rank]),
    [
      [135, "iron_king", 1],
      [135, "war_champ", 1],
      [135, "donation_champ", 2],
    ],
  );
});
