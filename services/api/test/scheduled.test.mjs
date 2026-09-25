/**
 * The morning evaluation (door 1): every clan on the ledger's list is
 * evaluated on Clan's own Elixir key; one clan's failure never stops the
 * rest; no key, nothing runs; and a real evaluation reads Elixir with the
 * key and raises actions as a visit would.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryLedger } from "../src/manage/ledger.mjs";
import { createManageService } from "../src/manage/service.mjs";
import { createScheduledRun } from "../src/scheduled.mjs";
import { fakeMcp, rosterBody, ledgerWithPolicy } from "./fakes.mjs";
import {
  member,
  participation,
  NOW,
  EXAMPLE_POLICY,
} from "../../engine/test/fixture.mjs";

const quiet = { info() {}, warn() {} };

test("scheduled: without a key nothing runs, and the log says why", async () => {
  const lines = [];
  const run = createScheduledRun({
    ledger: createMemoryLedger(),
    manage: {},
    integrationKey: "",
    log: { warn: (l) => lines.push(l) },
  });
  assert.deepEqual(await run(), { skipped: "no_integration_key" });
  assert.match(lines[0], /no_integration_key/);
});

test("scheduled: the list is every clan whose policy was saved or evaluated; one failure never stops the rest", async () => {
  const ledger = createMemoryLedger();
  await ledger.savePolicy("#AAA", { values: {}, by: "#L" });
  await ledger.saveVerdicts("#BBB", { members: [] });
  await ledger.saveVerdicts("#CCC", { members: [] });
  assert.deepEqual((await ledger.scheduledClans()).sort(), [
    "#AAA",
    "#BBB",
    "#CCC",
  ]);
  const seen = [];
  const manage = {
    async evaluateOnSchedule(clan, key) {
      seen.push([clan, key]);
      if (clan === "#BBB")
        throw Object.assign(new Error("small"), { code: "too_few_members" });
      if (clan === "#CCC") throw new Error("Elixir fell over");
      return { members: 12 };
    },
  };
  const lines = [];
  const summary = await createScheduledRun({
    ledger,
    manage,
    integrationKey: "svt_test",
    log: { info: (l) => lines.push(l), warn: (l) => lines.push(l) },
  })();
  assert.equal(seen.length, 3);
  assert.ok(seen.every(([, key]) => key === "svt_test"));
  assert.equal(summary.clans, 3);
  assert.equal(summary.evaluated, 1);
  assert.equal(summary.failed, 1, "too few members is a skip, not a failure");
  assert.equal(summary.level, "warn");
  const line = JSON.parse(lines[0]);
  assert.equal(line.scheduled, "evaluate");
  assert.ok(!lines[0].includes("svt_test"), "the key is never logged");
  // A deleted clan leaves the list.
  await ledger.deleteClan("#AAA");
  assert.ok(!(await ledger.scheduledClans()).includes("#AAA"));
});

test("scheduled: a clan's evaluation reads Elixir on the key and raises actions as a visit would", async () => {
  const others = Array.from({ length: 10 }, (_, i) => member(`#O${i}`));
  const idle = member("#8QCV", {
    name: "Sleepy",
    lastBattleDaysAgo: 20,
    war: [0, 0, 0, 0, 0, 0],
  });
  const king = member("#20QQL8CCRU", { name: "Ada", role: "leader" });
  const part = participation([king, ...others, idle], {
    clan_tag: "#2PQRJ8LV",
    name: "Example Clan",
  });
  const mcp = fakeMcp({
    roster: { ...rosterBody([]), member_count: part.members.length },
  });
  const inner = mcp.callTool.bind(mcp);
  mcp.callTool = async (token, name, args) => {
    mcp.calls.push([name, token, args]);
    if (name === "clans_participation") return { ok: true, body: part };
    return inner(token, name, args);
  };
  const ledger = ledgerWithPolicy(
    createMemoryLedger(),
    "#2PQRJ8LV",
    EXAMPLE_POLICY,
  );
  const manage = createManageService({
    ledger,
    mcp,
    now: () => NOW.getTime(),
    log: quiet,
  });
  const summary = await createScheduledRun({
    ledger: {
      scheduledClans: async () => ["#2PQRJ8LV"],
    },
    manage,
    integrationKey: "svt_test",
    log: quiet,
  })();
  assert.equal(summary.evaluated, 1, JSON.stringify(summary));
  assert.ok(
    mcp.calls.some(
      ([n, token]) => n === "clans_participation" && token === "svt_test",
    ),
  );
  const cards = await ledger.cards("#2PQRJ8LV");
  assert.ok(
    cards.some((c) => c.type === "removal" && c.player_tag === "#8QCV"),
  );
  assert.ok(
    (await ledger.scheduledClans()).includes("#2PQRJ8LV"),
    "an evaluated clan is on the list",
  );
});

test("scheduled: after evaluating, the people who can act on something new are emailed through Elixir, once", async () => {
  const others = Array.from({ length: 10 }, (_, i) => member(`#O${i}`));
  const idle = member("#8QCV", {
    name: "Sleepy",
    lastBattleDaysAgo: 20,
    war: [0, 0, 0, 0, 0, 0],
  });
  const king = member("#20QQL8CCRU", { name: "Ada", role: "leader" });
  const part = participation([king, ...others, idle], {
    clan_tag: "#2PQRJ8LV",
    name: "Example Clan",
  });
  const roster = {
    ...rosterBody([
      { player_tag: "#20QQL8CCRU", name: "Ada", role: "leader" },
      { player_tag: "#UQ8LP2R9C", name: "Ben", role: "coLeader" },
      { player_tag: "#8QCV", name: "Sleepy", role: "member" },
      { player_tag: "#E1", name: "Eli", role: "elder" },
    ]),
    member_count: part.members.length,
  };
  const mcp = fakeMcp({ roster });
  mcp.state.mailStatus["#UQ8LP2R9C"] = "no_account";
  const inner = mcp.callTool.bind(mcp);
  mcp.callTool = async (token, name, args) => {
    if (name === "clans_participation") return { ok: true, body: part };
    return inner(token, name, args);
  };
  const ledger = ledgerWithPolicy(
    createMemoryLedger(),
    "#2PQRJ8LV",
    EXAMPLE_POLICY,
  );
  const clock = { t: NOW.getTime() };
  const manage = createManageService({
    ledger,
    mcp,
    now: () => clock.t,
    log: quiet,
    appUrl: "https://clan.test",
  });
  const run = createScheduledRun({
    ledger: { scheduledClans: async () => ["#2PQRJ8LV"] },
    manage,
    integrationKey: "svt_test",
    log: quiet,
  });
  const first = await run();
  assert.equal(first.results[0].mailed, 1, JSON.stringify(first.results));
  const [sent] = mcp.state.mail;
  assert.equal(sent.kind, "clan_actions_waiting");
  // Only people who can act: the leaders, never the elder or the member.
  assert.deepEqual(sent.messages.map((m) => m.player_tag).sort(), [
    "#20QQL8CCRU",
    "#UQ8LP2R9C",
  ]);
  assert.ok(
    sent.messages[0].lines.some((l) =>
      /^#\d+ Remove from the clan: Sleepy \(new\)$/.test(l),
    ),
    JSON.stringify(sent.messages[0].lines),
  );
  assert.equal(
    sent.messages[0].link,
    "https://clan.test/clan/2PQRJ8LV/actions",
  );
  assert.ok(
    mcp.calls.some(([n, key]) => n === "sendMail" && key === "svt_test"),
  );
  const removal = (await ledger.cards("#2PQRJ8LV")).find(
    (c) => c.type === "removal",
  );
  const log = await ledger.actionLog("#2PQRJ8LV", removal.card_id);
  const emailed = log.find((e) => e.kind === "emailed");
  assert.match(emailed.text, /Emailed to 1 person who can act on it/);
  // The next morning, nothing new: nobody is emailed again.
  clock.t += 86_400_000;
  await run();
  assert.equal(mcp.state.mail.length, 1);
});
