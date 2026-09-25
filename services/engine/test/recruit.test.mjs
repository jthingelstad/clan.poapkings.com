/**
 * Recruiting copy from a pitch and live facts: a personal note and a
 * public post that carries the recruiting forums' requirements itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultPitch,
  factsFromClan,
  factsFromRoster,
  recruitCopy,
  validateCopy,
  validatePitch,
} from "../src/recruit.mjs";

const clan = {
  tag: "#2PQRJ8L",
  name: "Example Clan",
  type: "inviteOnly",
  description: "in-game description",
  members: 47,
  requiredTrophies: 5000,
  clanScore: 61234,
  clanWarTrophies: 3210,
  donationsPerWeek: 8400,
  location: { name: "United States" },
  memberList: [
    { name: "Ada", trophies: 9000, donations: 300, role: "leader" },
    { name: "Ben", trophies: 8800, donations: 500, role: "coLeader" },
    { name: "Cy", trophies: 7000, donations: 0, role: "member" },
  ],
};

/** A clan's own words, as a leader would write them. */
const PITCH = validatePitch({
  tagline: "Steady wars, friendly chat",
  about: "A clan that plays together every week.",
  points: ["Wars every week", "Help with decks"],
  looking_for: "Active players who enjoy wars.",
  website_url: "https://example.org",
  contact: "Request to join in game, or come say hi at https://discord.gg/abc",
}).values;

test("facts come from the game's numbers only; the roster gives fewer", () => {
  const f = factsFromClan(clan);
  assert.equal(f.open_slots, 3);
  assert.equal(f.required_trophies, 5000);
  assert.deepEqual(
    f.top_donors.map((d) => d.name),
    ["Ben", "Ada"],
  );
  assert.equal(f.source, "live");
  const r = factsFromRoster({
    clan_tag: "#2PQRJ8L",
    name: "Example Clan",
    member_count: 47,
    members: [{ name: "A", trophies: 1, donations_this_week: 5 }],
  });
  assert.equal(r.required_trophies, null);
  assert.equal(r.source, "recorded");
  assert.equal(r.top_donors[0].value, 5);
  // A roster without the recorded scores leaves them null, never zero.
  assert.equal(r.clan_score, null);
  assert.equal(r.war_trophies, null);
  assert.equal(r.type, null);
  assert.equal(r.description, null);
});

test("a pending live read uses what the record already has: type, description, clan score, war trophies", () => {
  const r = factsFromRoster({
    clan_tag: "#2PQRJ8L",
    name: "Example Clan",
    type: "inviteOnly",
    description: "in-game description",
    clan_score: 61234,
    clan_war_trophies: 3210,
    scores_observed_at: "2026-09-25T09:00:00.000Z",
    member_count: 47,
    members: [],
  });
  assert.equal(r.source, "recorded");
  assert.equal(r.type, "inviteOnly");
  assert.equal(r.clan_score, 61234);
  assert.equal(r.war_trophies, 3210);
  // The record has no join floor, donations a week or location name.
  assert.equal(r.required_trophies, null);
  assert.equal(r.donations_per_week, null);
  assert.equal(r.location, null);
  const copy = recruitCopy(PITCH, r);
  assert.deepEqual(validateCopy(copy, null), []);
  assert.match(copy.post.body, /3,210 war trophies, clan score 61,234/);
  assert.doesNotMatch(copy.post.body, /Required Trophies/);
  assert.doesNotMatch(copy.post.title, /\[/);
});

test("two formats: a plain personal note, and a post carrying the forums' requirements itself", () => {
  const copy = recruitCopy(PITCH, factsFromClan(clan));
  assert.deepEqual(Object.keys(copy), ["personal", "post"]);
  assert.deepEqual(validateCopy(copy, 5000), []);
  // The personal note: email or message, plain text.
  assert.equal(
    copy.personal.subject,
    "Join Example Clan: Steady wars, friendly chat",
  );
  assert.doesNotMatch(copy.personal.body, /\*\*|^- /m);
  assert.match(copy.personal.body, /5,000 trophies to join/);
  assert.match(copy.personal.body, /3 open slots right now/);
  assert.match(copy.personal.body, /https:\/\/discord\.gg\/abc/);
  assert.match(copy.personal.body, /More at https:\/\/example\.org/);
  // The post: the bracket in the title and the body, no invite link.
  assert.equal(
    copy.post.title,
    "Example Clan #2PQRJ8L - Steady wars, friendly chat [5000]",
  );
  assert.match(copy.post.body, /^Required Trophies: \[5000\]$/m);
  assert.doesNotMatch(copy.post.body, /discord\.gg/);
  assert.match(copy.post.body, /\(ask for the invite\)/);
  assert.match(copy.post.body, /3,210 war trophies, clan score 61,234/);
});

test("a full clan says so", () => {
  const copy = recruitCopy(
    PITCH,
    factsFromRoster({
      clan_tag: "#2PQRJ8L",
      name: "Example Clan",
      member_count: 50,
      members: [],
    }),
  );
  assert.deepEqual(validateCopy(copy, null), []);
  assert.match(copy.post.body, /Full at the moment/);
});

test("a pitch is validated in a leader's words", () => {
  const bad = validatePitch({
    tagline: "x".repeat(81),
    about: "",
    points: Array.from({ length: 7 }, (_, i) => `p${i}`),
    looking_for: "has a `backtick`",
    website_url: "example.org",
  });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.tagline, /at most 80/);
  assert.match(bad.errors.about, /needed/);
  assert.match(bad.errors.points, /At most 6/);
  assert.match(bad.errors.looking_for, /backticks/);
  assert.match(bad.errors.website_url, /https/);
  const ok = validatePitch({
    tagline: "t",
    about: "a",
    points: "one\n\ntwo\n",
    looking_for: "l",
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.values.points, ["one", "two"]);
  assert.equal(ok.values.website_url, null);
});

test("an edited copy is checked as it stands", () => {
  const problems = validateCopy(
    {
      personal: { subject: "s", body: "**bold**" },
      post: {
        title: "Example Clan",
        body: "join https://discord.gg/abc",
      },
    },
    5000,
  );
  assert.deepEqual(problems, [
    "the post title carries [5000]",
    "the post says Required Trophies: [5000]",
    "the post body carries no invite link",
    "the personal note is plain text",
  ]);
});

test("every clan starts with an empty pitch: nothing is said for it until its leaders say it", () => {
  const pitch = defaultPitch();
  assert.equal(pitch.tagline, "");
  assert.equal(pitch.about, "");
  assert.deepEqual(pitch.points, []);
  assert.equal(pitch.website_url, "");
  assert.equal(defaultPitch.length, 0, "the start never depends on the clan");
  assert.equal(validatePitch(pitch).ok, false, "an empty pitch is not saved");
});
