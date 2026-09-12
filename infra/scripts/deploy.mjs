#!/usr/bin/env node
/**
 * Deploy. Locally: AWS_PROFILE=jamie in the environment. In CI: the
 * elixir-clan-deploy user's keys and ELIXIR_CLAN_CFN_ROLE_ARN. Order is
 * build -> upload -> stack create/update -> web -> smoke.
 *
 *   node infra/scripts/deploy.mjs --create              first deploy
 *   node infra/scripts/deploy.mjs                       update
 *   node infra/scripts/deploy.mjs --skip-web            code/infra only
 *   node infra/scripts/deploy.mjs --param=AppUrl=...    set a PRESERVED parameter once
 *
 * On --create the app's own URL is not known until CloudFront exists, so
 * the create is followed by one update that sets AppUrl to the
 * distribution's default hostname. Flip it to https://clan.poapkings.com
 * with --param=AppUrl=... once DNS lands (docs/NOTES.md).
 */

import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CloudFormationClient,
  CreateStackCommand,
  DescribeStacksCommand,
  UpdateStackCommand,
  waitUntilStackCreateComplete,
  waitUntilStackUpdateComplete,
} from "@aws-sdk/client-cloudformation";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { buildApi } from "./build.mjs";
import { loadEnvInto } from "./env.mjs";
import { buildParameters, parseOverrides } from "./parameters.mjs";
import { REGION, STACK, codeBucketFor } from "./stack.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
await loadEnvInto(path.join(repoRoot, ".env"));

const args = process.argv.slice(2);
const isCreate = args.includes("--create");
const skipWeb = args.includes("--skip-web");
const overrides = parseOverrides(args);

const sts = new STSClient({ region: REGION });
const { Account: accountId } = await sts.send(new GetCallerIdentityCommand({}));
const codeBucket = codeBucketFor(accountId);
const cfn = new CloudFormationClient({ region: REGION });
const s3 = new S3Client({ region: REGION });
const roleArn = process.env.ELIXIR_CLAN_CFN_ROLE_ARN;

// 1. Build + upload ---------------------------------------------------------
console.error("building the api bundle...");
const { body, codeKey } = await buildApi();
await s3.send(
  new PutObjectCommand({
    Bucket: codeBucket,
    Key: codeKey,
    Body: body,
    ContentType: "application/zip",
    ServerSideEncryption: "AES256",
  }),
);
console.error(`uploaded ${codeKey}`);

// 2. Stack ------------------------------------------------------------------
const templateBody = await readFile(
  path.join(repoRoot, "infra/template.yaml"),
  "utf8",
);
const required = { CodeBucket: codeBucket, ApiCodeKey: codeKey };
const common = {
  StackName: STACK,
  TemplateBody: templateBody,
  Capabilities: ["CAPABILITY_NAMED_IAM"],
  ...(roleArn ? { RoleARN: roleArn } : {}),
  Tags: [{ Key: "application", Value: "elixir-clan" }],
};

async function describe() {
  const { Stacks } = await cfn.send(
    new DescribeStacksCommand({ StackName: STACK }),
  );
  return Stacks[0];
}

async function update(params) {
  try {
    await cfn.send(new UpdateStackCommand({ ...common, Parameters: params }));
  } catch (err) {
    if (String(err.message ?? "").includes("No updates are to be performed")) {
      console.error("stack unchanged");
      return;
    }
    throw err;
  }
  const wait = await waitUntilStackUpdateComplete(
    { client: cfn, maxWaitTime: 1800 },
    { StackName: STACK },
  );
  if (wait.state !== "SUCCESS")
    throw new Error(`stack update ended in ${wait.state}`);
}

if (isCreate) {
  console.error("creating stack...");
  await cfn.send(
    new CreateStackCommand({
      ...common,
      Parameters: buildParameters(required, { stackExists: false, overrides }),
      OnFailure: "ROLLBACK",
    }),
  );
  const wait = await waitUntilStackCreateComplete(
    { client: cfn, maxWaitTime: 1800 },
    { StackName: STACK },
  );
  if (wait.state !== "SUCCESS")
    throw new Error(`stack creation ended in ${wait.state}`);
  if (!overrides.AppUrl) {
    // The app must know its own origin, and that origin did not exist
    // until just now. One follow-up update, then AppUrl is PRESERVED.
    const created = await describe();
    const domain = created.Outputs.find(
      (o) => o.OutputKey === "DistributionDomainName",
    ).OutputValue;
    console.error(`setting AppUrl to https://${domain} ...`);
    await update(
      buildParameters(required, {
        stackExists: true,
        overrides: { AppUrl: `https://${domain}` },
        existingKeys: created.Parameters.map((p) => p.ParameterKey),
      }),
    );
  }
} else {
  console.error("updating stack...");
  const current = await describe();
  await update(
    buildParameters(required, {
      stackExists: true,
      overrides,
      existingKeys: (current.Parameters ?? []).map((p) => p.ParameterKey),
    }),
  );
}

const stack = await describe();
const outputs = Object.fromEntries(
  stack.Outputs.map((o) => [o.OutputKey, o.OutputValue]),
);

// 3. Web --------------------------------------------------------------------
if (!skipWeb) {
  execFileSync(process.execPath, [path.join(here, "deploy-web.mjs")], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

// 4. Smoke ------------------------------------------------------------------
const smoke = spawnSync(process.execPath, [path.join(here, "smoke.mjs")], {
  cwd: repoRoot,
  stdio: "inherit",
});
if (smoke.status !== 0) {
  console.error("SMOKE FAILED - the stack deployed but the site misbehaves.");
  process.exit(1);
}

console.log("\ndeploy complete.");
console.log(
  `site: https://${outputs.DistributionDomainName}  (CNAME clan.poapkings.com here)`,
);
console.log(`alarm topic: ${outputs.AlarmTopicArn}`);
