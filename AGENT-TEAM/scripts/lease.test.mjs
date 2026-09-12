import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Keep the Record True stalled on an ExpiredToken (2026-09-08), held the
 * `record` lease on Elixir, and blocked Close the Loop the same morning. A run that
 * cannot do its job must hand the checkout back and leave a note.
 *
 * The script derives its repo root from its own location, so each test
 * drives a COPY inside a scratch git repo: the suite must never depend on
 * this checkout being clean (it is not, mid-change) and must never touch
 * a lease a real session is holding.
 */
function scratchRepo() {
  const root = mkdtempSync(path.join(tmpdir(), "elixir-lease-"));
  mkdirSync(path.join(root, "AGENT-TEAM", "scripts"), { recursive: true });
  copyFileSync(
    path.join(here, "objective-lease.mjs"),
    path.join(root, "AGENT-TEAM", "scripts", "objective-lease.mjs"),
  );
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  writeFileSync(path.join(root, "README.md"), "scratch\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  const script = path.join(
    root,
    "AGENT-TEAM",
    "scripts",
    "objective-lease.mjs",
  );
  return {
    root,
    run: (...args) =>
      JSON.parse(
        execFileSync("node", [script, ...args], {
          cwd: root,
          encoding: "utf8",
        }),
      ),
    fails: (...args) => {
      try {
        execFileSync("node", [script, ...args], {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        return null;
      } catch (err) {
        return String(err.stderr ?? "");
      }
    },
    dirty: () => writeFileSync(path.join(root, "uncommitted.txt"), "work\n"),
    clean: () => rmSync(path.join(root, "uncommitted.txt"), { force: true }),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("abort releases the lease and queues a note for Jamie", () => {
  const repo = scratchRepo();
  try {
    const claimed = repo.run("claim", "judge");
    assert.equal(claimed.objective, "judge");

    // A reason is mandatory: "it broke" with no detail helps nobody.
    assert.match(
      repo.fails("abort", "judge", "--lease-id", claimed.leaseId),
      /--reason is required/,
    );
    // Another objective's name cannot abort this lease.
    assert.match(
      repo.fails(
        "abort",
        "loop",
        "--lease-id",
        claimed.leaseId,
        "--reason",
        "x",
      ),
      /belongs to another run/,
    );

    const aborted = repo.run(
      "abort",
      "judge",
      "--lease-id",
      claimed.leaseId,
      "--reason",
      "ExpiredToken on --profile jamie",
    );
    assert.equal(aborted.released, claimed.leaseId);
    assert.equal(aborted.note.objective, "judge");
    assert.match(aborted.note.reason, /ExpiredToken/);
    assert.equal(aborted.note.needs, "Jamie");

    // The lease is genuinely gone, so the next objective is not blocked.
    assert.equal(repo.run("status"), null);
    const next = repo.run("claim", "loop");
    assert.equal(next.objective, "loop");
    repo.run("release", "loop", "--lease-id", next.leaseId);

    // The note survives for preflight to print, and clears on demand.
    const queued = repo.run("notes");
    assert.equal(queued.length, 1);
    assert.match(queued[0].reason, /ExpiredToken/);
    assert.equal(queued[0].heldSince, claimed.claimedAt);
    assert.deepEqual(repo.run("notes", "--clear"), queued);
    assert.deepEqual(repo.run("notes"), []);
  } finally {
    repo.dispose();
  }
});

test("abort refuses to abandon uncommitted work", () => {
  const repo = scratchRepo();
  try {
    const claimed = repo.run("claim", "guard");
    repo.dirty();
    const err = repo.fails(
      "abort",
      "guard",
      "--lease-id",
      claimed.leaseId,
      "--reason",
      "ExpiredToken",
    );
    assert.match(err, /DIRTY/);
    assert.match(err, /Report to Jamie/);
    // Still held: a dirty checkout keeps its owner, and nothing is queued.
    assert.equal(repo.run("status").leaseId, claimed.leaseId);
    assert.deepEqual(repo.run("notes"), []);

    repo.clean();
    const aborted = repo.run(
      "abort",
      "guard",
      "--lease-id",
      claimed.leaseId,
      "--reason",
      "ExpiredToken",
    );
    assert.equal(aborted.released, claimed.leaseId);
  } finally {
    repo.dispose();
  }
});

test("a second claim is refused while a lease is held", () => {
  const repo = scratchRepo();
  try {
    const first = repo.run("claim", "run");
    assert.match(repo.fails("claim", "loop"), /already held/);
    repo.run("release", "run", "--lease-id", first.leaseId);
    const second = repo.run("claim", "loop");
    repo.run("release", "loop", "--lease-id", second.leaseId);
  } finally {
    repo.dispose();
  }
});
