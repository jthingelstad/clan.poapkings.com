import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  boundaryArnFor,
  executionPolicyFor,
  runtimeBoundaryFor,
  runtimeRoleArnFor,
} from "../scripts/iam-policies.mjs";
import { ensureRuntimeBoundary } from "../scripts/runtime-boundary.mjs";

const account = "123456789012";
const runtime = runtimeRoleArnFor(account);
const boundary = boundaryArnFor(account);
const statements = executionPolicyFor(account).Statement;
const iamStatements = statements.filter((statement) =>
  [].concat(statement.Action).some((action) => action.startsWith("iam:")),
);
const granting = (action) =>
  iamStatements.filter((statement) =>
    [].concat(statement.Action).includes(action),
  );
const cleanAnalyzer = { send: async () => ({ findings: [] }) };
const absent = () =>
  Object.assign(new Error("Absent"), { name: "NoSuchEntityException" });

test("delegated IAM writes cannot edit execution, deployment, or unrelated roles", () => {
  for (const action of [
    "iam:PutRolePolicy",
    "iam:UpdateAssumeRolePolicy",
    "iam:DeleteRole",
    "iam:DeleteRolePolicy",
  ]) {
    assert.deepEqual(
      granting(action).map((statement) => statement.Resource),
      [runtime],
    );
  }
  for (const statement of iamStatements) {
    assert.ok(
      ![].concat(statement.Resource).some((resource) => resource.includes("*")),
    );
    assert.ok(
      ![].concat(statement.Action).some((action) => action.includes("*")),
    );
  }
  for (const action of [
    "iam:DeleteRolePermissionsBoundary",
    "iam:CreatePolicyVersion",
    "iam:SetDefaultPolicyVersion",
    "iam:DeletePolicy",
    "iam:AttachRolePolicy",
    "iam:PutUserPolicy",
  ]) {
    assert.deepEqual(granting(action), []);
  }
});

test("runtime creation and boundary attachment require the administrator-owned boundary", () => {
  for (const action of ["iam:CreateRole", "iam:PutRolePermissionsBoundary"]) {
    assert.equal(granting(action).length, 1);
    assert.equal(granting(action)[0].Resource, runtime);
    assert.deepEqual(granting(action)[0].Condition, {
      StringEquals: { "iam:PermissionsBoundary": boundary },
    });
  }
});

test("execution PassRole permits only the existing application role to Lambda", () => {
  assert.equal(granting("iam:PassRole").length, 1);
  assert.equal(granting("iam:PassRole")[0].Resource, runtime);
  assert.deepEqual(granting("iam:PassRole")[0].Condition, {
    StringEquals: { "iam:PassedToService": "lambda.amazonaws.com" },
  });
});

test("runtime boundary caps grants to the current table, index, log, and feedback topic", () => {
  const cap = runtimeBoundaryFor(account);
  assert.deepEqual(
    cap.Statement.flatMap((statement) => [].concat(statement.Resource)),
    [
      `arn:aws:logs:us-east-1:${account}:log-group:/aws/lambda/elixir-clan-api:*`,
      `arn:aws:dynamodb:us-east-1:${account}:table/elixir-clan`,
      `arn:aws:dynamodb:us-east-1:${account}:table/elixir-clan/index/ByClan`,
      `arn:aws:sns:us-east-1:${account}:elixir-clan-feedback`,
    ],
  );
  assert.deepEqual(
    cap.Statement.flatMap((statement) => [].concat(statement.Action)).sort(),
    [
      "dynamodb:BatchWriteItem",
      "dynamodb:DeleteItem",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:Query",
      "dynamodb:UpdateItem",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "sns:Publish",
    ].sort(),
  );
});

test("template and bootstrap retain the boundary on ordinary deployments", async () => {
  const template = await readFile(
    new URL("../template.yaml", import.meta.url),
    "utf8",
  );
  const bootstrap = await readFile(
    new URL("../scripts/bootstrap.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    template,
    /PermissionsBoundary: !Sub arn:\$\{AWS::Partition\}:iam::\$\{AWS::AccountId\}:policy\/elixir-clan-runtime-boundary/,
  );
  assert.ok(
    bootstrap.indexOf("await ensureRuntimeBoundary(iam, accountId)") <
      bootstrap.indexOf("new PutRolePolicyCommand"),
  );
  assert.match(
    bootstrap,
    /PolicyDocument: JSON.stringify\(executionPolicyFor\(accountId\)\)/,
  );
  assert.ok(!bootstrap.includes("role/elixir-clan-*"));
});

test("analyzer findings prevent any IAM mutation or inspection", async () => {
  let calls = 0;
  await assert.rejects(
    ensureRuntimeBoundary(
      {
        send: async () => {
          calls++;
        },
      },
      account,
      {
        send: async () => ({ findings: [{ issueCode: "REJECTED" }] }),
      },
    ),
    /REJECTED/,
  );
  assert.equal(calls, 0);
});

test("a foreign runtime boundary is rejected before policy creation", async () => {
  const calls = [];
  const iam = {
    send: async (command) => {
      calls.push(command.constructor.name);
      return {
        Role: {
          PermissionsBoundary: {
            PermissionsBoundaryArn: "arn:aws:iam::123456789012:policy/other",
          },
        },
      };
    },
  };
  await assert.rejects(
    ensureRuntimeBoundary(iam, account, cleanAnalyzer),
    /unexpected boundary/,
  );
  assert.deepEqual(calls, ["GetRoleCommand"]);
});

test("first installation creates the reviewed boundary before attaching it", async () => {
  const calls = [];
  const iam = {
    send: async (command) => {
      calls.push(command);
      if (command.constructor.name === "GetRoleCommand") return { Role: {} };
      if (command.constructor.name === "GetPolicyCommand") throw absent();
      return {};
    },
  };
  assert.equal(
    await ensureRuntimeBoundary(iam, account, cleanAnalyzer),
    boundary,
  );
  assert.deepEqual(
    calls.map((command) => command.constructor.name),
    [
      "GetRoleCommand",
      "GetPolicyCommand",
      "CreatePolicyCommand",
      "PutRolePermissionsBoundaryCommand",
    ],
  );
  assert.deepEqual(
    JSON.parse(calls[2].input.PolicyDocument),
    runtimeBoundaryFor(account),
  );
  assert.equal(calls[3].input.PermissionsBoundary, boundary);
});

test("an existing boundary with different grants is never overwritten or attached", async () => {
  const calls = [];
  const iam = {
    send: async (command) => {
      calls.push(command.constructor.name);
      if (command.constructor.name === "GetRoleCommand") return { Role: {} };
      if (command.constructor.name === "GetPolicyCommand")
        return { Policy: { DefaultVersionId: "v1" } };
      return {
        PolicyVersion: {
          Document: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{ Effect: "Allow", Action: "*", Resource: "*" }],
          }),
        },
      };
    },
  };
  await assert.rejects(
    ensureRuntimeBoundary(iam, account, cleanAnalyzer),
    /differs from reviewed source/,
  );
  assert.ok(calls.every((name) => name.startsWith("Get")));
});

test("an installed matching boundary is idempotent and requires no IAM writes", async () => {
  const calls = [];
  const iam = {
    send: async (command) => {
      calls.push(command.constructor.name);
      if (command.constructor.name === "GetRoleCommand") {
        return {
          Role: { PermissionsBoundary: { PermissionsBoundaryArn: boundary } },
        };
      }
      if (command.constructor.name === "GetPolicyCommand") {
        return { Policy: { DefaultVersionId: "v1" } };
      }
      return {
        PolicyVersion: {
          Document: encodeURIComponent(
            JSON.stringify(runtimeBoundaryFor(account)),
          ),
        },
      };
    },
  };
  assert.equal(
    await ensureRuntimeBoundary(iam, account, cleanAnalyzer),
    boundary,
  );
  assert.deepEqual(calls, [
    "GetRoleCommand",
    "GetPolicyCommand",
    "GetPolicyVersionCommand",
  ]);
});

test("fresh bootstrap creates the boundary while the application role is absent", async () => {
  const calls = [];
  const iam = {
    send: async (command) => {
      calls.push(command.constructor.name);
      if (command.constructor.name.startsWith("Get")) throw absent();
      return {};
    },
  };
  assert.equal(
    await ensureRuntimeBoundary(iam, account, cleanAnalyzer),
    boundary,
  );
  assert.deepEqual(calls, [
    "GetRoleCommand",
    "GetPolicyCommand",
    "CreatePolicyCommand",
  ]);
});
