#!/usr/bin/env node
/**
 * Build the SPA, upload it to the private web bucket, delete what is no
 * longer built, invalidate CloudFront. Hashed assets are immutable for a
 * year; index.html is never cached past the edge's five minutes.
 */

import {
  CloudFrontClient,
  CreateInvalidationCommand,
  waitUntilInvalidationCompleted,
} from "@aws-sdk/client-cloudfront";
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { REGION, STACK } from "./stack.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");

const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".otf", "font/otf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".woff2", "font/woff2"],
]);

export const contentTypeFor = (key) =>
  CONTENT_TYPES.get(extname(key).toLowerCase()) ?? "application/octet-stream";

export function cacheControlFor(key) {
  if (key.endsWith(".html")) return "public, max-age=0, s-maxage=300";
  if (/^assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:css|js)$/.test(key))
    return "public, max-age=31536000, immutable";
  if (/\.(?:otf|woff2|png|svg)$/.test(key)) return "public, max-age=604800";
  return "public, max-age=3600";
}

async function filesUnder(root, dir = root) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(root, p)));
    else out.push({ key: relative(root, p).split(sep).join("/"), path: p });
  }
  return out;
}

async function main() {
  execFileSync("npm", ["run", "build", "-w", "@elixir-clan/web"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  const dist = resolve(repoRoot, "apps/web/dist");
  const files = await filesUnder(dist);
  if (!files.some((f) => f.key === "index.html"))
    throw new Error("the web build is missing index.html");

  const cfn = new CloudFormationClient({ region: REGION });
  const { Stacks } = await cfn.send(
    new DescribeStacksCommand({ StackName: STACK }),
  );
  const out = (k) => {
    const v = Stacks[0].Outputs.find((o) => o.OutputKey === k)?.OutputValue;
    if (!v) throw new Error(`stack did not return ${k}`);
    return v;
  };
  const bucket = out("WebBucketName");
  const distributionId = out("DistributionId");

  const s3 = new S3Client({ region: REGION });
  for (const { key, path } of files) {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: await readFile(path),
        CacheControl: cacheControlFor(key),
        ContentType: contentTypeFor(key),
      }),
    );
  }
  const wanted = new Set(files.map((f) => f.key));
  const existing = [];
  let token;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
    );
    existing.push(...(page.Contents ?? []).map((o) => o.Key));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  const stale = existing.filter((k) => !wanted.has(k));
  if (stale.length)
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: stale.map((Key) => ({ Key })), Quiet: true },
      }),
    );

  const cloudfront = new CloudFrontClient({ region: "us-east-1" });
  const inv = await cloudfront.send(
    new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: `${process.env.GITHUB_SHA ?? "local"}-${randomUUID()}`,
        Paths: { Quantity: 1, Items: ["/*"] },
      },
    }),
  );
  const wait = await waitUntilInvalidationCompleted(
    { client: cloudfront, maxWaitTime: 600 },
    { DistributionId: distributionId, Id: inv.Invalidation.Id },
  );
  if (wait.state !== "SUCCESS")
    throw new Error(`invalidation ended in ${wait.state}`);
  console.log(
    `uploaded ${files.length} files to ${bucket}; removed ${stale.length} stale; edge flushed`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
