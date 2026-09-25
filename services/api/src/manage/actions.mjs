/**
 * The action store: raising, withdrawing and shaping actions, and each
 * action's append-only log, shared by the manage and awards services so
 * every action anywhere is raised, logged and read the same way. Ledger
 * and clock are the caller's.
 */

import {
  ACTION_TYPES,
  SYSTEM,
  audienceOf,
  canAct,
  inGameCopy,
  leaderMessage,
  logEntry,
  priorActions,
  reconstructedLog,
} from "@elixir-clan/engine";

export function createActionStore({ ledger, now = () => Date.now() }) {
  const person = (who) => ({
    tag: who.player_tag,
    name: who.name ?? null,
    role: who.role,
  });

  /** Append one entry to an action's log. */
  const logAction = (
    clanTag,
    card_id,
    kind,
    { by = SYSTEM, text = null, detail = null } = {},
  ) =>
    ledger.appendActionLog(clanTag, {
      card_id,
      ...logEntry(kind, {
        at: new Date(now()).toISOString(),
        by,
        text,
        detail,
      }),
    });

  /** Raise an action, logging what raised it and the member's earlier
   *  actions of the same kind. */
  async function raiseAction(clanTag, card, cards, { text, detail = {} }) {
    // Older actions get their numbers first, so the count reads in order.
    await numberActions(clanTag, cards);
    const action = {
      ...card,
      number: await ledger.nextActionNumber(clanTag),
      audience: audienceOf(card),
    };
    await ledger.putCard(clanTag, action);
    await logAction(clanTag, action.card_id, "raised", {
      text,
      detail: {
        policy_version: action.policy_version ?? null,
        ...detail,
        prior: priorActions(cards, {
          player_tag: action.player_tag,
          type: action.type,
          before: action.raised_at,
        }),
      },
    });
    return action;
  }

  /** Give every action without a number one, oldest first (the actions
   *  raised before numbers existed, once). */
  async function numberActions(clanTag, cards = null) {
    const list = (cards ?? (await ledger.cards(clanTag)))
      .filter((c) => !Number.isInteger(c.number))
      .sort((a, b) => (a.raised_at < b.raised_at ? -1 : 1));
    for (const c of list) {
      const n = await ledger.nextActionNumber(clanTag);
      if (await ledger.numberCard(clanTag, c.card_id, n)) c.number = n;
      // Another request numbered it first: its number is the one.
      else c.number = (await ledger.card(clanTag, c.card_id))?.number;
    }
  }

  /** Withdraw an open action, saying why. */
  async function withdrawAction(clanTag, card, reason) {
    await ledger.putCard(clanTag, {
      ...card,
      status: "withdrawn",
      withdrawn_at: new Date(now()).toISOString(),
      withdraw_reason: reason,
    });
    await logAction(clanTag, card.card_id, "withdrawn", { text: reason });
  }

  /** An action's log: the stored entries, with what an action raised
   *  before logs were kept reconstructed from its own fields. */
  function logOf(card, stored) {
    const order = (a, b) =>
      a.at < b.at
        ? -1
        : a.at > b.at
          ? 1
          : String(a.seq ?? "").localeCompare(String(b.seq ?? ""));
    const entries = [...(stored ?? [])].sort(order);
    if (entries.some((e) => e.kind === "raised")) return entries;
    const have = new Set(entries.map((e) => e.kind));
    return [
      ...reconstructedLog(card).filter((e) => !have.has(e.kind)),
      ...entries,
    ].sort(order);
  }

  /** The words an action carries into the game: a clan chat line, or a
   *  Clan Leader Message (title and message) for leaders to send. */
  function wordsFor(c) {
    const channel = ACTION_TYPES[c.type]?.channel ?? null;
    if (channel === "clan_chat")
      return {
        channel,
        copy:
          c.type === "welcome"
            ? inGameCopy("welcome", { name: c.player_name })
            : inGameCopy(c.type, {
                name: c.player_name,
                days_idle: c.evidence?.days_idle ?? null,
                phrase: c.evidence?.phrase ?? "",
              }),
        message: null,
      };
    if (channel === "leader_message")
      return {
        channel,
        copy: null,
        message:
          c.evidence?.message ??
          leaderMessage(c.type, {
            name: c.player_name,
            phrase: c.evidence?.phrase ?? "",
          }),
      };
    return { channel: null, copy: null, message: null };
  }

  /** An action as a person reads it, with its words and its log. */
  const shapeAction = (c, stored, who) => ({
    ...c,
    audience: audienceOf(c),
    label: ACTION_TYPES[c.type]?.label ?? c.type,
    ...wordsFor(c),
    can_act: c.status === "proposed" && (!who || canAct(c, who)),
    log: logOf(c, stored),
  });

  const logsByCard = async (clanTag) => {
    const byCard = new Map();
    for (const e of await ledger.actionLogs(clanTag)) {
      const list = byCard.get(e.card_id) ?? [];
      list.push(e);
      byCard.set(e.card_id, list);
    }
    return byCard;
  };

  return {
    person,
    logAction,
    raiseAction,
    withdrawAction,
    numberActions,
    logOf,
    shapeAction,
    logsByCard,
  };
}
