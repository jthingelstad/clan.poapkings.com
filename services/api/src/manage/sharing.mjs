/**
 * Sharing with Elixir (door 3, 2026-09-25; Jamie): what the clan did goes
 * back to Elixir as ATTESTED FACTS, on the acting person's own grant
 * (JSON API 2.2.0, scope clans:attest). Elixir keeps them apart from the
 * game record, labelled as this person's word through Elixir Clan, and
 * shows each only to the readers its type allows: a departure (kick or
 * leave) to the clan and its agent since Elixir 9.3.0 (Jamie, 2026-09-25:
 * the game already shows the clan a kick, and leaders say why in clan
 * chat); an away only to the clan's leaders, never an agent.
 *
 * The clan chooses what leaves it: one switch per fact type in Clan
 * settings, every one off to start. A fact is shared when the action that
 * made it is completed (a departure answered, a promotion done, a welcome
 * said, an announcement sent) or when a member marks themselves away; it
 * is best effort, never holds up the action, and the action's log says
 * whether it was shared. Only facts cross, never a judgment: a removal's
 * chat line (it names an inactive member) is never shared as a message.
 */

import { leaderMessage } from "@elixir-clan/engine";
import { ManageError } from "./service.mjs";

/** What each switch shares, and who sees it in Elixir. */
export const SHARE_TYPES = {
  departure_classified: {
    label: "Kicks and leaves",
    why: "When a leader answers a departure (kicked or left), or completes a removal.",
    sees: "Everyone verified in the clan, and the clan's agent: the game already shows the clan who was kicked.",
  },
  role_change_made: {
    label: "Promotions and demotions",
    why: "When a leader completes a promotion or demotion.",
    sees: "Everyone verified in the clan.",
  },
  award_granted: {
    label: "The clan's awards",
    why: "When a leader sends the season's awards announcement: each winner.",
    sees: "Everyone verified in the clan.",
  },
  member_away: {
    label: "Members away",
    why: "When a member marks themselves away, until they come back.",
    sees: "The clan's leaders and co-leaders only.",
  },
  clan_message: {
    label: "Messages to the clan",
    why: "Clan Leader Messages sent with a promotion, a demotion or an announcement, and welcome lines in clan chat.",
    sees: "Everyone verified in the clan.",
  },
};

export const SHARE_KEYS = Object.keys(SHARE_TYPES);

const LEADERS = new Set(["leader", "coLeader"]);
const off = () => Object.fromEntries(SHARE_KEYS.map((k) => [k, false]));

/** The words the person actually sent, when they edited them; else the
 *  action's own. Bounded as the game bounds them. */
function sentMessage(card, sent) {
  const own =
    card.evidence?.message ??
    leaderMessage(card.type, {
      name: card.player_name,
      phrase: card.evidence?.phrase ?? "",
    });
  const title = String(sent?.title ?? own?.title ?? "").trim();
  const body = String(sent?.body ?? own?.body ?? "").trim();
  if (!body) return null;
  return { title: title.slice(0, 24) || undefined, body: body.slice(0, 200) };
}

/** The facts a completed action attests, before the clan's switches. */
export function factsOfAction(
  card,
  decided,
  { sent = null, grants = [] } = {},
) {
  const ref = `action:${card.card_id}`;
  const facts = [];
  const at = decided.decided_at;
  if (card.type === "departure") {
    const c = decided.outcome?.classification;
    if (c === "member_kicked" || c === "member_left")
      facts.push({
        type: "departure_classified",
        ref,
        player_tag: card.player_tag,
        occurred_at: at,
        detail: {
          kind: c === "member_kicked" ? "kick" : "leave",
          ...(card.evidence?.left_at ? { left_at: card.evidence.left_at } : {}),
        },
      });
    return facts;
  }
  if (decided.status !== "done") return facts;
  if (card.type === "removal")
    facts.push({
      type: "departure_classified",
      ref,
      player_tag: card.player_tag,
      occurred_at: at,
      detail: { kind: "kick" },
    });
  if (card.type === "promotion" || card.type === "demotion") {
    facts.push({
      type: "role_change_made",
      ref,
      player_tag: card.player_tag,
      occurred_at: at,
      detail:
        card.type === "promotion"
          ? { from: "member", to: "elder" }
          : { from: "elder", to: "member" },
    });
  }
  if (
    [
      "promotion",
      "demotion",
      "awards_announcement",
      "rules_announcement",
    ].includes(card.type)
  ) {
    const m = sentMessage(card, sent);
    if (m)
      facts.push({
        type: "clan_message",
        ref: `${ref}:message`,
        occurred_at: at,
        detail: { channel: "leader_message", ...m },
      });
  }
  if (card.type === "welcome" && sent?.line)
    facts.push({
      type: "clan_message",
      ref: `${ref}:message`,
      occurred_at: at,
      detail: {
        channel: "clan_chat",
        body: String(sent.line).trim().slice(0, 200),
      },
    });
  if (card.type === "awards_announcement")
    for (const g of grants.filter(
      (g) => g.season_id === card.evidence?.season_id,
    ))
      facts.push({
        type: "award_granted",
        ref: `award:${g.season_id}:${g.award_id}:${g.player_tag}`,
        player_tag: g.player_tag,
        occurred_at: g.granted_at ?? at,
        detail: {
          award: String(g.name ?? g.award_id).slice(0, 60),
          season_id: g.season_id,
          ...(Number.isInteger(g.rank) && !g.manual ? { place: g.rank } : {}),
        },
      });
  return facts;
}

export function createSharing({ ledger, mcp, logAction }) {
  async function settings(clanTag) {
    const saved = await ledger.sharing(clanTag);
    return { ...off(), ...(saved?.values ?? {}), _saved: saved ?? null };
  }

  /** Share what is switched on; each outcome goes into the action's log. */
  async function share(clanTag, token, who, facts, { cardId = null } = {}) {
    if (!facts.length || !token || typeof mcp.writeFact !== "function")
      return [];
    const on = await settings(clanTag);
    const out = [];
    for (const fact of facts) {
      if (!on[fact.type]) continue;
      const r = await mcp.writeFact(token, clanTag, fact);
      const entry = r.ok
        ? {
            text: `Shared with Elixir: ${SHARE_TYPES[fact.type].label.toLowerCase()}.`,
            detail: {
              fact_type: fact.type,
              ref: fact.ref,
              visibility: r.body?.visibility ?? null,
            },
          }
        : {
            text:
              r.code === "insufficient_scope"
                ? "Not shared with Elixir: this sign-in cannot share yet. Sign out and in again to allow it."
                : `Not shared with Elixir (${r.code ?? r.status ?? "no answer"}).`,
            detail: {
              fact_type: fact.type,
              ref: fact.ref,
              code: r.code ?? null,
            },
          };
      if (cardId)
        await logAction(clanTag, cardId, r.ok ? "shared" : "not_shared", {
          by: { tag: who.player_tag, name: who.name ?? null, role: who.role },
          ...entry,
        });
      out.push({ type: fact.type, ok: r.ok, code: r.code ?? null });
    }
    return out;
  }

  return {
    settings,

    /** The switches, for leaders: each type with what it shares and who
     *  sees it in Elixir. */
    async view(clanTag, who) {
      if (!LEADERS.has(who.role)) throw new ManageError(403, "leaders_only");
      const s = await settings(clanTag);
      return {
        clan_tag: clanTag,
        types: SHARE_TYPES,
        values: Object.fromEntries(SHARE_KEYS.map((k) => [k, s[k]])),
        saved_at: s._saved?.saved_at ?? null,
        saved_by_name: s._saved?.saved_by_name ?? null,
      };
    },

    async save(clanTag, who, values) {
      if (!LEADERS.has(who.role)) throw new ManageError(403, "leaders_only");
      const input = values && typeof values === "object" ? values : {};
      const bad = Object.keys(input).find(
        (k) => !SHARE_TYPES[k] || typeof input[k] !== "boolean",
      );
      if (bad) throw new ManageError(400, "bad_sharing");
      const next = { ...off(), ...input };
      await ledger.saveSharing(clanTag, {
        values: next,
        saved_at: new Date().toISOString(),
        saved_by: who.player_tag,
        saved_by_name: who.name ?? null,
      });
      return { values: next };
    },

    /** After a decision: the facts it attests, shared as switched on. */
    async afterDecision(
      clanTag,
      token,
      who,
      card,
      decided,
      { sent = null } = {},
    ) {
      const grants =
        card.type === "awards_announcement" ? await ledger.grants(clanTag) : [];
      return share(
        clanTag,
        token,
        who,
        factsOfAction(card, decided, { sent, grants }),
        { cardId: card.card_id },
      );
    },

    /** A member's own away, shared while it lasts; cleared, taken back. */
    async away(clanTag, token, who, hold, { cardId = null } = {}) {
      return share(
        clanTag,
        token,
        who,
        [
          {
            type: "member_away",
            ref: `away:${who.player_tag}`,
            player_tag: who.player_tag,
            occurred_at: hold.set_at,
            detail: { until: hold.until ?? null },
          },
        ],
        { cardId },
      );
    },
    /** Taken back whatever the switch says now: it may have been shared
     *  while the switch was on. One Elixir never held is already gone. */
    async awayCleared(clanTag, token, who) {
      if (!token || typeof mcp.removeFact !== "function") return;
      await mcp.removeFact(token, clanTag, `away:${who.player_tag}`);
    },
  };
}
