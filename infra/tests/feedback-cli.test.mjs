import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// Exercise the real host command with an offline queue. No credentials or
// network are needed, and any operation other than stack discovery and the
// queue query fails instead of reaching AWS.
function list(...args) {
  const mockAws = `
    import { CloudFormationClient } from "@aws-sdk/client-cloudformation";
    import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
    const statuses = ["done", "declined", "seen", "planned", "new"];
    CloudFormationClient.prototype.send = async (command) => {
      if (command.constructor.name !== "DescribeStacksCommand") throw new Error("unexpected stack operation");
      return {Stacks: [{Outputs: [{OutputKey: "TableName", OutputValue: "fixture-only"}]}]};
    };
    DynamoDBDocumentClient.prototype.send = async (command) => {
      if (command.constructor.name !== "QueryCommand") throw new Error("unexpected table operation");
      return {Items: statuses.map((status, i) => ({
        pk: "feedback#fixture_" + status,
        feedback_id: "fixture_" + status,
        created_at: "2026-09-12T0" + i + ":00:00Z",
        status, category: "bug", person_tag: "fixture",
        message: "Offline " + status + " note",
        ...(status === "done" ? {response: "Shipped offline", shipped_in: "fixture-commit"} : {}),
      }))};
    };
    process.argv = [process.execPath, "scripts/feedback.mjs", "list", ...${JSON.stringify(args)}];
    await import("./scripts/feedback.mjs");
  `;
  return execFileSync(
    process.execPath,
    ["--input-type=module", "--eval", mockAws],
    {
      cwd: new URL("../../", import.meta.url),
      env: { ...process.env, AWS_EC2_METADATA_DISABLED: "true" },
      encoding: "utf8",
      timeout: 10000,
    },
  );
}

test("the host feedback list defaults to new and planned items", () => {
  const output = list();
  assert.match(output, /fixture_planned/);
  assert.match(output, /fixture_new/);
  for (const status of ["seen", "done", "declined"])
    assert.doesNotMatch(output, new RegExp(`fixture_${status}`));
});

test("the host feedback list --all includes delivered replies and every status", () => {
  const output = list("--all");
  for (const status of ["new", "planned", "seen", "done", "declined"])
    assert.match(output, new RegExp(`fixture_${status}`));
  assert.match(output, /fixture_done.*\[answered\]/);
});
