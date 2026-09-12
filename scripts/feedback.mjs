#!/usr/bin/env node
/**
 * The feedback queue, from the host: what people told the maintainer and
 * what was done about it. For the agent team's Close-the-Loop owner and
 * for Jamie at a terminal; the same rows the maintainer lane shows.
 *
 *   node scripts/feedback.mjs list [--all]        new and planned (or everything)
 *   node scripts/feedback.mjs show <id>
 *   node scripts/feedback.mjs answer <id> --status <seen|planned|done|declined>
 *                            [--reply "..."] [--shipped "..."]
 *
 * Reads and writes the table directly with the host's AWS profile (no web
 * session): the ledger's own contract, nothing invented here. `answer` is a
 * write to live data; say what you did in the run's notes.
 */

import { createDynamoLedger } from "../services/api/src/manage/ledger.mjs";
import { createFeedbackService } from "../services/api/src/feedback.mjs";
import { REGION, STACK } from "../infra/scripts/stack.mjs";
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";

const [command, id, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? undefined : rest[i + 1];
};

const cfn = new CloudFormationClient({ region: REGION });
const { Stacks } = await cfn.send(
  new DescribeStacksCommand({ StackName: STACK }),
);
const tableName = Stacks[0].Outputs.find(
  (o) => o.OutputKey === "TableName",
).OutputValue;
const ledger = createDynamoLedger({ tableName, region: REGION });
const service = createFeedbackService({ ledger });
const maintainer = { player_tag: "host", name: "the host", maintainer: true };

const line = (f) =>
  `${f.feedback_id}  ${f.created_at.slice(0, 16)}  ${f.status.padEnd(8)}  ${f.category.padEnd(12)}  ${f.person_name ?? f.person_tag}${f.context?.clan_tag ? ` @ ${f.context.clan_tag}` : ""}  ${f.message.split("\n")[0].slice(0, 70)}${f.response ? "  [answered]" : ""}`;

if (command === "list") {
  const all = await service.queue(maintainer);
  const rows = rest.includes("--all")
    ? all
    : all.filter((f) => f.status === "new" || f.status === "planned");
  if (!rows.length) console.log("nothing waiting");
  for (const f of rows) console.log(line(f));
} else if (command === "show" && id) {
  const f = (await service.queue(maintainer)).find((x) => x.feedback_id === id);
  if (!f) {
    console.error("no such item");
    process.exit(1);
  }
  console.log(JSON.stringify(f, null, 2));
} else if (command === "answer" && id) {
  const status = flag("status");
  if (!status) {
    console.error("--status is required");
    process.exit(2);
  }
  const updated = await service.decide(maintainer, id, {
    status,
    response: flag("reply"),
    shipped_in: flag("shipped"),
  });
  console.log(line(updated));
} else {
  console.error(
    "usage: feedback.mjs list [--all] | show <id> | answer <id> --status s [--reply r] [--shipped v]",
  );
  process.exit(2);
}
