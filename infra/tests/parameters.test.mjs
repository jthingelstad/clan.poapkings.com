import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildParameters,
  parseOverrides,
  PRESERVED_PARAMETERS,
} from "../scripts/parameters.mjs";
import { readFile } from "node:fs/promises";

const required = { CodeBucket: "b", ApiCodeKey: "k" };

test("every preserved parameter rides UsePreviousValue on an update", () => {
  const params = buildParameters(required, { stackExists: true });
  for (const key of PRESERVED_PARAMETERS) {
    const p = params.find((x) => x.ParameterKey === key);
    assert.deepEqual(p, { ParameterKey: key, UsePreviousValue: true }, key);
  }
});

test("on create, preserved parameters are omitted so the template Default applies once", () => {
  const params = buildParameters(required, { stackExists: false });
  assert.deepEqual(
    params.map((p) => p.ParameterKey),
    ["CodeBucket", "ApiCodeKey"],
  );
});

test("an override is sent as a value and never as UsePreviousValue", () => {
  const params = buildParameters(required, {
    stackExists: true,
    overrides: { AppUrl: "https://clan.poapkings.com" },
  });
  assert.deepEqual(
    params.find((p) => p.ParameterKey === "AppUrl"),
    {
      ParameterKey: "AppUrl",
      ParameterValue: "https://clan.poapkings.com",
    },
  );
});

test("a parameter the live stack never carried is omitted rather than UsePreviousValue", () => {
  const params = buildParameters(required, {
    stackExists: true,
    existingKeys: ["CodeBucket", "ApiCodeKey", "AppUrl"],
  });
  assert.ok(params.find((p) => p.ParameterKey === "AppUrl"));
  assert.equal(
    params.find((p) => p.ParameterKey === "OAuthClientId"),
    undefined,
  );
});

test("a missing required parameter and an unknown override both refuse", () => {
  assert.throws(
    () => buildParameters({ CodeBucket: "b" }, { stackExists: true }),
    /ApiCodeKey/,
  );
  assert.throws(
    () =>
      buildParameters(required, {
        stackExists: true,
        overrides: { Nope: "1" },
      }),
    /unknown parameter override/,
  );
});

test("parseOverrides keeps '=' inside a value", () => {
  assert.deepEqual(
    parseOverrides(["--param=AppUrl=https://x/?a=b", "--other"]),
    {
      AppUrl: "https://x/?a=b",
    },
  );
});

test("the template's parameters are exactly REQUIRED + PRESERVED (nothing can be silently reset)", async () => {
  const template = await readFile(
    new URL("../template.yaml", import.meta.url),
    "utf8",
  );
  const section = template.slice(
    template.indexOf("Parameters:"),
    template.indexOf("Conditions:"),
  );
  const declared = [...section.matchAll(/^  ([A-Z][A-Za-z]+):$/gm)].map(
    (m) => m[1],
  );
  assert.deepEqual(
    new Set(declared),
    new Set(["CodeBucket", "ApiCodeKey", ...PRESERVED_PARAMETERS]),
  );
});
