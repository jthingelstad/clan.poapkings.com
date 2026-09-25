/**
 * The clan ledger: everything Elixir Clan stores ABOUT a clan, all of it
 * items of one clan in the one table, listed through the ByClan index.
 *
 *   clan_size#<clan>         the member count at the latest roster or
 *                            participation read, and when (the policy
 *                            gate: nothing runs below MIN_MEMBERS)
 *   policy#<clan>            the pointer: { version }
 *   policy#<clan>#v<n>       one immutable version: values, who, when
 *   verdicts#<clan>          the latest verdict snapshot (small; evidence
 *                            summaries, never Elixir payloads)
 *   card#<clan>#<id>         an action (a "card" in code): member, type,
 *                            audience, status, frozen evidence, decision,
 *                            outcome (kept: this ledger is how a leave is
 *                            told from a kick)
 *   action_log#<clan>#<card id>#<entry id>
 *                            one entry in an action's log: raised (with
 *                            what raised it), withdrawn, completed,
 *                            declined, outcome, or a person's comment
 *   hold#<clan>#<tag>        a member on hold: until (or null), who, note
 *   note#<clan>#<id>         a note on a member: tier (leader | elder),
 *                            author, text, when
 *   recruit#<clan>           the pointer: { version }
 *   recruit#<clan>#v<n>      one immutable pitch: the clan's own recruiting words
 *   recruit_facts#<clan>     the last live read of the clan (facts only,
 *                            no member list), a few hours
 *   model_key#<clan>         the clan's own Anthropic key, SEALED (see
 *                            manage/model.mjs), who added it, the model;
 *                            outside the ByClan index on purpose, so no
 *                            listing of a clan's items ever carries it
 *   sharing#<clan>           what the clan shares with Elixir: one switch
 *                            per attested fact type (door 3), who set them
 *   model_call#<clan>#<at>#<id>
 *                            one use of the clan's model: who, what for,
 *                            the model, the tokens; 90 days (TTL)
 *   awards#<clan>            the pointer: { version }
 *   awards#<clan>#v<n>       one immutable awards document: the clan's
 *                            awards (kind, name, parameters)
 *   award#<clan>#<season>#<award id>#<tag>
 *                            a grant: rank, metric, note, who; computed
 *                            grants are facts of the record, manual ones
 *                            a leader's (kept: this is the trophy case)
 *
 * And one kind that belongs to no clan (2026-09-12):
 *
 *   feedback#<id>            what a person told the maintainer and what was
 *                            done about it, in ONE partition (feedback#queue)
 *                            because the whole queue is small and a person's
 *                            own list is a filter over it
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
import { timedStore } from "../trace.mjs";

const clanKey = (tag) => `clan#${tag}`;
const FEEDBACK_PARTITION = "feedback#queue";
export const newId = () => randomBytes(9).toString("base64url");
const pad = (n) => String(n).padStart(6, "0");
let logSeq = 0;

export function createDynamoLedger({ tableName, region }) {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const doc = {
    send: (command) =>
      timedStore(
        `${command.constructor.name.replace("Command", "")} ${String(command.input?.Key?.pk ?? command.input?.Item?.pk ?? command.input?.ExpressionAttributeValues?.[":p"] ?? "").split("#")[0] || "query"}`,
        () => client.send(command),
      ),
  };
  async function put(item) {
    await doc.send(new PutCommand({ TableName: tableName, Item: item }));
  }
  async function get(pk) {
    const { Item } = await doc.send(
      new GetCommand({ TableName: tableName, Key: { pk } }),
    );
    return Item ?? null;
  }
  async function listByPartition(partition, prefix) {
    const items = [];
    let key;
    do {
      const page = await doc.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: "ByClan",
          // DynamoDB forbids an empty string for an index key. An empty
          // prefix means the whole partition, not an empty sort-key value.
          KeyConditionExpression: prefix
            ? "gsi1pk = :c and begins_with(gsi1sk, :p)"
            : "gsi1pk = :c",
          ExpressionAttributeValues: prefix
            ? { ":c": partition, ":p": prefix }
            : { ":c": partition },
          ExclusiveStartKey: key,
        }),
      );
      items.push(...(page.Items ?? []));
      key = page.LastEvaluatedKey;
    } while (key);
    return items;
  }
  const listByPrefix = (clanTag, prefix) =>
    listByPartition(clanKey(clanTag), prefix);
  return ledgerOver({
    put,
    get,
    listByPrefix,
    listByPartition,
    doc,
    tableName,
  });
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
    async listByPartition(partition, prefix) {
      return [...items.values()]
        .filter(
          (i) => i.gsi1pk === partition && String(i.gsi1sk).startsWith(prefix),
        )
        .sort((a, b) => (a.gsi1sk < b.gsi1sk ? -1 : 1));
    },
    async listByPrefix(clanTag, prefix) {
      return this.listByPartition(clanKey(clanTag), prefix);
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
    async savePolicy(clanTag, { values, by, by_name = null, note = null }) {
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
        saved_by_name: by_name,
        saved_at,
        note,
      };
      await io.put(item);
      await io.put({ pk: `policy#${clanTag}`, version, saved_at });
      return stripKeys(item);
    },
    // ---- the clan's size: one number, from the latest roster or
    // participation read, so the policy gate needs no Elixir read ------
    async clanSize(clanTag) {
      const item = await io.get(`clan_size#${clanTag}`);
      return item
        ? { members: item.members, observed_at: item.observed_at }
        : null;
    },
    async saveClanSize(clanTag, { members, observed_at }) {
      await io.put({
        pk: `clan_size#${clanTag}`,
        gsi1pk: clanKey(clanTag),
        gsi1sk: "clan_size",
        members,
        observed_at,
      });
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
    // ---- action logs: append-only, one item per entry, so two people
    // writing at once never overwrite each other ------------------------
    async actionLog(clanTag, cardId) {
      return (await io.listByPrefix(clanTag, `action_log#${cardId}#`)).map(
        stripKeys,
      );
    },
    async actionLogs(clanTag) {
      return (await io.listByPrefix(clanTag, "action_log#")).map(stripKeys);
    },
    async appendActionLog(clanTag, entry) {
      const entry_id = entry.entry_id ?? newId();
      // Entries written in the same millisecond keep the order they were
      // written in: `seq` breaks the tie.
      const seq = String((logSeq = (logSeq + 1) % 1e9)).padStart(9, "0");
      const item = { ...entry, entry_id, seq };
      await io.put({
        pk: `action_log#${clanTag}#${entry.card_id}#${entry_id}`,
        gsi1pk: clanKey(clanTag),
        gsi1sk: `action_log#${entry.card_id}#${entry.at}#${seq}#${entry_id}`,
        ...item,
      });
      return item;
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
    // ---- awards: the document, versioned like policy ------------------
    async currentAwards(clanTag) {
      const pointer = await io.get(`awards#${clanTag}`);
      if (!pointer?.version) return null;
      return io.get(`awards#${clanTag}#v${pointer.version}`);
    },
    async awardsVersions(clanTag) {
      return (await io.listByPrefix(clanTag, "awards#v")).map(stripKeys);
    },
    async saveAwards(clanTag, { values, by, by_name = null, note = null }) {
      const versions = await io.listByPrefix(clanTag, "awards#v");
      const version = versions.length + 1;
      const saved_at = new Date().toISOString();
      const item = {
        pk: `awards#${clanTag}#v${version}`,
        gsi1pk: clanKey(clanTag),
        gsi1sk: `awards#v${pad(version)}`,
        clan_tag: clanTag,
        version,
        values,
        saved_by: by,
        saved_by_name: by_name,
        saved_at,
        note,
      };
      await io.put(item);
      await io.put({ pk: `awards#${clanTag}`, version, saved_at });
      return stripKeys(item);
    },
    async latestAwardsSnapshot(clanTag) {
      const item = await io.get(`awards_snapshot#${clanTag}`);
      return item ? item.snapshot : null;
    },
    async saveAwardsSnapshot(clanTag, snapshot) {
      await io.put({
        pk: `awards_snapshot#${clanTag}`,
        gsi1pk: clanKey(clanTag),
        gsi1sk: "awards_snapshot#latest",
        snapshot,
      });
    },
    // ---- grants ----------------------------------------------------------
    async grants(clanTag) {
      return (await io.listByPrefix(clanTag, "award#")).map(stripKeys);
    },
    async putGrant(clanTag, grant) {
      await io.put({
        pk: `award#${clanTag}#${grant.season_id}#${grant.award_id}#${grant.player_tag}`,
        gsi1pk: clanKey(clanTag),
        gsi1sk: `award#${pad(grant.season_id)}#${grant.award_id}#${pad(grant.rank ?? 1)}#${grant.player_tag}`,
        ...grant,
      });
      return grant;
    },
    async removeGrant(clanTag, { season_id, award_id, player_tag }) {
      await remove(`award#${clanTag}#${season_id}#${award_id}#${player_tag}`);
    },
    // ---- recruiting: the pitch, versioned; the last live facts --------
    async currentPitch(clanTag) {
      const pointer = await io.get(`recruit#${clanTag}`);
      if (!pointer?.version) return null;
      return io.get(`recruit#${clanTag}#v${pointer.version}`);
    },
    async pitchVersions(clanTag) {
      return (await io.listByPrefix(clanTag, "recruit#v")).map(stripKeys);
    },
    async savePitch(clanTag, { values, by, by_name = null, note = null }) {
      const versions = await io.listByPrefix(clanTag, "recruit#v");
      const version = versions.length + 1;
      const saved_at = new Date().toISOString();
      const item = {
        pk: `recruit#${clanTag}#v${version}`,
        gsi1pk: clanKey(clanTag),
        gsi1sk: `recruit#v${pad(version)}`,
        clan_tag: clanTag,
        version,
        values,
        saved_by: by,
        saved_by_name: by_name,
        saved_at,
        note,
      };
      await io.put(item);
      await io.put({ pk: `recruit#${clanTag}`, version, saved_at });
      return stripKeys(item);
    },
    async recruitFacts(clanTag) {
      const item = await io.get(`recruit_facts#${clanTag}`);
      return item ? stripKeys(item) : null;
    },
    async saveRecruitFacts(clanTag, facts) {
      await io.put({
        pk: `recruit_facts#${clanTag}`,
        gsi1pk: clanKey(clanTag),
        gsi1sk: "recruit_facts#latest",
        ...facts,
      });
    },
    // ---- what the clan shares with Elixir ------------------------------
    async sharing(clanTag) {
      const item = await io.get(`sharing#${clanTag}`);
      return item ? stripKeys(item) : null;
    },
    async saveSharing(clanTag, item) {
      await io.put({
        ...item,
        pk: `sharing#${clanTag}`,
        gsi1pk: clanKey(clanTag),
        gsi1sk: "sharing#latest",
      });
    },
    // ---- the clan's own model ------------------------------------------
    async modelKey(clanTag) {
      const item = await io.get(`model_key#${clanTag}`);
      return item ? stripKeys(item) : null;
    },
    async saveModelKey(clanTag, item) {
      // No gsi1pk: the sealed key is never in a listing of the clan.
      await io.put({ ...item, pk: `model_key#${clanTag}` });
    },
    async removeModelKey(clanTag) {
      await remove(`model_key#${clanTag}`);
    },
    async modelCalls(clanTag, prefix = "") {
      return (await io.listByPrefix(clanTag, `model_call#${prefix}`)).map(
        stripKeys,
      );
    },
    async addModelCall(clanTag, call) {
      const id = newId();
      await io.put({
        pk: `model_call#${clanTag}#${call.at}#${id}`,
        gsi1pk: clanKey(clanTag),
        gsi1sk: `model_call#${call.at}#${id}`,
        ...call,
      });
    },
    // ---- feedback: one partition, the queue ---------------------------
    async feedback() {
      return (await io.listByPartition(FEEDBACK_PARTITION, "")).map(stripKeys);
    },
    async feedbackItem(feedbackId) {
      const item = await io.get(`feedback#${feedbackId}`);
      return item ? stripKeys(item) : null;
    },
    async putFeedback(item) {
      await io.put({
        pk: `feedback#${item.feedback_id}`,
        gsi1pk: FEEDBACK_PARTITION,
        gsi1sk: `${item.created_at}#${item.feedback_id}`,
        ...item,
      });
      return item;
    },
    // ---- the whole clan ------------------------------------------------
    async deleteClan(clanTag) {
      const all = await io.listByPrefix(clanTag, "");
      for (const item of all) await remove(item.pk);
      await remove(`policy#${clanTag}`);
      await remove(`awards#${clanTag}`);
      await remove(`recruit#${clanTag}`);
      await remove(`model_key#${clanTag}`);
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
