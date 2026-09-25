import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_MAX,
  WELCOME_MAX,
  chatSafe,
  chatWarnings,
  clipChat,
} from "../src/chat.mjs";
import { inGameCopy, inviteCopy, leaderMessage } from "../src/render.mjs";

test("chatSafe rewrites what the game's filter blanks", () => {
  assert.equal(chatSafe("war & ranked play"), "war and ranked play");
  assert.equal(chatSafe("war&ranked"), "war and ranked");
  assert.equal(chatSafe("gained +821 this week"), "gained 821 this week");
  // A hyphen joining word-parts reads as a handle; a name keeps its letters.
  assert.equal(chatSafe("Ab-Cdef"), "Ab Cdef");
  assert.equal(chatSafe("ranked-play"), "ranked play");
  // A space-flanked dash is not a token and passes.
  assert.equal(chatSafe("week - done"), "week - done");
  // "phone" takes the word before it along; the flanking word survives.
  assert.equal(
    chatSafe("in seasons 133 and 134. Phone trouble is pulling them"),
    "in seasons 133 and 134. Device trouble is pulling them",
  );
  assert.equal(chatSafe("new phones"), "new devices");
  assert.equal(chatSafe("PHONE"), "DEVICE");
  assert.equal(chatSafe("  two\nlines  "), "two lines");
  assert.equal(chatSafe(null), "");
});

test("clipChat ends on a whole sentence, else at a word with three dots", () => {
  const text =
    "The clan clinched the war week early. Every deck got played and the boat is basically home already tonight.";
  assert.equal(clipChat(text, 45), "The clan clinched the war week early.");
  const runOn =
    "keeps climbing and climbing and climbing all the way up the ladder";
  const clipped = clipChat(runOn, 30);
  assert.ok(clipped.endsWith("..."), clipped);
  assert.ok(clipped.length <= 30, clipped);
  assert.doesNotMatch(clipped, /\s\.\.\.$/);
  assert.equal(clipChat("short", 30), "short");
  assert.equal(CHAT_MAX, 200);
  assert.equal(WELCOME_MAX, 120);
});

test("chatWarnings names what a person's edit would lose, and passes plain words", () => {
  assert.deepEqual(
    chatWarnings("Welcome to the clan, glad you are here! Say hi."),
    [],
  );
  const flagged = (t) => chatWarnings(t).join(" | ");
  assert.match(flagged("war & ranked"), /"&"/);
  assert.match(flagged("up +821"), /"\+" before a number/);
  assert.match(flagged("thanks Ab-Cdef"), /hyphen inside a word/);
  assert.match(flagged("phone trouble"), /"phone"/);
  assert.match(flagged("see https://example.com"), /a link/);
  assert.match(flagged("join www.example.com"), /a link/);
  assert.match(flagged("**big** week"), /Discord formatting/);
  assert.match(flagged("hi <@1234>"), /mention/);
  assert.match(flagged("gg :trophy:"), /emoji shortcode/);
  assert.match(flagged("edging ahead"), /slang/);
  assert.match(flagged("ranked 5 of 39 this week"), /score, rank or band/);
  assert.match(flagged("score 0.82"), /score, rank or band/);
  assert.match(flagged("x".repeat(201)), /longer than the game's 200/);
  assert.deepEqual(chatWarnings("x".repeat(180), 180), []);
  // A dash between spaces and a time are fine.
  assert.deepEqual(chatWarnings("week - done at 10:00"), []);
});

test("every line the engine writes for the game passes its own warnings", () => {
  const name = "Ab-Cd & Ef +5 phone";
  const lines = [
    ...["promotion", "demotion", "removal", "welcome", "farewell"].map((k) =>
      inGameCopy(k, { name, days_idle: 9, phrase: "war +12" }),
    ),
    inviteCopy("leaders", { clanName: "Kings-Hall & Co" }),
    inviteCopy("clanmates", { clanName: "Kings-Hall & Co" }),
  ];
  for (const l of lines) assert.deepEqual(chatWarnings(l), [], l);
  assert.ok(inGameCopy("welcome", { name: "N".repeat(200) }).length <= 120);
  for (const kind of ["promotion", "demotion"]) {
    const m = leaderMessage(kind, { name });
    assert.deepEqual(chatWarnings(m.title, 24), [], m.title);
    assert.deepEqual(chatWarnings(m.body, 180), [], m.body);
  }
});
