import { test } from "node:test";
import assert from "node:assert/strict";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createDynamoLedger } from "../src/manage/ledger.mjs";

test("the DynamoDB feedback queue reads its whole partition across pages without an empty sort key", async (t) => {
  const cursor = {
    pk: "feedback#first",
    gsi1pk: "feedback#queue",
    gsi1sk: "2026-09-12#first",
  };
  const calls = [];
  t.mock.method(DynamoDBDocumentClient.prototype, "send", async (command) => {
    calls.push(command.input);
    assert.equal(command.constructor.name, "QueryCommand");
    assert.equal(command.input.IndexName, "ByClan");
    assert.deepEqual(command.input.ExpressionAttributeValues, {
      ":c": "feedback#queue",
    });
    assert.equal(command.input.KeyConditionExpression, "gsi1pk = :c");
    if (calls.length === 1) return { Items: [], LastEvaluatedKey: cursor };
    assert.deepEqual(command.input.ExclusiveStartKey, cursor);
    return {
      Items: [
        {
          pk: "feedback#last",
          gsi1pk: "feedback#queue",
          gsi1sk: "2026-09-13#last",
          feedback_id: "last",
          status: "new",
        },
      ],
    };
  });
  const ledger = createDynamoLedger({
    tableName: "clan-test",
    region: "us-east-1",
  });
  assert.deepEqual(await ledger.feedback(), [
    { feedback_id: "last", status: "new" },
  ]);
  assert.equal(calls.length, 2);
});

test("DynamoDB clan lists retain their sort-key prefix", async (t) => {
  t.mock.method(DynamoDBDocumentClient.prototype, "send", async (command) => {
    assert.equal(
      command.input.KeyConditionExpression,
      "gsi1pk = :c and begins_with(gsi1sk, :p)",
    );
    assert.deepEqual(command.input.ExpressionAttributeValues, {
      ":c": "clan##TEST",
      ":p": "card#",
    });
    return { Items: [] };
  });
  const ledger = createDynamoLedger({
    tableName: "clan-test",
    region: "us-east-1",
  });
  assert.deepEqual(await ledger.cards("#TEST"), []);
});

test("DynamoDB clan cleanup queries only the named partition without an empty sort key", async (t) => {
  const deleted = [];
  t.mock.method(DynamoDBDocumentClient.prototype, "send", async (command) => {
    if (command.constructor.name === "QueryCommand") {
      assert.equal(command.input.KeyConditionExpression, "gsi1pk = :c");
      assert.deepEqual(command.input.ExpressionAttributeValues, {
        ":c": "clan##TEST",
      });
      return { Items: [{ pk: "hold##TEST#member" }] };
    }
    assert.equal(command.constructor.name, "DeleteCommand");
    deleted.push(command.input.Key.pk);
    return {};
  });
  const ledger = createDynamoLedger({
    tableName: "clan-test",
    region: "us-east-1",
  });
  assert.equal(await ledger.deleteClan("#TEST"), 1);
  assert.deepEqual(deleted, [
    "hold##TEST#member",
    "policy##TEST",
    "awards##TEST",
    "recruit##TEST",
  ]);
});
