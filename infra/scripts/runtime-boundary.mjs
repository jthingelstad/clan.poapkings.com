/** Reviewed administrator-only boundary installation. Never reads an application secret. */
import assert from "node:assert/strict";
import {
  CreatePolicyCommand,
  GetPolicyCommand,
  GetPolicyVersionCommand,
  GetRoleCommand,
  PutRolePermissionsBoundaryCommand,
} from "@aws-sdk/client-iam";
import {
  AccessAnalyzerClient,
  ValidatePolicyCommand,
} from "@aws-sdk/client-accessanalyzer";
import { REGION } from "./stack.mjs";
import {
  BOUNDARY_NAME,
  RUNTIME_ROLE,
  boundaryArnFor,
  executionPolicyFor,
  runtimeBoundaryFor,
} from "./iam-policies.mjs";

export function decodePolicy(document) {
  if (typeof document !== "string") return document;
  try {
    return JSON.parse(document);
  } catch {
    return JSON.parse(decodeURIComponent(document));
  }
}

/** AWS may return a single Action/Resource as either a string or a list. */
export function comparablePolicy(document) {
  const policy = structuredClone(decodePolicy(document));
  for (const statement of policy.Statement) {
    for (const key of ["Action", "Resource"]) {
      if (statement[key]) statement[key] = [].concat(statement[key]).sort();
    }
  }
  return policy;
}

export async function validateIamPolicies(analyzer, accountId) {
  for (const [name, document] of [
    ["runtime boundary", runtimeBoundaryFor(accountId)],
    ["execution policy", executionPolicyFor(accountId)],
  ]) {
    const { findings = [] } = await analyzer.send(
      new ValidatePolicyCommand({
        policyDocument: JSON.stringify(document),
        policyType: "IDENTITY_POLICY",
      }),
    );
    assert.equal(
      findings.length,
      0,
      `${name}: ${findings.map((finding) => finding.issueCode).join(", ")}`,
    );
  }
}

export async function ensureRuntimeBoundary(
  iam,
  accountId,
  analyzer = new AccessAnalyzerClient({ region: REGION }),
) {
  await validateIamPolicies(analyzer, accountId);
  const arn = boundaryArnFor(accountId);
  let role;
  try {
    role = (await iam.send(new GetRoleCommand({ RoleName: RUNTIME_ROLE })))
      .Role;
  } catch (error) {
    // A first bootstrap creates the boundary before the application stack exists.
    if (error.name !== "NoSuchEntityException") throw error;
  }
  assert.ok(
    !role?.PermissionsBoundary ||
      role.PermissionsBoundary.PermissionsBoundaryArn === arn,
    "Application role has an unexpected boundary; do not replace it",
  );
  let existing;
  try {
    existing = await iam.send(new GetPolicyCommand({ PolicyArn: arn }));
  } catch (error) {
    if (error.name !== "NoSuchEntityException") throw error;
  }
  if (existing) {
    const { PolicyVersion } = await iam.send(
      new GetPolicyVersionCommand({
        PolicyArn: arn,
        VersionId: existing.Policy.DefaultVersionId,
      }),
    );
    assert.deepEqual(
      comparablePolicy(PolicyVersion.Document),
      comparablePolicy(runtimeBoundaryFor(accountId)),
      "Runtime boundary differs from reviewed source; do not overwrite it",
    );
  } else {
    await iam.send(
      new CreatePolicyCommand({
        PolicyName: BOUNDARY_NAME,
        Description:
          "Administrator-owned cap for the Elixir Clan application role",
        PolicyDocument: JSON.stringify(runtimeBoundaryFor(accountId)),
        Tags: [{ Key: "application", Value: "elixir-clan" }],
      }),
    );
  }
  if (role) {
    if (!role.PermissionsBoundary) {
      await iam.send(
        new PutRolePermissionsBoundaryCommand({
          RoleName: RUNTIME_ROLE,
          PermissionsBoundary: arn,
        }),
      );
    }
  }
  return arn;
}
