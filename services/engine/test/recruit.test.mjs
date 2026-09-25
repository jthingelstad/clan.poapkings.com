/**
 * Recruiting copy from a pitch and live facts, under elixir-bot's rules
 * (runtime/jobs/_promotion.py's validator, prompts/lanes/recruiting.md).
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
  tag: "#J2RGCRVG",
  name: "POAP KINGS",
  type: "inviteOnly",
  description: "in-game description",
  members: 47,
  requiredTrophies: 5000,
  clanScore: 61234,
  clanWarTrophies: 3210,
  donationsPerWeek: 8400,
  location: { name: "United States" },
  memberList: [
    { name: "King Thing", trophies: 9000, donations: 300, role: "leader" },
    { name: "King Levy", trophies: 8800, donations: 500, role: "coLeader" },
    { name: "Amy", trophies: 7000, donations: 0, role: "member" },
  ],
};

test("facts come from the game's numbers only; the roster gives fewer", () => {
  const f = factsFromClan(clan);
  assert.equal(f.open_slots, 3);
  assert.equal(f.required_trophies, 5000);
  assert.deepEqual(
    f.top_donors.map((d) => d.name),
    ["King Levy", "King Thing"],
  );
  assert.equal(f.source, "live");
  const r = factsFromRoster({
    clan_tag: "#J2RGCRVG",
    name: "POAP KINGS",
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
    clan_tag: "#J2RGCRVG",
    name: "POAP KINGS",
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
  assert.equal(r.description, "in-game description");
  assert.equal(r.clan_score, 61234);
  assert.equal(r.war_trophies, 3210);
  // The record has no join floor, donations a week or location name.
  assert.equal(r.required_trophies, null);
  assert.equal(r.donations_per_week, null);
  assert.equal(r.location, null);
  const pitch = validatePitch(defaultPitch("#J2RGCRVG")).values;
  const copy = recruitCopy(pitch, r);
  assert.deepEqual(validateCopy(copy, null), []);
  assert.match(copy.discord, /3,210 war trophies, clan score 61,234/);
  assert.doesNotMatch(copy.discord, /Required Trophies/);
});

test("the default pitch and every channel pass the bot's validator", () => {
  const pitch = validatePitch(defaultPitch("#J2RGCRVG"));
  assert.equal(pitch.ok, true, JSON.stringify(pitch.errors));
  const copy = recruitCopy(pitch.values, factsFromClan(clan));
  assert.deepEqual(validateCopy(copy, 5000), []);
  assert.match(
    copy.discord.split("\n")[0],
    /^\*\*POAP KINGS \(#J2RGCRVG\): .*Required Trophies: \[5000\]\*\*$/,
  );
  assert.match(copy.reddit.title, /POAP KINGS #J2RGCRVG - .* \[5000\]$/);
  assert.doesNotMatch(
    copy.reddit.body,
    /discord\.gg|link\.clashroyale/,
    "no invite link in the reddit body",
  );
  assert.match(copy.discord, /https:\/\/poapkings\.com/);
  assert.match(copy.message, /5,000 trophies to join/);
  assert.match(copy.email.subject, /^Join POAP KINGS: /);
  assert.match(copy.discord, /3 open slots right now/);
  assert.match(copy.discord, /3,210 war trophies, clan score 61,234/);
});

test("copy without a live floor carries no bracket and still passes", () => {
  const pitch = validatePitch(defaultPitch("#J2RGCRVG")).values;
  const copy = recruitCopy(
    pitch,
    factsFromRoster({
      clan_tag: "#J2RGCRVG",
      name: "POAP KINGS",
      member_count: 50,
      members: [],
    }),
  );
  assert.deepEqual(validateCopy(copy, null), []);
  assert.doesNotMatch(copy.discord, /Required Trophies/);
  assert.match(copy.discord, /Full at the moment/);
});

test("a pitch is validated in a leader's words", () => {
  const bad = validatePitch({
    tagline: "x".repeat(81),
    about: "",
    points: Array.from({ length: 7 }, (_, i) => `p${i}`),
    looking_for: "has a `backtick`",
    website_url: "poapkings.com",
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

test("the validator catches what the bot's caught", () => {
  const problems = validateCopy(
    {
      message: "**bold** " + "w ".repeat(50),
      social: "fine",
      email: { subject: "s", body: "b" },
      discord: "**POAP KINGS**\nbody",
      reddit: { title: "POAP KINGS", body: "join https://discord.gg/abc" },
    },
    5000,
  );
  assert.ok(
    problems.includes(
      "discord first line must end with Required Trophies: [5000]",
    ),
  );
  assert.ok(problems.includes("reddit title must include [5000]"));
  assert.ok(problems.includes("reddit body must not carry an invite link"));
  assert.ok(problems.includes("message must be plain text"));
  assert.ok(problems.includes("message over 40 words"));
});

test("another clan's starting pitch names nobody and links nowhere", () => {
  const pitch = defaultPitch("#9Q9QRCPP");
  assert.doesNotMatch(JSON.stringify(pitch), /POAP|poapkings|Free Pass/i);
  assert.equal(pitch.website_url, "");
  assert.equal(validatePitch(pitch).ok, true);
});
