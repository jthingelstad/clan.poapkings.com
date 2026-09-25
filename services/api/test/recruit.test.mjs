/**
 * Recruiting over the real handler: every member reads the pitch, the
 * facts and the copy; a live read of the clan is cached for hours and a
 * pending one is passed through with the recorded roster standing in;
 * leaders save a versioned pitch, validated in words.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/store.mjs";
import { createHandler } from "../src/handler.mjs";
import { createMemoryLedger } from "../src/manage/ledger.mjs";
import { createRecruitService, FACTS_TTL_MS } from "../src/manage/recruit.mjs";
import {
  fakeMcp,
  fakeOAuth,
  player,
  req,
  signIn,
  cookieHeader,
  rosterBody,
  seedVersion,
} from "./fakes.mjs";

const CLAN = {
  tag: "#2PQRJ8LV",
  name: "Example Clan",
  members: 47,
  requiredTrophies: 5000,
  clanScore: 61234,
  clanWarTrophies: 3210,
  donationsPerWeek: 8400,
  memberList: [{ name: "Ada", trophies: 9000, donations: 300 }],
};

/** A clan's own pitch, saved by a leader. */
const PITCH = {
  schema: 1,
  tagline: "Steady wars, friendly chat",
  about: "A clan that plays together every week.",
  points: ["Wars every week"],
  looking_for: "Active players.",
  website_url: null,
  contact: "Request to join in game.",
};

function harness({
  players = [player()],
  ledger = seedVersion(createMemoryLedger(), "recruit", "#2PQRJ8LV", PITCH),
  live,
} = {}) {
  const clock = { t: Date.parse("2026-09-13T12:00:00Z") };
  const now = () => clock.t;
  const mcp = fakeMcp({
    players,
    roster: {
      ...rosterBody([
        {
          player_tag: "#20QQL8CCRU",
          name: "Ada",
          role: "leader",
          trophies: 9000,
          donations_this_week: 10,
        },
      ]),
      member_count: 47,
      type: "inviteOnly",
      description: "in-game description",
      clan_score: 130694,
      clan_war_trophies: 3100,
      scores_observed_at: "2026-09-12T17:58:00.000Z",
    },
  });
  const state = {
    live: live ?? { ok: true, body: { data: CLAN } },
    liveCalls: 0,
  };
  const inner = mcp.rawCallTool.bind(mcp);
  mcp.rawCallTool = async (token, name, args) => {
    if (name === "live_fetch") {
      state.liveCalls += 1;
      return typeof state.live === "function" ? state.live(args) : state.live;
    }
    return inner(token, name, args);
  };
  const handler = createHandler({
    mcp,
    oauth: fakeOAuth({ now }),
    store: createMemoryStore(),
    recruit: createRecruitService({ ledger, mcp, now }),
    sessionSecret: "s",
    appUrl: "https://clan.test",
    elixirUrl: "https://elixir.test",
    now,
    log: { warn() {}, error() {} },
  });
  return { clock, state, ledger, handler };
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
const signedIn = async (h) => cookieHeader((await signIn(h)).sessionCookie);
const PATH = "/api/clans/2PQRJ8LV/recruit";

test("recruit: a member gets the pitch, live facts and both formats, passing the checks; the live read is cached", async () => {
  const h = harness({
    players: [
      player({ player_tag: "#8QCV", name: "Amy", clan_role: "member" }),
    ],
  });
  const c = await signedIn(h);
  const r = await api(h, c, "GET", PATH);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.can_edit, false);
  assert.equal(r.body.pitch_version, 1);
  assert.equal(r.body.facts.source, "live");
  assert.equal(r.body.facts.required_trophies, 5000);
  assert.equal(r.body.facts.open_slots, 3);
  assert.deepEqual(r.body.problems, []);
  assert.deepEqual(Object.keys(r.body.copy), ["personal", "post"]);
  assert.match(r.body.copy.post.title, /\[5000\]$/);
  assert.match(r.body.copy.post.body, /Required Trophies: \[5000\]/);
  assert.ok(r.body.copy.personal.subject && r.body.copy.personal.body);
  assert.equal(h.state.liveCalls, 1);
  await api(h, c, "GET", PATH);
  assert.equal(h.state.liveCalls, 1, "cached for hours");
  h.clock.t += FACTS_TTL_MS + 1000;
  const again = await api(h, c, "GET", PATH);
  assert.equal(h.state.liveCalls, 2, "read again after the TTL");
  assert.equal(again.body.facts_cached, false);
});

test("recruit: a pending live read is passed through with the recorded roster standing in; a member's refresh does not spend a read", async () => {
  const h = harness({
    live: {
      ok: false,
      code: "live_pending",
      error: "queued",
      hint: "Call again in 30 s.",
      body: { error: { code: "live_pending", retry_after_s: 30 } },
    },
  });
  const c = await signedIn(h);
  const r = await api(h, c, "GET", PATH);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.facts.source, "recorded");
  assert.equal(r.body.facts.members, 47);
  // What the record already has stands in; the floor waits for the live read.
  assert.equal(r.body.facts.clan_score, 130694);
  assert.equal(r.body.facts.war_trophies, 3100);
  assert.equal(r.body.facts.type, "inviteOnly");
  assert.equal(r.body.facts.description, "in-game description");
  assert.equal(r.body.facts.required_trophies, null);
  assert.equal(r.body.pending.retry_after_s, 30);
  assert.doesNotMatch(r.body.copy.post.body, /Required Trophies/);
  assert.deepEqual(r.body.problems, []);
  // Now the read lands.
  h.state.live = { ok: true, body: { data: CLAN } };
  const landed = await api(h, c, "GET", PATH);
  assert.equal(landed.body.facts.source, "live");
  assert.equal(landed.body.pending, null);
  // A leader's refresh inside the floor is the cache; a member's never reads.
  const calls = h.state.liveCalls;
  await api(h, c, "GET", `${PATH}?refresh=1`);
  assert.equal(h.state.liveCalls, calls, "inside the ten-minute floor");
});

test("recruit: a leader saves a pitch as a new version and the copy follows; bad pitches are refused in words; members cannot", async () => {
  const ledger = createMemoryLedger();
  const lead = harness({ ledger });
  const lc = await signedIn(lead);
  // A clan starts with no pitch and so no copy: nothing is said for it.
  const empty = await api(lead, lc, "GET", PATH);
  assert.equal(empty.status, 200);
  assert.equal(empty.body.pitch_version, 0);
  assert.equal(empty.body.copy, null);
  assert.equal(empty.body.pitch.tagline, "");
  assert.equal(empty.body.facts.required_trophies, 5000);
  const saved = await api(lead, lc, "POST", PATH, {
    values: {
      tagline: "War first, drama never",
      about: "We play every war day.",
      points: "Four decks a day\nElders earn it",
      looking_for: "Players who show up.",
      website_url: "",
      contact: "Request in game.",
    },
    note: "first pitch",
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.version, 1);
  const view = await api(lead, lc, "GET", PATH);
  assert.equal(view.body.pitch_version, 1);
  assert.match(view.body.copy.post.title, /War first, drama never \[5000\]$/);
  assert.match(
    view.body.copy.post.body,
    /- Four decks a day\n- Elders earn it/,
  );
  assert.doesNotMatch(
    view.body.copy.post.body,
    /https:\/\//,
    "no website, no link",
  );
  assert.equal(view.body.versions[0].note, "first pitch");
  const bad = await api(lead, lc, "POST", PATH, {
    values: { tagline: "", about: "a", looking_for: "l" },
  });
  assert.equal(bad.status, 400);
  assert.match(bad.body.errors.tagline, /needed/);

  const member = harness({
    players: [
      player({ player_tag: "#8QCV", name: "Amy", clan_role: "member" }),
    ],
    ledger,
  });
  const mc = await signedIn(member);
  assert.equal(
    (await api(member, mc, "POST", PATH, { values: {} })).status,
    403,
  );
  assert.equal(
    (await api(member, mc, "GET", PATH)).body.pitch_version,
    1,
    "members read the clan's pitch",
  );
});

test("recruit: a leader writing the first pitch starts from a draft of the clan's goals; a member gets none", async () => {
  const { policyFromGoals } = await import("@elixir-clan/engine");
  const ledger = seedVersion(
    createMemoryLedger(),
    "policy",
    "#2PQRJ8LV",
    policyFromGoals(["war", "donations"], "standard"),
  );
  const lead = harness({ ledger });
  const lc = await signedIn(lead);
  const view = await api(lead, lc, "GET", PATH);
  assert.equal(view.body.pitch_version, 0);
  assert.equal(view.body.copy, null);
  assert.equal(view.body.suggested.tagline, "Clan Wars and donations");
  assert.deepEqual(view.body.suggested.points, [
    "Clan Wars every week",
    "Generous donations, every week",
  ]);
  const member = harness({
    players: [
      player({ player_tag: "#8QCV", name: "Amy", clan_role: "member" }),
    ],
    ledger,
  });
  const mc = await signedIn(member);
  assert.equal((await api(member, mc, "GET", PATH)).body.suggested, null);
});
