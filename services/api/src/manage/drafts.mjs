/**
 * A Clan Leader Message drafted by the clan's own model (2026-09-25, the
 * clan's model's second use): for an open action that ends in a Leader
 * Message (a promotion, a demotion, the season's awards, how the clan
 * runs), a leader asks the model to write it in the clan's voice. The
 * request carries the clan's facts and its own words, never a member's
 * name (`leaderMessageRequest`); the answer is made safe for the game
 * (`leaderMessageFromDraft`) and handed to the leader to edit and send.
 * Nothing is saved or sent by itself; the action's log says it was drafted.
 */

import {
  ACTION_TYPES,
  declaredGoals,
  leaderMessageFromDraft,
  leaderMessageRequest,
} from "@elixir-clan/engine";
import { ManageError } from "./service.mjs";
import { createActionStore } from "./actions.mjs";

const LEADERS = new Set(["leader", "coLeader"]);
const KIND = {
  promotion: "promotion",
  demotion: "demotion",
  awards_announcement: "awards",
  rules_announcement: "rules",
};

export function createDrafts({ ledger, model, now = () => Date.now() }) {
  const { logAction, person } = createActionStore({ ledger, now });
  return {
    async leaderMessage(
      clanTag,
      who,
      token,
      cardId,
      { note = null, clanName = null } = {},
    ) {
      if (!LEADERS.has(who.role)) throw new ManageError(403, "leaders_only");
      if (!model) throw new ManageError(404, "not_found");
      const card = await ledger.card(clanTag, cardId);
      if (!card) throw new ManageError(404, "no_action");
      if (card.status !== "proposed")
        throw new ManageError(409, "action_closed");
      const kind = KIND[card.type];
      if (!kind || ACTION_TYPES[card.type]?.channel !== "leader_message")
        throw new ManageError(400, "no_leader_message");
      const [policy, pitch] = await Promise.all([
        ledger.currentPolicy(clanTag),
        ledger.currentPitch(clanTag),
      ]);
      const ev = card.evidence ?? {};
      const request = leaderMessageRequest({
        kind,
        clanName,
        voice: pitch?.values ?? null,
        goals: policy ? declaredGoals(policy.values) : [],
        changes: ev.changes ?? [],
        first: kind === "rules" && ev.version === 1,
        seasonId: ev.season_id ?? null,
        awardCount: (ev.awards ?? []).length,
        // The template the action carries, with the name taken out again.
        current: ev.message
          ? {
              title: ev.message.title,
              body: card.player_name
                ? String(ev.message.body ?? "").replaceAll(
                    card.player_name,
                    "{name}",
                  )
                : ev.message.body,
            }
          : null,
        note,
      });
      const answer = await model.write(clanTag, who, token, request);
      const draft = leaderMessageFromDraft(answer.input, {
        kind,
        name: card.player_name ?? null,
        awards: ev.awards ?? [],
      });
      await logAction(clanTag, card.card_id, "drafted", {
        by: person(who),
        text: `Drafted a Leader Message in the clan's voice (${answer.model}).`,
      });
      return { ...draft, model: answer.model };
    },
  };
}
