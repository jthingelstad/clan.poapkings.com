#!/usr/bin/env node
/** Administrator-only correction for projects-sysadmin #48. No credential or data operations. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  IAMClient,
  GetRoleCommand,
  GetRolePolicyCommand,
  GetUserCommand,
  GetUserPolicyCommand,
  ListAttachedRolePoliciesCommand,
  ListRolePoliciesCommand,
  ListAttachedUserPoliciesCommand,
  ListUserPoliciesCommand,
  ListGroupsForUserCommand,
  PutRolePolicyCommand,
  GetPolicyCommand,
  GetPolicyVersionCommand,
} from "@aws-sdk/client-iam";
import {
  AccessAnalyzerClient,
  ValidatePolicyCommand,
} from "@aws-sdk/client-accessanalyzer";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { CFN_ROLE, CI_USER, REGION, STACK } from "./stack.mjs";
import {
  EXECUTION_POLICY,
  RUNTIME_ROLE,
  boundaryArnFor,
  deploymentPolicyFor,
  executionPolicyFor,
  runtimeBoundaryFor,
  trustFor,
} from "./iam-policies.mjs";
import {
  comparablePolicy,
  ensureRuntimeBoundary,
  validateIamPolicies,
} from "./runtime-boundary.mjs";

const args = process.argv.slice(2);
const command = args[0];
const option = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
assert.ok(["validate", "apply", "verify"].includes(command));
const profile = option("--profile") ?? "jamie";
assert.equal(
  profile,
  "jamie",
  "Use the explicitly authorized non-root administrator",
);
assert.equal(REGION, "us-east-1");
assert.equal(STACK, "elixir-clan");
const config = { region: REGION, profile };
const identity = await new STSClient(config).send(
  new GetCallerIdentityCommand({}),
);
assert.equal(identity.Account, "999153317627");
assert.equal(identity.Arn, "arn:aws:iam::999153317627:user/jamie");
const accountId = identity.Account;
const iam = new IAMClient(config);
const analyzer = new AccessAnalyzerClient(config);
// Exact pre-change document from the clean source reviewed for #48.
const reviewedLegacyExecutionHash =
  "af5ee40726132c763957368f52f6461a401815b3c8f1d3366660fbf3f1557a3f";
const policyHash = (document) =>
  createHash("sha256")
    .update(JSON.stringify(comparablePolicy(document)))
    .digest("hex");

async function inspect() {
  const roleState = async (name, policyName) => {
    const [role, inline, attached, names] = await Promise.all([
      iam.send(new GetRoleCommand({ RoleName: name })),
      iam.send(
        new GetRolePolicyCommand({ RoleName: name, PolicyName: policyName }),
      ),
      iam.send(new ListAttachedRolePoliciesCommand({ RoleName: name })),
      iam.send(new ListRolePoliciesCommand({ RoleName: name })),
    ]);
    assert.deepEqual(
      attached.AttachedPolicies,
      [],
      `${name}: unexpected managed policy`,
    );
    assert.ok(
      !attached.IsTruncated && !names.IsTruncated,
      "Incomplete role policy inventory requires review",
    );
    assert.deepEqual(
      names.PolicyNames,
      [policyName],
      `${name}: unexpected inline policy`,
    );
    return { role: role.Role, policy: inline.PolicyDocument };
  };
  const [execution, runtime, user, policy, attached, names, groups] =
    await Promise.all([
      roleState(CFN_ROLE, EXECUTION_POLICY),
      roleState(RUNTIME_ROLE, RUNTIME_ROLE),
      iam.send(new GetUserCommand({ UserName: CI_USER })),
      iam.send(
        new GetUserPolicyCommand({
          UserName: CI_USER,
          PolicyName: "elixir-clan-deployment",
        }),
      ),
      iam.send(new ListAttachedUserPoliciesCommand({ UserName: CI_USER })),
      iam.send(new ListUserPoliciesCommand({ UserName: CI_USER })),
      iam.send(new ListGroupsForUserCommand({ UserName: CI_USER })),
    ]);
  assert.deepEqual(attached.AttachedPolicies, []);
  assert.deepEqual(names.PolicyNames, ["elixir-clan-deployment"]);
  assert.deepEqual(groups.Groups, []);
  assert.ok(
    !attached.IsTruncated && !names.IsTruncated && !groups.IsTruncated,
    "Incomplete CI inventory requires review",
  );
  assert.deepEqual(
    comparablePolicy(execution.role.AssumeRolePolicyDocument),
    comparablePolicy(trustFor("cloudformation.amazonaws.com")),
  );
  assert.deepEqual(
    comparablePolicy(runtime.role.AssumeRolePolicyDocument),
    comparablePolicy(trustFor("lambda.amazonaws.com")),
  );
  assert.ok(
    !execution.role.PermissionsBoundary,
    "Unexpected execution boundary requires review",
  );
  assert.ok(
    !user.User.PermissionsBoundary,
    "Unexpected CI boundary requires review",
  );
  assert.deepEqual(
    comparablePolicy(policy.PolicyDocument),
    comparablePolicy(deploymentPolicyFor(accountId)),
  );
  assert.deepEqual(
    comparablePolicy(runtime.policy),
    comparablePolicy(runtimeBoundaryFor(accountId)),
  );
  return {
    execution,
    runtime,
    ci: { user: user.User, policy: policy.PolicyDocument },
  };
}

await validateIamPolicies(analyzer, accountId);
const deployValidation = await analyzer.send(
  new ValidatePolicyCommand({
    policyDocument: JSON.stringify(deploymentPolicyFor(accountId)),
    policyType: "IDENTITY_POLICY",
  }),
);
assert.equal(deployValidation.findings?.length ?? 0, 0);
if (command === "validate") {
  console.log(
    "All three reviewed IAM documents have zero Access Analyzer findings.",
  );
} else {
  const before = await inspect();
  if (command === "apply") {
    const directory = option("--snapshot-dir");
    assert.ok(
      directory,
      "apply requires a private --snapshot-dir outside the checkout",
    );
    assert.ok(path.isAbsolute(directory), "Use an absolute private directory");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);
    assert.ok(
      info.isDirectory() && (info.mode & 0o077) === 0,
      "Snapshot directory must be private and not a symlink",
    );
    const snapshot = await realpath(directory);
    const repo = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../..",
    );
    assert.ok(snapshot !== repo && !snapshot.startsWith(`${repo}${path.sep}`));
    assert.ok(
      [
        reviewedLegacyExecutionHash,
        policyHash(executionPolicyFor(accountId)),
      ].includes(policyHash(before.execution.policy)),
      "Execution policy differs from both reviewed pre-change and corrected source; stop for review",
    );
    await writeFile(
      path.join(snapshot, "before.json"),
      JSON.stringify(
        {
          identity: { Account: identity.Account, Arn: identity.Arn },
          ...before,
        },
        null,
        2,
      ),
      { mode: 0o600, flag: "wx" },
    );
    await ensureRuntimeBoundary(iam, accountId, analyzer);
    await iam.send(
      new PutRolePolicyCommand({
        RoleName: CFN_ROLE,
        PolicyName: EXECUTION_POLICY,
        PolicyDocument: JSON.stringify(executionPolicyFor(accountId)),
      }),
    );
    console.log(
      `Applied scoped execution policy and runtime boundary; rollback metadata: ${snapshot}`,
    );
  }
  const after = await inspect();
  assert.deepEqual(
    comparablePolicy(after.execution.policy),
    comparablePolicy(executionPolicyFor(accountId)),
  );
  assert.equal(
    after.runtime.role.PermissionsBoundary?.PermissionsBoundaryArn,
    boundaryArnFor(accountId),
  );
  const { Policy } = await iam.send(
    new GetPolicyCommand({ PolicyArn: boundaryArnFor(accountId) }),
  );
  const { PolicyVersion } = await iam.send(
    new GetPolicyVersionCommand({
      PolicyArn: Policy.Arn,
      VersionId: Policy.DefaultVersionId,
    }),
  );
  assert.deepEqual(
    comparablePolicy(PolicyVersion.Document),
    comparablePolicy(runtimeBoundaryFor(accountId)),
  );
  console.log(
    "Live execution, runtime, CI, trusts, boundary, and policy inventories match reviewed source.",
  );
}
