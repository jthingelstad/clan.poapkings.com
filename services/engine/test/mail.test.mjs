import { test } from "node:test";
import assert from "node:assert/strict";
import { actionsWaitingMail, MAIL_MAX_LINES } from "../src/mail.mjs";

const people = [
  { player_tag: "#L", name: "Lead", role: "leader" },
  { player_tag: "#C", name: "Co", role: "coLeader" },
  { player_tag: "#E", name: "Eld", role: "elder" },
  { player_tag: "#M", name: "Mem", role: "member" },
  { player_tag: "#Q", name: "Quiet", role: "member" },
];
const card = (id, type, extra = {}) => ({
  card_id: id,
  type,
  status: "proposed",
  raised_at: "2026-09-26T11:00:00.000Z",
  player_tag: "#Q",
  player_name: "Quiet",
  ...extra,
});
const base = {
  clanTag: "#2PQRJ8LV",
  clanName: "Example Clan",
  appUrl: "https://clan.test/",
};

test("only people who can act on an action are sent it", () => {
  const mail = actionsWaitingMail({
    ...base,
    people,
    cards: [
      card("r1", "removal"),
      card("w1", "welcome", { player_tag: "#N", player_name: "Newbie" }),
      card("a1", "away", {
        player_tag: "#Q",
        audience: { kind: "member", player_tag: "#Q" },
      }),
      card("x1", "promotion", { status: "done" }),
    ],
  });
  const to = Object.fromEntries(mail.map((m) => [m.player_tag, m]));
  assert.deepEqual(Object.keys(to).sort(), ["#C", "#E", "#L", "#Q"]);
  assert.deepEqual(to["#L"].card_ids.sort(), ["r1", "w1"]);
  assert.deepEqual(to["#E"].card_ids, ["w1"], "an elder never sees a removal");
  assert.deepEqual(to["#Q"].card_ids, ["a1"], "a member only their own");
  assert.equal(to["#M"], undefined);
  assert.equal(to["#L"].subject, "2 actions waiting for you in Example Clan");
  assert.equal(to["#E"].subject, "Welcome a newcomer: Newbie (Example Clan)");
  assert.equal(to["#Q"].lines[0], "Going to be away? (new)");
  assert.equal(to["#L"].link, "https://clan.test/clan/2PQRJ8LV/actions");
});

test("a person is emailed only when something became theirs since their last email; the email lists all of it", () => {
  const cards = [
    card("old", "removal", { raised_at: "2026-09-20T11:00:00.000Z" }),
    card("new", "welcome", { player_tag: "#N", player_name: "Newbie" }),
  ];
  const mail = actionsWaitingMail({
    ...base,
    people,
    cards,
    lastMailed: {
      "#L": "2026-09-21T11:05:00.000Z",
      "#C": "2026-09-26T11:05:00.000Z",
    },
  });
  const to = Object.fromEntries(mail.map((m) => [m.player_tag, m]));
  assert.deepEqual(to["#L"].new_card_ids, ["new"]);
  assert.deepEqual(to["#L"].lines, [
    "Welcome a newcomer: Newbie (new)",
    "Remove from the clan: Quiet",
  ]);
  assert.equal(to["#C"], undefined, "nothing new since their last email");
  // Nothing new for anyone, nothing sent.
  assert.deepEqual(
    actionsWaitingMail({
      ...base,
      people,
      cards: [cards[0]],
      lastMailed: {
        "#L": "2026-09-21T00:00:00Z",
        "#C": "2026-09-21T00:00:00Z",
      },
    }),
    [],
  );
});

test("a long list is capped and counted", () => {
  const many = Array.from({ length: MAIL_MAX_LINES + 3 }, (_, i) =>
    card(`r${i}`, "removal", { player_name: `P${i}` }),
  );
  const [m] = actionsWaitingMail({
    ...base,
    people: [people[0]],
    cards: many,
  });
  assert.equal(m.lines.length, MAIL_MAX_LINES + 1);
  assert.equal(m.lines.at(-1), "And 3 more.");
});
