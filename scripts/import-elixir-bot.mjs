#!/usr/bin/env node
/**
 * One-time, read-only import of POAP KINGS' decided cards and holds from
 * elixir-bot, so cooldowns, re-nomination and leave-vs-kick history carry
 * over. Runs only on Jamie's go. Reads ../elixir-bot/elixir-v51.db in
 * ?mode=ro and writes ledger items marked source: "elixir-bot"; never
 * writes to elixir-bot's database.
 *
 *   node scripts/import-elixir-bot.mjs            dry run: prints what would land
 *   AWS_PROFILE=cloud-engineer node scripts/import-elixir-bot.mjs --write
 */

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDynamoLedger } from "../services/api/src/manage/ledger.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(here, "../../elixir-bot/elixir-v51.db");
const CLAN = "#J2RGCRVG";
const TYPE = {
  kick_recommendation: "removal",
  promotion_recommendation: "promotion",
  demotion_recommendation: "demotion",
};
const write = process.argv.includes("--write");

const db = new DatabaseSync(`file:${dbPath}?mode=ro`, {
  open: true,
  readOnly: true,
});
const cards = db
  .prepare(
    `select action_id, action_type, status, target_player_tag, target_player_name, rationale,
            proposed_at, decided_at, expires_at, decision_note, outcome_json
       from leader_action_recommendations
      where coalesce(is_test, 0) = 0 and status in ('done', 'rejected')
        and action_type in ('kick_recommendation', 'promotion_recommendation', 'demotion_recommendation')
      order by action_id`,
  )
  .all();
const holds = db
  .prepare(
    `select member_tag, title, body, expires_at, created_at from memories
      where retired_at is null and member_tag is not null
        and (title like 'Hold:%' or title like 'Away:%' or title like 'LOA:%')`,
  )
  .all();
const iso = (v) =>
  v ? new Date(String(v).endsWith("Z") ? v : `${v}Z`).toISOString() : null;

const items = cards.map((c) => ({
  card_id: `bot-${c.action_id}`,
  clan_tag: CLAN,
  player_tag: c.target_player_tag,
  player_name: c.target_player_name ?? null,
  role_at_raise: null,
  type: TYPE[c.action_type],
  status: c.status === "rejected" ? "declined" : "done",
  raised_at: iso(c.proposed_at),
  decided_at: iso(c.decided_at),
  decided_by: "elixir-bot",
  decline_reason: c.status === "rejected" ? "other" : null,
  decision_note: c.decision_note ?? null,
  expires_at: iso(c.expires_at),
  policy_version: "elixir-bot",
  source: "elixir-bot",
  evidence: { rationale: { headline: c.rationale ?? "" }, facts: [] },
  ...(c.status === "done" && TYPE[c.action_type] === "removal"
    ? {
        outcome: {
          classification: "member_kicked",
          note: "Imported from elixir-bot; the outcome was verified there.",
        },
      }
    : {}),
}));
const holdItems = holds.map((h) => ({
  player_tag: h.member_tag,
  until: h.expires_at
    ? String(h.expires_at).length === 10
      ? `${h.expires_at}T23:59:59Z`
      : iso(h.expires_at)
    : null,
  note: `${h.title}${h.body ? ` · ${h.body}` : ""}`.slice(0, 500),
  by: "elixir-bot",
  set_at: iso(h.created_at),
  source: "elixir-bot",
}));

console.log(
  `${items.length} decided cards (${items.filter((i) => i.status === "done").length} done, ${items.filter((i) => i.status === "declined").length} declined), ${holdItems.length} holds`,
);
if (!write) {
  for (const i of items.slice(-5))
    console.log(" ", i.type, i.status, i.player_tag, i.decided_at);
  for (const h of holdItems) console.log("  hold", h.player_tag, h.until);
  console.log("dry run; pass --write to import");
  process.exit(0);
}
const ledger = createDynamoLedger({
  tableName: process.env.TABLE_NAME ?? "elixir-clan",
  region: process.env.AWS_REGION ?? "us-east-1",
});
for (const i of items) await ledger.putCard(CLAN, i);
for (const h of holdItems) await ledger.putHold(CLAN, h);
console.log("imported");
