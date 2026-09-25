/**
 * Elixir Clan is a general clan-management tool (Jamie, 2026-09-25): no
 * product source names a clan, a real player, one clan's awards or its
 * website, or the bot a clan's process was first ported from. A clan's
 * own rules, awards and words live in its saved policy, awards and pitch,
 * never in code. The family's hostnames (elixir.poapkings.com,
 * clan.poapkings.com) are where the product lives, not a clan, and pass.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const PRODUCT = [
  "services/engine/src",
  "services/api/src",
  "apps/web/src",
  "apps/web/index.html",
  "infra/template.yaml",
  "infra/scripts",
  "scripts",
];
const SPECIFIC =
  /POAP|J2RGCRVG|20JJJ2CCRU|U8RYG9Y2U|VJQV8G8RL|Free Pass|War Champ|Iron King|Rookie MVP|elixir-bot|(?<![\w.-])poapkings\.com/;

function files(p) {
  const abs = path.join(ROOT, p);
  let st;
  try {
    st = statSync(abs);
  } catch {
    return [];
  }
  if (!st.isDirectory()) return [p];
  return readdirSync(abs).flatMap((name) => files(path.join(p, name)));
}

test("no product source is specific to one clan", () => {
  const hits = [];
  for (const f of PRODUCT.flatMap(files)) {
    if (!/\.(mjs|js|jsx|ts|tsx|html|yaml|json)$/.test(f)) continue;
    readFileSync(path.join(ROOT, f), "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (SPECIFIC.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(hits, []);
});
