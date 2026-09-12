import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { preflight } from "./preflight.mjs";

function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "mcp-preflight-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (root, ...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" });
  git(dir, "init", "--bare", "--initial-branch=main", "origin");
  git(dir, "clone", path.join(dir, "origin"), "work");
  const root = path.join(dir, "work");
  const run = (...args) => git(root, ...args);
  run("config", "user.name", "fixture");
  run("config", "user.email", "fixture@example.invalid");
  writeFileSync(path.join(root, "README.md"), "fixture\n");
  run("add", ".");
  run("commit", "-m", "fixture");
  run("push", "-u", "origin", "main");
  return { root, git: run };
}
const healthy = async () => ({ ok: true });

test("clean synchronized main is eligible; unavailable health is a separate finding", async (t) => {
  const { root } = fixture(t);
  assert.equal((await preflight(root, healthy)).mutation, "eligible");
  const r = await preflight(root, async () => {
    throw new Error("offline");
  });
  assert.equal(r.observation, "unavailable");
  assert.equal(r.mutation, "eligible");
});

test("held lease and dirty helper block mutation while observation continues without executing helper", async (t) => {
  const { root } = fixture(t);
  mkdirSync(path.join(root, "AGENT-TEAM/scripts"), { recursive: true });
  writeFileSync(
    path.join(root, "AGENT-TEAM/scripts/objective-lease.mjs"),
    'throw new Error("must never execute dirty helper");',
  );
  writeFileSync(
    path.join(root, ".git/agent-team-objective-lease.json"),
    JSON.stringify({ objective: "judge" }),
  );
  let observed = false;
  const r = await preflight(root, async () => {
    observed = true;
    return { ok: true };
  });
  assert.equal(observed, true);
  assert.equal(r.observation, "available");
  assert.equal(r.mutation, "blocked");
  assert.ok(r.reasons.includes("dirty worktree"));
  assert.ok(r.reasons.includes("checkout lease held"));
});

for (const state of [
  "ahead",
  "behind",
  "detached",
  "wrong-branch",
  "no-upstream",
  "fetch-failure",
  "bad-lease",
]) {
  test(`${state} cannot permit mutation or suppress independent observation`, async (t) => {
    const { root, git } = fixture(t);
    if (state === "ahead" || state === "behind") {
      writeFileSync(path.join(root, "README.md"), "changed\n");
      git("add", ".");
      git("commit", "-m", "change");
      if (state === "behind") {
        git("push");
        git("reset", "--hard", "HEAD~1");
      }
    }
    if (state === "detached") git("checkout", "--detach");
    if (state === "wrong-branch") git("checkout", "-b", "other");
    if (state === "no-upstream") git("branch", "--unset-upstream");
    if (state === "fetch-failure")
      git("remote", "set-url", "origin", path.join(root, "missing"));
    if (state === "bad-lease")
      writeFileSync(
        path.join(root, ".git/agent-team-objective-lease.json"),
        "invalid json",
      );
    const r = await preflight(root, healthy);
    assert.equal(r.mutation, "blocked");
    assert.equal(r.observation, "available");
  });
}
