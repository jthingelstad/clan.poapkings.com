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
