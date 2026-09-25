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
    "model_key##TEST",
    "schedule##TEST",
    "action_seq##TEST",
  ]);
});

test("DynamoDB action numbers: an atomic counter, and a number set only on an action that has none", async (t) => {
  const calls = [];
  t.mock.method(DynamoDBDocumentClient.prototype, "send", async (command) => {
    calls.push(command.input);
    assert.equal(command.constructor.name, "UpdateCommand");
    if (command.input.Key.pk.startsWith("action_seq#"))
      return { Attributes: { n: 38 } };
    if (command.input.ExpressionAttributeValues[":v"] === 2)
      throw Object.assign(new Error("taken"), {
        name: "ConditionalCheckFailedException",
      });
    return {};
  });
  const ledger = createDynamoLedger({
    tableName: "clan-test",
    region: "us-east-1",
  });
  assert.equal(await ledger.nextActionNumber("#TEST"), 38);
  assert.equal(calls[0].Key.pk, "action_seq##TEST");
  assert.equal(calls[0].UpdateExpression, "ADD #n :one");
  assert.equal(await ledger.numberCard("#TEST", "c1", 1), true);
  assert.equal(calls[1].Key.pk, "card##TEST#c1");
  assert.match(calls[1].ConditionExpression, /attribute_not_exists\(#a\)/);
  assert.match(calls[1].ConditionExpression, /attribute_exists\(pk\)/);
  assert.equal(calls[1].ExpressionAttributeNames["#a"], "number");
  assert.equal(await ledger.numberCard("#TEST", "c2", 2), false);
});
