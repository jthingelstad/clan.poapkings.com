import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the API has bounded concurrency and evidence-sized throttles", async () => {
  const template = await readFile(
    new URL("../template.yaml", import.meta.url),
    "utf8",
  );
  const fn = template.slice(
    template.indexOf("  ApiFunction:"),
    template.indexOf("  # The HTTP API, spelled out"),
  );
  const stage = template.slice(
    template.indexOf("  ApiStage:"),
    template.indexOf("  HttpApiPermission:"),
  );

  assert.match(fn, /^      ReservedConcurrentExecutions: 10$/m);
  assert.match(
    stage,
    /^      DefaultRouteSettings:\n        DetailedMetricsEnabled: false\n        ThrottlingRateLimit: 10\n        ThrottlingBurstLimit: 20$/m,
  );
});
