/**
 * The design stylesheet (imported from the pinned elixir-mcp dependency)
 * names the Clash display face at /assets/fonts/Clash_Regular.otf. The
 * font is a Supercell Fan Kit asset that ships in Elixir's public tree,
 * so it is copied from the SAME pinned dependency at build time rather
 * than committed here: one source, and the README with its Fan Content
 * Policy note travels with it. The destination is gitignored.
 */

import { createRequire } from "node:module";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const elixirRoot = path.dirname(require.resolve("elixir-mcp/package.json"));
const from = path.join(elixirRoot, "apps/web/public/assets/fonts");
const to = path.resolve(here, "../public/assets/fonts");

await mkdir(to, { recursive: true });
for (const file of ["Clash_Regular.otf", "README.md"]) {
  await cp(path.join(from, file), path.join(to, file));
}
console.error(`fonts: copied from ${path.relative(process.cwd(), from)}`);
