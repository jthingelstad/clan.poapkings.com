import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("the weekly clan report has one status across the product contract", async () => {
  const [agents, vision, notes] = await Promise.all([
    read("AGENTS.md"),
    read("docs/VISION.md"),
    read("docs/NOTES.md"),
  ]);

  assert.match(
    agents,
    /The weekly clan report by email is agreed and is not built yet\./,
  );
  assert.match(vision, /weekly clan\s+report by email is next\./);
  assert.match(notes, /The weekly clan report is its own later round\./);
  assert.doesNotMatch(agents, /weekly digest/);
});
