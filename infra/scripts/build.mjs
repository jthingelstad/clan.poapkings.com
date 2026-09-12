/**
 * Bundle the API Lambda with esbuild into infra/dist/api/ and zip it.
 * ESM output for nodejs24.x; @aws-sdk/* stays external (the runtime
 * provides it). The key is content-addressed so an unchanged bundle is a
 * real no-op at the stack.
 */

import { build } from "esbuild";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "../..");
const distRoot = path.join(repoRoot, "infra/dist");

export async function buildApi() {
  const outDir = path.join(distRoot, "api");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await build({
    entryPoints: [path.join(repoRoot, "services/api/src/index.mjs")],
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    outfile: path.join(outDir, "index.mjs"),
    external: ["@aws-sdk/*"],
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    sourcemap: false,
    minify: false,
    logLevel: "error",
  });
  const zipPath = path.join(distRoot, "api.zip");
  await rm(zipPath, { force: true });
  execFileSync("zip", ["-qrX", zipPath, "."], { cwd: outDir });
  const body = await readFile(zipPath);
  const bundle = await readFile(path.join(outDir, "index.mjs"));
  // Hash the bundle, not the zip: zip carries timestamps.
  const sha = createHash("sha256").update(bundle).digest("hex").slice(0, 16);
  return { zipPath, body, codeKey: `code/api/${sha}.zip` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { zipPath, codeKey } = await buildApi();
  console.log(`built ${zipPath} -> ${codeKey}`);
}
