import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the durable table keeps the accepted recovery controls", async () => {
  const template = await readFile(
    new URL("../template.yaml", import.meta.url),
    "utf8",
  );
  const table = template.slice(
    template.indexOf("  SessionTable:"),
    template.indexOf(
      "  # ------------------------------------------------------------ the function",
    ),
  );

  assert.match(table, /^    DeletionPolicy: Retain$/m);
  assert.match(table, /^    UpdateReplacePolicy: Retain$/m);
  assert.match(table, /^      DeletionProtectionEnabled: true$/m);
  assert.match(
    table,
    /^      PointInTimeRecoverySpecification:\n        PointInTimeRecoveryEnabled: true\n        RecoveryPeriodInDays: 35$/m,
  );
  assert.doesNotMatch(table, /PointInTimeRecoveryEnabled: false/);
});
