#!/usr/bin/env node
/**
 * One-time account bootstrap (AWS_PROFILE=cloud-engineer, before the first deploy).
 * Idempotent: existing resources are left alone and reported.
 *
 *  1. code bucket elixir-clan-code-<account> (versioned, private)
 *  2. app secret elixir-clan/app with a generated session_secret. The
 *     value is minted here and sent straight to Secrets Manager; it is
 *     never printed, written to a file, or read back (aws-secrets-manager
 *     skill). The template consumes it as a dynamic reference.
 *  3. CloudFormation execution role elixir-clan-cloudformation-execution,
 *     scoped to elixir-clan-* resources
 *  4. CI role elixir-clan-github-deploy: the stack, the two buckets,
 *     CloudFront invalidations, PassRole of the execution role. GitHub
 *     Actions assumes it with its OIDC token from this repo's `production`
 *     environment; there is no key to store, print or rotate (2026-09-26,
 *     replacing the elixir-clan-deploy user's static keys). The account's
 *     GitHub OIDC provider is shared and administrator-owned.
 *
 * The alarm topic is a stack resource, so wiring it to the sysadmin ops
 * queue is a separate step: scripts/wire-alarms.mjs, after the first deploy.
 */

import crypto from "node:crypto";
import {
  DEPLOYMENT_POLICY,
  deploymentPolicyFor,
  executionPolicyFor,
  githubDeployTrustFor,
} from "./iam-policies.mjs";
import { ensureRuntimeBoundary } from "./runtime-boundary.mjs";
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
  CreateRoleCommand,
  GetRoleCommand,
  PutRolePolicyCommand,
  UpdateAssumeRolePolicyCommand,
} from "@aws-sdk/client-iam";
import {
  CFN_ROLE,
  DEPLOY_ROLE,
  REGION,
  SECRET_NAME,
  codeBucketFor,
  tagsFor,
} from "./stack.mjs";

const TAGS = tagsFor("repository");

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

// 4. CI role (GitHub OIDC) ---------------------------------------------------
let deployRole;
try {
  ({ Role: deployRole } = await iam.send(
    new GetRoleCommand({ RoleName: DEPLOY_ROLE }),
  ));
  await iam.send(
    new UpdateAssumeRolePolicyCommand({
      RoleName: DEPLOY_ROLE,
      PolicyDocument: JSON.stringify(githubDeployTrustFor(accountId)),
    }),
  );
  console.log(`ci role exists: ${DEPLOY_ROLE} (trust re-applied from source)`);
} catch {
  ({ Role: deployRole } = await iam.send(
    new CreateRoleCommand({
      RoleName: DEPLOY_ROLE,
      AssumeRolePolicyDocument: JSON.stringify(githubDeployTrustFor(accountId)),
      Description: "GitHub Actions deploys of jthingelstad/clan.poapkings.com",
      MaxSessionDuration: 3600,
      Tags: TAGS,
    }),
  ));
  console.log(`created ci role: ${DEPLOY_ROLE}`);
}
await iam.send(
  new PutRolePolicyCommand({
    RoleName: DEPLOY_ROLE,
    PolicyName: DEPLOYMENT_POLICY,
    PolicyDocument: JSON.stringify(deploymentPolicyFor(accountId)),
  }),
);

console.log(`\nbootstrap complete.
  code bucket:  ${codeBucket}
  cfn role:     ${role.Arn}
  ci role:      ${deployRole.Arn} (GitHub variable ELIXIR_CLAN_DEPLOY_ROLE_ARN)
  secret:       ${SECRET_NAME}
next: node infra/scripts/deploy.mjs --create`);
