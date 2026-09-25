/**
 * Actions: what Elixir Clan suggests a person in the clan do (Jamie,
 * 2026-09-25). An action is ASSIGNED to one member or AVAILABLE to a role
 * (any leader, any elder and up); the person completes it or declines it.
 * In code and storage an action is still a `card` (`card#<clan>#<id>`);
 * every word a person reads says "action".
 *
 * Every action keeps its own LOG: what raised it (the rule, the policy
 * version, the evidence, and any earlier actions for the same member and
 * type), who took it and how, whether the record confirmed it, and anyone's
 * comments along the way. The agent team reads the logs to improve the
 * rules. Pure: who, actions and events in; decisions out.
 */

import { LEADERSHIP } from "./standing.mjs";

const ELDER_PLUS = new Set(["elder", "coLeader", "leader"]);
const DAY_MS = 86400_000;

/** Every kind of action: its label and who may take it. */
export const ACTION_TYPES = {
  promotion: { label: "Promote to Elder", audience: "leaders" },
  demotion: { label: "Demote to Member", audience: "leaders" },
  removal: { label: "Remove from the clan", audience: "leaders" },
  departure: {
    label: "Departure: kicked, left, or ignore?",
    audience: "leaders",
  },
  welcome: { label: "Welcome a newcomer", audience: "elders" },
  away: { label: "Going to be away?", audience: "member" },
};

/** Who an action is for: stored on newer actions; derived for older ones. */
export function audienceOf(action) {
  if (action.audience) return action.audience;
  const kind = ACTION_TYPES[action.type]?.audience ?? "leaders";
  return kind === "member" ? { kind, player_tag: action.player_tag } : { kind };
}

/** Whether this person may take the action (and so see it). */
export function canAct(action, who) {
  const a = audienceOf(action);
  if (a.kind === "member") return who.player_tag === a.player_tag;
  if (a.kind === "elders") return ELDER_PLUS.has(who.role);
  return LEADERSHIP.has(who.role);
}

/** An entry in an action's log. `by` is a person ({ tag, name, role }) or
 *  `{ system: "elixir-clan" }`. */
export function logEntry(kind, { at, by, text = null, detail = null }) {
  return { kind, at, by, text, detail };
}

export const SYSTEM = { system: "elixir-clan" };

/**
 * The log of an action written before logs were kept (2026-09-25): what
 * its own fields say, in order, marked reconstructed.
 */
export function reconstructedLog(card) {
  const entries = [];
  const detail = { reconstructed: true };
  if (card.raised_at)
    entries.push(
      logEntry("raised", {
        at: card.raised_at,
        by: SYSTEM,
        text:
          card.evidence?.rationale?.headline ??
          (card.type === "departure"
            ? "A departure no action explained."
            : null),
        detail: { ...detail, policy_version: card.policy_version ?? null },
      }),
    );
  if (card.status === "withdrawn")
    entries.push(
      logEntry("withdrawn", {
        at: card.withdrawn_at ?? card.raised_at,
        by: SYSTEM,
        text: card.withdraw_reason ?? null,
        detail,
      }),
    );
  if (card.status === "done" || card.status === "declined")
    entries.push(
      logEntry(card.status === "done" ? "completed" : "declined", {
        at: card.decided_at,
        by: {
          tag: card.decided_by ?? null,
          name: card.decided_by_name ?? null,
          role: null,
        },
        text: card.decision_note ?? null,
        detail: {
          ...detail,
          reason: card.decline_reason ?? null,
          classification: card.outcome?.classification ?? null,
        },
      }),
    );
  if (card.outcome?.verified_at && card.type !== "departure")
    entries.push(
      logEntry("outcome_verified", {
        at: card.outcome.verified_at,
        by: SYSTEM,
        text: `The record shows it: ${card.outcome.classification}.`,
        detail,
      }),
    );
  if (card.outcome?.flagged_at)
    entries.push(
      logEntry("outcome_flagged", {
        at: card.outcome.flagged_at,
        by: SYSTEM,
        text: card.outcome.note ?? null,
        detail,
      }),
    );
  return entries;
}

/** Earlier actions of the same type for the same member, newest first:
 *  the history a new action is raised against. */
export function priorActions(cards, { player_tag, type, before }) {
  return cards
    .filter(
      (c) =>
        c.player_tag === player_tag &&
        c.type === type &&
        c.raised_at &&
        (!before || c.raised_at < before),
    )
    .sort((a, b) => (a.raised_at < b.raised_at ? 1 : -1))
    .slice(0, 5)
    .map((c) => ({
      card_id: c.card_id,
      raised_at: c.raised_at,
      status: c.status,
      closed_at: c.decided_at ?? c.withdrawn_at ?? null,
      reason:
        c.status === "withdrawn"
          ? (c.withdraw_reason ?? null)
          : (c.decline_reason ?? null),
    }));
}

/**
 * Newcomers to welcome: `member_joined` events inside the last `windowDays`
 * whose member is still on the roster and has no welcome action for that
 * join yet.
 */
export function welcomesFrom(
  events,
  cards,
  currentTags,
  now,
  { windowDays = 3 } = {},
) {
  const nowMs = now.getTime();
  return (events ?? [])
    .filter(
      (e) =>
        e.type === "member_joined" &&
        e.detail?.player_tag &&
        nowMs - Date.parse(e.at) <= windowDays * DAY_MS &&
        (!currentTags || currentTags.has(e.detail.player_tag)) &&
        !cards.some(
          (c) =>
            c.type === "welcome" &&
            c.player_tag === e.detail.player_tag &&
            Math.abs(Date.parse(c.evidence?.joined_at) - Date.parse(e.at)) <
              DAY_MS,
        ),
    )
    .map((e) => ({
      player_tag: e.detail.player_tag,
      player_name: e.detail.name ?? null,
      joined_at: e.at,
    }));
}

/**
 * Members to ask "going to be away?": a member or elder whose own
 * inactivity clock is at risk or past it, judged ready, and not already on
 * a hold. Leadership sets its own holds.
 */
export function awayCandidates(verdicts) {
  return verdicts.members.filter(
    (m) =>
      !LEADERSHIP.has(m.role) &&
      m.judgment.removal === "ready" &&
      (m.removal.state === "at_risk" || m.removal.state === "recommended") &&
      !m.hold?.active,
  );
}
