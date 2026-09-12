/**
 * The clan ledger: everything Elixir Clan stores ABOUT a clan, all of it
 * items of one clan in the one table, listed through the ByClan index.
 *
 *   policy#<clan>            the pointer: { version }
 *   policy#<clan>#v<n>       one immutable version: values, who, when
 *   verdicts#<clan>          the latest verdict snapshot (small; evidence
 *                            summaries, never Elixir payloads)
 *   card#<clan>#<id>         a card: member, type, status, frozen evidence,
 *                            decision, outcome (kept: this ledger is how a
 *                            leave is told from a kick)
 *   hold#<clan>#<tag>        a member on hold: until (or null), who, note
 *   note#<clan>#<id>         a note on a member: tier (leader | elder),
 *                            author, text, when
 *
 * Deleted as a set when a clan's last verified leader disconnects
 * (deleteClan). Retention: cards and notes are kept; the verdict snapshot
 * is overwritten each evaluation.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomBytes } from "node:crypto";

const clanKey = (tag) => `clan#${tag}`;
export const newId = () => randomBytes(9).toString("base64url");
const pad = (n) => String(n).padStart(6, "0");

export function createDynamoLedger({ tableName, region }) {
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  async function put(item) {
    await doc.send(new PutCommand({ TableName: tableName, Item: item }));
  }
  async function get(pk) {
    const { Item } = await doc.send(
      new GetCommand({ TableName: tableName, Key: { pk } }),
    );
    return Item ?? null;
  }
  async function listByPrefix(clanTag, prefix) {
    const items = [];
    let key;
    do {
      const page = await doc.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: "ByClan",
          KeyConditionExpression: "gsi1pk = :c and begins_with(gsi1sk, :p)",
          ExpressionAttributeValues: { ":c": clanKey(clanTag), ":p": prefix },
          ExclusiveStartKey: key,
        }),
      );
      items.push(...(page.Items ?? []));
      key = page.LastEvaluatedKey;
    } while (key);
    return items;
  }
  return ledgerOver({ put, get, listByPrefix, doc, tableName });
}

/** The same contract in memory, for tests. */
export function createMemoryLedger() {
  const items = new Map();
  const api = ledgerOver({
    async put(item) {
      items.set(item.pk, { ...item });
    },
    async get(pk) {
      return items.get(pk) ?? null;
    },
    async listByPrefix(clanTag, prefix) {
      return [...items.values()]
        .filter(
          (i) =>
            i.gsi1pk === clanKey(clanTag) &&
            String(i.gsi1sk).startsWith(prefix),
        )
        .sort((a, b) => (a.gsi1sk < b.gsi1sk ? -1 : 1));
    },
    async remove(pk) {
      items.delete(pk);
    },
  });
  api.items = items;
  return api;
}

function ledgerOver(io) {
  const remove =
    io.remove ??
    (async (pk) => {
      await io.doc.send(
        new DeleteCommand({ TableName: io.tableName, Key: { pk } }),
      );
    });
  return {
    // ---- policy --------------------------------------------------------
    async currentPolicy(clanTag) {
      const pointer = await io.get(`policy#${clanTag}`);
      if (!pointer?.version) return null;
      return io.get(`policy#${clanTag}#v${pointer.version}`);
    },
    async policyVersions(clanTag) {
      return (await io.listByPrefix(clanTag, "policy#v")).map(stripKeys);
    },
    async savePolicy(clanTag, { values, by, note = null }) {
      const versions = await io.listByPrefix(clanTag, "policy#v");
      const version = versions.length + 1;
      const saved_at = new Date().toISOString();
      const item = {
        pk: `policy#${clanTag}#v${version}`,
        gsi1pk: clanKey(clanTag),
        gsi1sk: `policy#v${pad(version)}`,
        clan_tag: clanTag,
        version,
        values,
        saved_by: by,
        saved_at,
        note,
      };
      await io.put(item);
      await io.put({ pk: `policy#${clanTag}`, version, saved_at });
      return stripKeys(item);
    },
    // ---- verdicts ------------------------------------------------------
    async latestVerdicts(clanTag) {
      const item = await io.get(`verdicts#${clanTag}`);
      return item ? item.snapshot : null;
    },
    async saveVerdicts(clanTag, snapshot) {
      await io.put({
        pk: `verdicts#${clanTag}`,
        gsi1pk: clanKey(clanTag),
        gsi1sk: "verdicts#latest",
        snapshot,
      });
    },
    // ---- cards ---------------------------------------------------------
    async cards(clanTag) {
      return (await io.listByPrefix(clanTag, "card#")).map(stripKeys);
    },
    async card(clanTag, cardId) {
      const item = await io.get(`card#${clanTag}#${cardId}`);
      return item ? stripKeys(item) : null;
    },
    async putCard(clanTag, card) {
      await io.put({
        pk: `card#${clanTag}#${card.card_id}`,
        gsi1pk: clanKey(clanTag),
        gsi1sk: `card#${card.raised_at}#${card.card_id}`,
        ...card,
      });
      return card;
    },
    // ---- holds ---------------------------------------------------------
    async holds(clanTag) {
      return (await io.listByPrefix(clanTag, "hold#")).map(stripKeys);
    },
    async putHold(clanTag, hold) {
      await io.put({
        pk: `hold#${clanTag}#${hold.player_tag}`,
        gsi1pk: clanKey(clanTag),
        gsi1sk: `hold#${hold.player_tag}`,
        ...hold,
      });
      return hold;
    },
    async removeHold(clanTag, playerTag) {
      await remove(`hold#${clanTag}#${playerTag}`);
    },
    // ---- notes ---------------------------------------------------------
    async notes(clanTag, playerTag = null) {
      const prefix = playerTag ? `note#${playerTag}#` : "note#";
      return (await io.listByPrefix(clanTag, prefix)).map(stripKeys);
    },
    async putNote(clanTag, note) {
      await io.put({
        pk: `note#${clanTag}#${note.note_id}`,
        gsi1pk: clanKey(clanTag),
        gsi1sk: `note#${note.player_tag}#${note.created_at}#${note.note_id}`,
        ...note,
      });
      return note;
    },
    async removeNote(clanTag, noteId) {
      await remove(`note#${clanTag}#${noteId}`);
    },
    // ---- the whole clan ------------------------------------------------
    async deleteClan(clanTag) {
      const all = await io.listByPrefix(clanTag, "");
      for (const item of all) await remove(item.pk);
      await remove(`policy#${clanTag}`);
      return all.length;
    },
  };
}

function stripKeys(item) {
  const rest = { ...item };
  delete rest.pk;
  delete rest.gsi1pk;
  delete rest.gsi1sk;
  return rest;
}
