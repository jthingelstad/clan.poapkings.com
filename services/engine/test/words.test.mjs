import { test } from "node:test";
import assert from "node:assert/strict";
import {
  leaderMessageFromDraft,
  leaderMessageRequest,
  MODEL_PREFERENCE,
  NOTE_MAX,
  PURPOSES,
  chooseModel,
  pitchFromDraft,
  pitchRequest,
} from "../src/words.mjs";
import { PITCH_FIELDS } from "../src/recruit.mjs";
import { describePolicy } from "../src/render.mjs";
import { policyFromGoals } from "../src/goals.mjs";

const FACTS = {
  name: "Example Clan",
  type: "open",
  members: 41,
  open_slots: 9,
  required_trophies: 6000,
  clan_score: 70000,
  war_trophies: 2500,
  donations_per_week: 9100,
  location: "International",
  description: "Friendly",
  top_trophies: [{ name: "Topplayer", value: 9000 }],
  top_donors: [{ name: "Givername", value: 800 }],
};

test("a model writes words for a closed list of uses, none a judgment about a member", () => {
  assert.deepEqual(Object.keys(PURPOSES), ["recruit_pitch", "leader_message"]);
  assert.doesNotMatch(
    JSON.stringify(PURPOSES),
    /judge|score|rank|remove|kick|recommend/i,
  );
});

test("the default model is the first preferred one the key reaches", () => {
  assert.equal(
    chooseModel(["claude-haiku-4-5-20251001", "claude-sonnet-5"]),
    "claude-sonnet-5",
  );
  assert.equal(chooseModel(["claude-haiku-4-5-20251001"]), MODEL_PREFERENCE[2]);
  assert.equal(chooseModel(["claude-new-thing"]), "claude-new-thing");
  assert.equal(chooseModel(["gpt-x"]), null);
  assert.equal(chooseModel([]), null);
});

test("a pitch request carries the clan's facts, goals, rules, words and note, and never a member", () => {
  const policy = policyFromGoals(["war"], "strict");
  const r = pitchRequest({
    clanName: "Example Clan",
    facts: FACTS,
    goals: ["war"],
    posture: "strict",
    howItWorks: describePolicy(policy),
    pitch: {
      tagline: "Old tagline",
      about: "Old about.",
      points: ["Old point"],
      looking_for: "Old look.",
    },
    note: `in Spanish ${"x".repeat(400)}`,
  });
  assert.equal(r.purpose, "recruit_pitch");
  assert.equal(r.tool.name, "write_pitch");
  assert.ok(r.max_tokens > 0 && r.max_tokens <= 2000);
  assert.match(r.system, /Never invent a number/);
  assert.match(r.system, /Never name a member/);
  assert.match(r.prompt, /Joining: open/);
  assert.match(r.prompt, /Required trophies to join: 6,000/);
  assert.match(r.prompt, /Clan Wars: We fight the River Race together/);
  assert.match(r.prompt, /How hard it asks: Every week counts/);
  assert.match(r.prompt, /How it runs \(its saved policy\)/);
  assert.match(r.prompt, /Tagline: Old tagline/);
  assert.match(r.prompt, /The leader's note: in Spanish/);
  assert.doesNotMatch(r.prompt, /Topplayer|Givername/);
  const note = r.prompt.split("The leader's note: ")[1];
  assert.ok(note.length <= NOTE_MAX);
  // A first pitch for a clan with nothing saved still asks well.
  const bare = pitchRequest({ facts: null });
  assert.match(bare.prompt, /a Clash Royale clan/);
});

test("a draft is tidied, clipped to each field, keeps the clan's own website and contact, and flags numbers it was not given", () => {
  const long = "Word ".repeat(200);
  const d = pitchFromDraft(
    {
      tagline: `\`${long}\``,
      about:
        "**We war.** Join at www.example.com today. We have 6,000 trophies.",
      points: Array.from({ length: 9 }, (_, i) => `• Point ${i + 1}`),
      looking_for: "Someone kind, top 100 in the world.",
      website_url: "https://model.invented",
    },
    { website_url: "https://clan.example", contact: "DM a leader" },
    { prompt: "Required trophies to join: 6,000." },
  );
  assert.ok(d.values.tagline.length <= PITCH_FIELDS.tagline.max);
  assert.doesNotMatch(d.values.tagline, /`/);
  assert.equal(
    d.values.about,
    "We war. Join at today. We have 6,000 trophies.",
  );
  assert.equal(d.values.points.length, 6);
  assert.equal(d.values.points[0], "Point 1");
  assert.equal(d.values.website_url, "https://clan.example");
  assert.equal(d.values.contact, "DM a leader");
  assert.deepEqual(d.errors, {});
  assert.equal(d.checks.length, 1);
  assert.match(d.checks[0], /100/);
  assert.doesNotMatch(d.checks[0], /6,000/);
  // A missing answer is an empty draft with the fields it lacks named.
  const empty = pitchFromDraft(null, null);
  assert.ok(empty.errors.tagline && empty.errors.about);
});

test("a Leader Message request never carries a member's name; the model writes placeholders", () => {
  const r = leaderMessageRequest({
    kind: "promotion",
    clanName: "Example Clan",
    voice: { tagline: "Steady wars", about: "We war." },
    goals: ["war"],
    current: { title: "Congrats, new Elder!", body: "{name} is now an Elder." },
  });
  assert.equal(r.purpose, "leader_message");
  assert.match(r.system, /Never write a member's name/);
  assert.match(r.system, /never '&'/);
  assert.match(r.prompt, /Write \{name\}/);
  assert.match(r.prompt, /Tagline: Steady wars/);
  const awards = leaderMessageRequest({
    kind: "awards",
    seasonId: 131,
    awardCount: 2,
  });
  assert.match(awards.prompt, /Season 131 closed/);
  assert.match(awards.prompt, /\{winners\}/);
  assert.throws(() => leaderMessageRequest({ kind: "removal" }));
});

test("a drafted Leader Message gets its names back, the game's filter rules and its limits", () => {
  const promo = leaderMessageFromDraft(
    {
      title: "New Elder & friends",
      body: "Cheers to {name} for every war day +4!",
    },
    { kind: "promotion", name: "Ab-Cd" },
  );
  assert.equal(promo.title, "New Elder and friends");
  assert.equal(promo.body, "Cheers to Ab Cd for every war day 4!");
  assert.deepEqual(promo.warnings, []);
  // A model that forgot the placeholder still names the member.
  const forgot = leaderMessageFromDraft(
    { title: "Elder update", body: "Back to Member for now." },
    { kind: "demotion", name: "Sleepy" },
  );
  assert.match(forgot.body, /^Sleepy: /);
  const awards = leaderMessageFromDraft(
    {
      title: "Season 131 awards are in and they are great",
      body: "Well played! {winners}",
    },
    {
      kind: "awards",
      awards: [
        { name: "Iron Deck", winners: ["Ada", "Ben"] },
        { name: "Top Donor", winners: ["Cy"] },
      ],
    },
  );
  assert.ok(awards.title.length <= 24, awards.title);
  assert.equal(awards.body, "Well played! Iron Deck: Ada, Ben; Top Donor: Cy.");
  const ranked = leaderMessageFromDraft(
    { title: "Rules", body: "You rank 5 of 39 now." },
    { kind: "rules" },
  );
  assert.ok(ranked.warnings.some((w) => /score, rank or band/.test(w)));
});
