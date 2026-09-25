#!/usr/bin/env node
/**
 * Actions and their logs, from the host, READ-ONLY: what Elixir Clan
 * suggested, what raised it, who took it and how, what the record
 * confirmed, and what people said along the way. For the agent team to
 * review action by action and improve the rules (Judge Fairly), and for
 * Jamie at a terminal.
 *
 *   node scripts/actions.mjs clans                      clans with actions
 *   node scripts/actions.mjs list --clan <TAG> [--days 30] [--status open|closed|all]
 *   node scripts/actions.mjs show --clan <TAG> <action id>
 *   node scripts/actions.mjs review --clan <TAG> [--days 30]
 *        what to look at: declined with a reason, withdrawn soon after
 *        being raised, flagged outcomes, and every action with a comment
 *
 * Reads the table with the host's AWS profile; writes nothing.
 */

import { createDynamoLedger } from "../services/api/src/manage/ledger.mjs";
import {
  ACTION_TYPES,
  reconstructedLog,
} from "../services/engine/src/index.mjs";
import { normalizeTag } from "../services/api/src/gate.mjs";
import { REGION, STACK } from "../infra/scripts/stack.mjs";
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";

const [command, ...args] = process.argv.slice(2);
const flag = (name, fallback = undefined) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const positional = args.filter(
  (a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")),
);

const cfn = new CloudFormationClient({ region: REGION });
const { Stacks } = await cfn.send(
  new DescribeStacksCommand({ StackName: STACK }),
);
const tableName = Stacks[0].Outputs.find(
  (o) => o.OutputKey === "TableName",
).OutputValue;
const ledger = createDynamoLedger({ tableName, region: REGION });

const DAY_MS = 86400_000;
const since = Date.now() - Number(flag("days", 30)) * DAY_MS;
const closedAt = (c) => c.decided_at ?? c.withdrawn_at ?? null;

async function logFor(clanTag, card) {
  const stored = await ledger.actionLog(clanTag, card.card_id);
  if (stored.some((e) => e.kind === "raised")) return stored;
  const have = new Set(stored.map((e) => e.kind));
  return [
    ...reconstructedLog(card).filter((e) => !have.has(e.kind)),
    ...stored,
  ].sort((a, b) => (a.at < b.at ? -1 : 1));
}

const who = (by) =>
  !by || by.system
    ? "Elixir Clan"
    : `${by.name ?? by.tag}${by.role ? ` (${by.role})` : ""}`;

function printAction(c, log) {
  console.log(
    `\n${c.card_id}  ${ACTION_TYPES[c.type]?.label ?? c.type}  ${c.player_name ?? ""} ${c.player_tag}`,
  );
  console.log(
    `  ${c.status}  raised ${c.raised_at?.slice(0, 16)}${closedAt(c) ? `  closed ${closedAt(c).slice(0, 16)}` : ""}  policy v${c.policy_version ?? "?"}`,
  );
  for (const e of log) {
    console.log(
      `  - ${e.at?.slice(0, 16)}  ${e.kind}  ${who(e.by)}${e.detail?.reconstructed ? "  (reconstructed)" : ""}`,
    );
    if (e.text) console.log(`      ${e.text}`);
    if (e.detail?.reason) console.log(`      reason: ${e.detail.reason}`);
    if (e.detail?.classification)
      console.log(`      classified: ${e.detail.classification}`);
    if (e.detail?.clauses?.length)
      console.log(`      clauses: ${e.detail.clauses.join(", ")}`);
    for (const f of e.detail?.facts ?? []) console.log(`      fact: ${f}`);
    for (const p of e.detail?.prior ?? [])
      console.log(
        `      earlier: ${p.card_id} ${p.status} ${(p.closed_at ?? p.raised_at)?.slice(0, 10)}${p.reason ? ` (${p.reason})` : ""}`,
      );
  }
}

const clanArg = () => {
  const tag = normalizeTag(flag("clan", ""));
  if (!tag) {
    console.error("--clan <TAG> is needed");
    process.exit(2);
  }
  return tag;
};

if (command === "clans") {
  // One scan for the clans that have actions (keys only).
  const dynamo = new DynamoDBClient({ region: REGION });
  const tags = new Map();
  let ExclusiveStartKey;
  do {
    const r = await dynamo.send(
      new ScanCommand({
        TableName: tableName,
        ProjectionExpression: "pk",
        FilterExpression: "begins_with(pk, :c)",
        ExpressionAttributeValues: { ":c": { S: "card#" } },
        ExclusiveStartKey,
      }),
    );
    for (const i of r.Items ?? []) {
      const tag = `#${i.pk.S.split("#")[2]}`;
      tags.set(tag, (tags.get(tag) ?? 0) + 1);
    }
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  for (const [tag, n] of tags) console.log(`${tag}  ${n} actions`);
} else if (command === "list" || command === "review") {
  const clanTag = clanArg();
  const status = flag("status", "all");
  const cards = (await ledger.cards(clanTag))
    .filter((c) => Date.parse(closedAt(c) ?? c.raised_at) >= since)
    .filter((c) =>
      status === "open"
        ? c.status === "proposed"
        : status === "closed"
          ? c.status !== "proposed"
          : true,
    )
    .sort((a, b) => (a.raised_at < b.raised_at ? -1 : 1));
  let shown = 0;
  for (const c of cards) {
    const log = await logFor(clanTag, c);
    if (command === "review") {
      const quickWithdraw =
        c.status === "withdrawn" &&
        Date.parse(c.withdrawn_at) - Date.parse(c.raised_at) < 2 * DAY_MS;
      const worth =
        c.status === "declined" ||
        quickWithdraw ||
        c.outcome?.flagged_at ||
        log.some((e) => e.kind === "comment");
      if (!worth) continue;
    }
    printAction(c, log);
    shown += 1;
  }
  console.log(`\n${shown} action${shown === 1 ? "" : "s"}`);
} else if (command === "show") {
  const clanTag = clanArg();
  const id = positional[0];
  const card = id ? await ledger.card(clanTag, id) : null;
  if (!card) {
    console.error("no such action");
    process.exit(1);
  }
  printAction(card, await logFor(clanTag, card));
} else {
  console.error(
    "usage: actions.mjs clans | list --clan <TAG> [--days N] [--status open|closed|all] | show --clan <TAG> <id> | review --clan <TAG> [--days N]",
  );
  process.exit(2);
}
