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
  "services/engine/test",
  "services/api/src",
  "services/api/test",
  "apps/web/src",
  "apps/web/index.html",
  "infra/template.yaml",
  "infra/scripts",
  "scripts",
];
// Tests too (2026-09-26: a standings test used one clan's award names and
// members' names, in a public repo): case-insensitive names, award ids in
// snake_case, and a poapkings.com host other than the family's products
// (elixir., clan., drop.) and the account's wildcard certificate.
const SPECIFIC_CASED = /POAP|J2RGCRVG|20JJJ2CCRU|U8RYG9Y2U|VJQV8G8RL/;
const SPECIFIC_ANY_CASE =
  /poap[ _-]kings|free[ _]pass|war[ _]champ|iron[ _]king|rookie[ _]mvp|elixir-bot|(?<!(?:\b(?:elixir|clan|drop)|\*)\.)poapkings\.com/i;
const specific = (line) =>
  SPECIFIC_CASED.test(line) || SPECIFIC_ANY_CASE.test(line);
// A test that asserts product output never says these writes them in a
// regex literal; those lines are the guard's kin, not a leak.
const ASSERTS_ABSENCE = /doesNotMatch\(|^\s*\/.*\/[a-z]*,?\s*$/;
const SELF = "services/engine/test/no-clan-specifics.test.mjs";

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
    if (f === SELF) continue;
    if (!/\.(mjs|js|jsx|ts|tsx|html|yaml|json|css)$/.test(f)) continue;
    readFileSync(path.join(ROOT, f), "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (specific(line) && !ASSERTS_ABSENCE.test(line))
          hits.push(`${f}:${i + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(hits, []);
});
