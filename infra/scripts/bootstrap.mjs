#!/usr/bin/env node
/**
 * One-time account bootstrap (AWS_PROFILE=jamie, before the first deploy).
 * Idempotent: existing resources are left alone and reported.
 *
 *  1. code bucket elixir-clan-code-<account> (versioned, private)
 *  2. app secret elixir-clan/app with a generated session_secret. The
 *     value is minted here and sent straight to Secrets Manager; it is
 *     never printed, written to a file, or read back (aws-secrets-manager
 *     skill). The template consumes it as a dynamic reference.
 *  3. CloudFormation execution role elixir-clan-cloudformation-execution,
 *     scoped to elixir-clan-* resources
 *  4. CI user elixir-clan-deploy: the stack, the two buckets, CloudFront
 *     invalidations, PassRole of the execution role; access key appended
 *     to .env (0600) for `gh secret set` - never printed
 *
 * The alarm topic is a stack resource, so wiring it to the sysadmin ops
 * queue is a separate step: scripts/wire-alarms.mjs, after the first deploy.
 */

import crypto from "node:crypto";
import { deploymentPolicyFor, executionPolicyFor } from "./iam-policies.mjs";
import { ensureRuntimeBoundary } from "./runtime-boundary.mjs";
import { appendFile, chmod, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketVersioningCommand,
  PutPublicAccessBlockCommand,
} from "@aws-sdk/client-s3";
import {
  SecretsManagerClient,
  CreateSecretCommand,
  DescribeSecretCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  IAMClient,
  CreateAccessKeyCommand,
  CreateRoleCommand,
  CreateUserCommand,
  GetRoleCommand,
  GetUserCommand,
  ListAccessKeysCommand,
  PutRolePolicyCommand,
  PutUserPolicyCommand,
} from "@aws-sdk/client-iam";
import {
  CFN_ROLE,
  CI_USER,
  REGION,
  SECRET_NAME,
  codeBucketFor,
} from "./stack.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const envPath = path.join(repoRoot, ".env");
const TAGS = [{ Key: "application", Value: "elixir-clan" }];

const sts = new STSClient({ region: REGION });
const { Account: accountId } = await sts.send(new GetCallerIdentityCommand({}));
const codeBucket = codeBucketFor(accountId);

// 1. Code bucket ------------------------------------------------------------
const s3 = new S3Client({ region: REGION });
try {
  await s3.send(new HeadBucketCommand({ Bucket: codeBucket }));
  console.log(`bucket exists: ${codeBucket}`);
} catch {
  await s3.send(new CreateBucketCommand({ Bucket: codeBucket }));
  await s3.send(
    new PutPublicAccessBlockCommand({
      Bucket: codeBucket,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    }),
  );
  await s3.send(
    new PutBucketVersioningCommand({
      Bucket: codeBucket,
      VersioningConfiguration: { Status: "Enabled" },
    }),
  );
  console.log(`created bucket: ${codeBucket}`);
}

// 2. App secret --------------------------------------------------------------
const secrets = new SecretsManagerClient({ region: REGION });
try {
  await secrets.send(new DescribeSecretCommand({ SecretId: SECRET_NAME }));
  console.log(`secret exists: ${SECRET_NAME} (left untouched)`);
} catch {
  await secrets.send(
    new CreateSecretCommand({
      Name: SECRET_NAME,
      Description: "elixir-clan app secrets: session cookie signing secret",
      SecretString: JSON.stringify({
        session_secret: crypto.randomBytes(32).toString("base64url"),
      }),
      Tags: TAGS,
    }),
  );
  console.log(`created secret: ${SECRET_NAME}`);
}

// 3. CloudFormation execution role ------------------------------------------
const iam = new IAMClient({ region: REGION });
let role;
try {
  role = (await iam.send(new GetRoleCommand({ RoleName: CFN_ROLE }))).Role;
  console.log(`role exists: ${CFN_ROLE}`);
} catch {
  role = (
    await iam.send(
      new CreateRoleCommand({
        RoleName: CFN_ROLE,
        Description: "CloudFormation execution role for Elixir Clan",
        AssumeRolePolicyDocument: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: { Service: "cloudformation.amazonaws.com" },
              Action: "sts:AssumeRole",
            },
          ],
        }),
        Tags: TAGS,
      }),
    )
  ).Role;
  console.log(`created role: ${CFN_ROLE}`);
}
await ensureRuntimeBoundary(iam, accountId);
await iam.send(
  new PutRolePolicyCommand({
    RoleName: CFN_ROLE,
    PolicyName: "elixir-clan-stack-management",
    PolicyDocument: JSON.stringify(executionPolicyFor(accountId)),
  }),
);

// 4. CI user -----------------------------------------------------------------
try {
  await iam.send(new GetUserCommand({ UserName: CI_USER }));
  console.log(`iam user exists: ${CI_USER}`);
} catch {
  await iam.send(new CreateUserCommand({ UserName: CI_USER, Tags: TAGS }));
  console.log(`created iam user: ${CI_USER}`);
}
await iam.send(
  new PutUserPolicyCommand({
    UserName: CI_USER,
    PolicyName: "elixir-clan-deployment",
    PolicyDocument: JSON.stringify(deploymentPolicyFor(accountId)),
  }),
);

const { AccessKeyMetadata: keys } = await iam.send(
  new ListAccessKeysCommand({ UserName: CI_USER }),
);
let envText = "";
try {
  envText = await readFile(envPath, "utf8");
} catch {
  envText = "";
}
if (keys.length === 0) {
  const { AccessKey } = await iam.send(
    new CreateAccessKeyCommand({ UserName: CI_USER }),
  );
  await appendFile(
    envPath,
    `ELIXIR_CLAN_AWS_ACCESS_KEY_ID=${AccessKey.AccessKeyId}\nELIXIR_CLAN_AWS_SECRET_ACCESS_KEY=${AccessKey.SecretAccessKey}\n`,
  );
  await chmod(envPath, 0o600);
  console.log("ci access key appended to .env (0600)");
} else if (!envText.includes("ELIXIR_CLAN_AWS_SECRET_ACCESS_KEY=")) {
  console.log(
    `ci access key exists for ${CI_USER} but .env lacks its secret; not rotating`,
  );
} else {
  console.log("ci access key exists (not rotated)");
}

console.log(`\nbootstrap complete.
  code bucket:  ${codeBucket}
  cfn role:     ${role.Arn}
  ci user:      ${CI_USER}
  secret:       ${SECRET_NAME}
next: node infra/scripts/deploy.mjs --create`);
