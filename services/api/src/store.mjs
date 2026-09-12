/**
 * The one table. Two item kinds, both short-lived by TTL:
 *
 *   login#<state>    the pending sign-in: PKCE verifier + redirect URI,
 *                    10 minutes, deleted on use
 *   session#<id>     the signed-in person: Elixir's token pair, when the
 *                    grant family ends, the last gate answer and a short
 *                    roster cache; expires with the grant (90 days)
 *
 *   pref#<tag>       the one remembered thing (decision 2026-09-12): which
 *                    clan this person last chose to work in, keyed by their
 *                    primary tag. No TTL. One small string.
 *
 * This is everything Elixir Clan stores. No player, no clan, no member
 * data survives past a session's cache window; the record lives in
 * Elixir. The table is encrypted with its KMS key (infra/template.yaml)
 * because a session item holds a refresh token.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

export const LOGIN_TTL_S = 600;

const seconds = (ms) => Math.floor(ms / 1000);

export function createDynamoStore({ tableName, region }) {
  if (!tableName) throw new Error("store needs a table name");
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  });

  return {
    async putLogin(state, login, nowMs) {
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            pk: `login#${state}`,
            ...login,
            ttl: seconds(nowMs) + LOGIN_TTL_S,
          },
        }),
      );
    },
    /** Read-and-delete: a login state is single use. */
    async takeLogin(state) {
      const { Attributes } = await doc.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { pk: `login#${state}` },
          ReturnValues: "ALL_OLD",
        }),
      );
      return Attributes ?? null;
    },
    async putSession(id, session) {
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: { pk: `session#${id}`, ...session },
        }),
      );
    },
    async getSession(id) {
      const { Item } = await doc.send(
        new GetCommand({ TableName: tableName, Key: { pk: `session#${id}` } }),
      );
      return Item ?? null;
    },
    /** Partial update: only the named attributes move. */
    async updateSession(id, patch) {
      const names = {};
      const values = {};
      const sets = [];
      for (const [key, value] of Object.entries(patch)) {
        names[`#${key}`] = key;
        values[`:${key}`] = value;
        sets.push(`#${key} = :${key}`);
      }
      await doc.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { pk: `session#${id}` },
          UpdateExpression: `SET ${sets.join(", ")}`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        }),
      );
    },
    async deleteSession(id) {
      await doc.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { pk: `session#${id}` },
        }),
      );
    },
    async getPreference(tag) {
      const { Item } = await doc.send(
        new GetCommand({ TableName: tableName, Key: { pk: `pref#${tag}` } }),
      );
      return Item ?? null;
    },
    async putPreference(tag, pref) {
      await doc.send(
        new PutCommand({
          TableName: tableName,
          Item: { pk: `pref#${tag}`, ...pref },
        }),
      );
    },
  };
}

/** The same contract in memory, for tests and for a local run without AWS. */
export function createMemoryStore() {
  const items = new Map();
  return {
    items,
    async putLogin(state, login, nowMs) {
      items.set(`login#${state}`, {
        ...login,
        ttl: seconds(nowMs) + LOGIN_TTL_S,
      });
    },
    async takeLogin(state) {
      const key = `login#${state}`;
      const item = items.get(key) ?? null;
      items.delete(key);
      return item;
    },
    async putSession(id, session) {
      items.set(`session#${id}`, { ...session });
    },
    async getSession(id) {
      return items.get(`session#${id}`) ?? null;
    },
    async updateSession(id, patch) {
      const key = `session#${id}`;
      if (!items.has(key)) return;
      items.set(key, { ...items.get(key), ...patch });
    },
    async deleteSession(id) {
      items.delete(`session#${id}`);
    },
    async getPreference(tag) {
      return items.get(`pref#${tag}`) ?? null;
    },
    async putPreference(tag, pref) {
      items.set(`pref#${tag}`, { ...pref });
    },
  };
}
