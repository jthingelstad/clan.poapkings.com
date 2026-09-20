/**
 * The Manage service: evaluation on demand with the leader's token, the
 * card lifecycle, holds, notes, policy versions, standing, scouting. Pure
 * engine in, ledger and Elixir out. Every function takes the caller's
 * resolved context (`who`: their verified tag and role in this clan).
 */

import {
  CARD_TYPES,
  DEPARTURE_CLASSIFICATIONS,
  cardFacts,
  cardRationale,
  defaults,
  departuresFrom,
  inGameCopy,
  judgmentReasons,
  diff as policyDiff,
  evaluate,
  nextSteps,
  participationPhrase,
  reconcileCards,
  standingForMembers,
  validate,
  FIELDS,
  GROUPS,
} from "@elixir-clan/engine";
import { newId } from "./ledger.mjs";

export const EVALUATION_TTL_MS = 5 * 60_000;
export const PARTICIPATION_WEEKS = 8;
export const DECLINE_REASONS = [
  "not_now",
  "knows_the_member",
  "evidence_wrong",
  "handled_in_game",
  "other",
];
const LEADERS = new Set(["leader", "coLeader"]);
const ELDER_PLUS = new Set(["leader", "coLeader", "elder"]);
const DAY_MS = 86400_000;

export class ManageError extends Error {
  constructor(status, code, message) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

/** One call, eight weeks: the record every evaluation reads. */
export async function fetchParticipation(mcp, token, clanTag) {
  const r = await mcp.callTool(token, "clans_participation", {
    clan_tag: clanTag,
    weeks: PARTICIPATION_WEEKS,
  });
  if (!r.ok) {
    if (r.status === 401) throw new ManageError(401, "session_expired");
    throw new ManageError(
      502,
      r.code === "not_recorded" ? "clan_not_recorded" : "elixir_unavailable",
      r.error,
    );
  }
  return r.body;
}

/** The roster with its recent join/leave/role events; null when Elixir
 *  cannot answer (the evaluation goes on without the timeline). */
export async function fetchRoster(mcp, token, clanTag) {
  const r = await mcp.callTool(token, "clans_roster", { clan_tag: clanTag });
  if (!r.ok) {
    if (r.status === 401) throw new ManageError(401, "session_expired");
    return null;
  }
  return r.body;
}

/** Tag → last-observed name for the tags Elixir's corpus knows, from one
 *  bulk players_names read (nothing from the live lane); an empty map
 *  when Elixir cannot answer. */
export async function fetchNames(mcp, token, tags) {
  const names = new Map();
  if (tags.length === 0) return names;
  const r = await mcp.callTool(token, "players_names", {
    player_tags: tags.slice(0, 100),
  });
  if (!r.ok) {
    if (r.status === 401) throw new ManageError(401, "session_expired");
    return names;
  }
  for (const n of r.body?.names ?? [])
    if (n.player_tag && n.name) names.set(n.player_tag, n.name);
  return names;
}

export function createManageService({ ledger, mcp, now = () => Date.now() }) {
  const isLeader = (who) => LEADERS.has(who.role);
  const requireLeader = (who) => {
    if (!isLeader(who)) throw new ManageError(403, "leaders_only");
  };

  async function policyFor(clanTag) {
    const current = await ledger.currentPolicy(clanTag);
    if (current)
      return {
        values: current.values,
        version: current.version,
        saved_at: current.saved_at,
        saved_by: current.saved_by,
        saved_by_name: current.saved_by_name ?? null,
      };
    return {
      values: defaults(),
      version: 0,
      saved_at: null,
      saved_by: null,
      saved_by_name: null,
    };
  }

  /** Tag -> name from what the ledger already holds: the latest verdict
   *  snapshot (everyone evaluated), every card that named its member or
   *  its decider, every note's author. No Elixir read. This names the
   *  actor tags written before 2026-09-20, when a decision, a hold, a
   *  policy version and a grant carried only `who.player_tag`; rows
   *  written since carry the name beside the tag. */
  async function knownNames(clanTag) {
    const names = new Map();
    const add = (tag, name) => {
      if (tag && name && !names.has(tag)) names.set(tag, name);
    };
    const snapshot = await ledger.latestVerdicts(clanTag);
    for (const m of snapshot?.members ?? []) add(m.player_tag, m.name);
    for (const c of await ledger.cards(clanTag)) {
      add(c.player_tag, c.player_name);
      add(c.decided_by, c.decided_by_name);
    }
    for (const n of await ledger.notes(clanTag))
      add(n.author_tag, n.author_name);
    return names;
  }

  /** Evaluate (or reuse a fresh snapshot), reconcile cards, verify outcomes. */
  async function evaluateClan({
    clanTag,
    token,
    who,
    force = false,
    participation = null,
  }) {
    const t = now();
    const policy = await policyFor(clanTag);
    const cached = await ledger.latestVerdicts(clanTag);
    if (
      !force &&
      !participation &&
      cached &&
      cached.policy_version === policy.version &&
      t - Date.parse(cached.evaluated_at) < EVALUATION_TTL_MS
    )
      return { verdicts: cached, policy, cached: true };

    const part =
      participation ?? (await fetchParticipation(mcp, token, clanTag));
    const cards = await ledger.cards(clanTag);
    const decisions = cards
      .filter((c) => c.status === "done" || c.status === "declined")
      .map((c) => ({
        player_tag: c.player_tag,
        type: c.type,
        status: c.status,
        decided_at: c.decided_at,
        expires_at: c.expires_at ?? null,
      }));
    const holds = (await ledger.holds(clanTag)).map((h) => ({
      player_tag: h.player_tag,
      kind: h.kind ?? "leader",
      until: h.until ?? null,
      by: h.by,
      note: h.note ?? null,
      set_at: h.set_at,
    }));
    const verdicts = evaluate({
      participation: part,
      policy: policy.values,
      now: new Date(t),
      decisions,
      holds,
      policy_version: policy.version,
    });
    // Reconcile cards against the fresh verdicts.
    const open = cards.filter((c) => c.status === "proposed");
    const { raise, withdraw } = reconcileCards(verdicts, open);
    for (const { card, reason } of withdraw) {
      await ledger.putCard(clanTag, {
        ...card,
        status: "withdrawn",
        withdrawn_at: new Date(t).toISOString(),
        withdraw_reason: reason,
      });
    }
    for (const { player_tag, type, verdict } of raise) {
      const raised_at = new Date(t).toISOString();
      await ledger.putCard(clanTag, {
        card_id: newId(),
        clan_tag: clanTag,
        player_tag,
        player_name: verdict.name,
        role_at_raise: verdict.role,
        type,
        status: "proposed",
        raised_at,
        policy_version: policy.version,
        evidence: {
          as_of: verdicts.as_of,
          freshness_seconds: verdicts.freshness_seconds,
          facts: cardFacts(verdict, policy.values),
          rationale: cardRationale(type, verdict, policy.values, verdicts.band),
          phrase: participationPhrase(verdict),
          days_idle: verdict.removal.days_idle,
          standing: verdict.standing,
        },
      });
    }
    // Outcome verification for done cards, from the record.
    const memberByTag = new Map(verdicts.members.map((m) => [m.player_tag, m]));
    for (const c of cards) {
      if (
        c.status !== "done" ||
        c.outcome?.verified_at ||
        c.outcome?.flagged_at
      )
        continue;
      const m = memberByTag.get(c.player_tag);
      const decidedMs = Date.parse(c.decided_at);
      let verified = false;
      if (c.type === "removal")
        verified = !m; // membership closed
      else if (c.type === "promotion")
        verified =
          m?.role === "elder" || m?.role === "coLeader" || m?.role === "leader";
      else if (c.type === "demotion") verified = m?.role === "member";
      if (verified) {
        await ledger.putCard(clanTag, {
          ...c,
          outcome: {
            verified_at: new Date(t).toISOString(),
            delay_hours: Number(((t - decidedMs) / 3600_000).toFixed(1)),
            classification:
              c.type === "removal" ? "member_kicked" : "role_changed",
          },
        });
      } else if (
        t - decidedMs >
        policy.values.outcome_window_hours * 3600_000
      ) {
        await ledger.putCard(clanTag, {
          ...c,
          outcome: {
            flagged_at: new Date(t).toISOString(),
            note: "No matching change in the record inside the outcome window.",
          },
        });
      }
    }
    // Departures the record shows and this ledger has not explained (a
    // removal card marked Done explains its own): one card each, Kicked /
    // Left / Ignore for a leader to say. The roster read is the source
    // of the events; the previous snapshot lends the member's last line.
    if (!participation) {
      const roster = await fetchRoster(mcp, token, clanTag);
      if (roster) {
        const lastKnown = new Map(
          (cached?.members ?? []).map((m) => [m.player_tag, m]),
        );
        const allCards = await ledger.cards(clanTag);
        for (const d of departuresFrom(
          roster.recent_events,
          allCards,
          lastKnown,
        )) {
          await ledger.putCard(clanTag, {
            card_id: newId(),
            clan_tag: clanTag,
            player_tag: d.player_tag,
            player_name: d.player_name ?? d.last?.name ?? null,
            role_at_raise: d.role_before ?? d.last?.role ?? null,
            type: "departure",
            status: "proposed",
            raised_at: new Date(t).toISOString(),
            policy_version: policy.version,
            evidence: {
              left_at: d.left_at,
              days_idle:
                d.last?.facts?.days_idle ?? d.last?.removal?.days_idle ?? null,
              tenure_days: d.last?.facts?.tenure_days ?? null,
              removal_state: d.last?.removal?.state ?? null,
              phrase: d.last ? participationPhrase(d.last) : null,
            },
          });
        }
      }
      // A card raised with only a tag (a member_left Elixir observed
      // before it stamped names on roster events, 2026-09-13, and no
      // last line for the member here) is unreadable in the inbox. One
      // bulk read names them; the ledger remembers from then on.
      const nameless = (await ledger.cards(clanTag)).filter(
        (c) => !c.player_name,
      );
      if (nameless.length > 0) {
        const names = await fetchNames(mcp, token, [
          ...new Set(nameless.map((c) => c.player_tag)),
        ]);
        for (const c of nameless) {
          const name = names.get(c.player_tag);
          if (name) await ledger.putCard(clanTag, { ...c, player_name: name });
        }
      }
    }
    // The snapshot is what the pages read; keep it small.
    const snapshot = {
      ...verdicts,
      members: verdicts.members.map((m) => ({
        ...m,
        trail: m.trail.slice(-4),
      })),
    };
    await ledger.saveVerdicts(clanTag, snapshot);
    void who;
    return { verdicts: snapshot, policy, cached: false };
  }

  return {
    policyFor,
    evaluateClan,

    /** Open cards, for the rail's count: a ledger read, no evaluation. */
    async openCardCount(clanTag) {
      return (await ledger.cards(clanTag)).filter(
        (c) => c.status === "proposed",
      ).length;
    },

    /** The policy editor's data: fields with help, groups, current values, versions. */
    async policyView(clanTag, who) {
      const policy = await policyFor(clanTag);
      const versions = await ledger.policyVersions(clanTag);
      const names = await knownNames(clanTag);
      return {
        can_edit: isLeader(who),
        current: {
          ...policy,
          saved_by_name:
            policy.saved_by_name ?? names.get(policy.saved_by) ?? null,
        },
        groups: GROUPS,
        fields: FIELDS,
        versions: versions
          .map((v) => ({
            version: v.version,
            saved_at: v.saved_at,
            saved_by: v.saved_by,
            saved_by_name: v.saved_by_name ?? names.get(v.saved_by) ?? null,
            note: v.note,
            changes: null,
          }))
          .reverse(),
      };
    },

    async savePolicy(clanTag, who, input, note) {
      requireLeader(who);
      const checked = validate(input);
      if (!checked.ok)
        throw Object.assign(new ManageError(400, "invalid_policy"), {
          errors: checked.errors,
        });
      const before = (await policyFor(clanTag)).values;
      const saved = await ledger.savePolicy(clanTag, {
        values: checked.values,
        by: who.player_tag,
        by_name: who.name ?? null,
        note,
      });
      return { ...saved, changes: policyDiff(before, checked.values) };
    },

    /** What the last four reviews would say under a draft policy, beside the current one. */
    async previewPolicy(clanTag, who, token, input) {
      requireLeader(who);
      const checked = validate(input);
      if (!checked.ok)
        throw Object.assign(new ManageError(400, "invalid_policy"), {
          errors: checked.errors,
        });
      const r = await mcp.callTool(token, "clans_participation", {
        clan_tag: clanTag,
        weeks: PARTICIPATION_WEEKS,
      });
      if (!r.ok)
        throw new ManageError(
          r.status === 401 ? 401 : 502,
          r.status === 401 ? "session_expired" : "elixir_unavailable",
        );
      const current = await policyFor(clanTag);
      const at = new Date(now());
      const under = (values, version) => {
        const v = evaluate({
          participation: r.body,
          policy: values,
          now: at,
          policy_version: version,
        });
        return {
          band: v.band,
          boundaries: v.boundaries,
          members: v.members.map((m) => ({
            player_tag: m.player_tag,
            name: m.name,
            role: m.role,
            promotion: m.promotion.state,
            demotion: m.demotion.state,
            removal: m.removal.state,
            actionable: m.actionable,
            trail: m.trail.slice(-4).map((t) => ({
              at: t.at,
              promotable: t.promotable,
              demotable: t.demotable,
            })),
          })),
        };
      };
      return {
        current: under(current.values, current.version),
        draft: under(checked.values, "draft"),
        changes: policyDiff(current.values, checked.values),
      };
    },

    /** Inbox + board for leaders. */
    async manageView(clanTag, who, token, { refresh = false } = {}) {
      requireLeader(who);
      const { verdicts, policy, cached } = await evaluateClan({
        clanTag,
        token,
        who,
        force: refresh,
      });
      const cards = await ledger.cards(clanTag);
      const holds = await ledger.holds(clanTag);
      const holdByTag = new Map(holds.map((h) => [h.player_tag, h]));
      const inbox = cards
        .filter((c) => c.status === "proposed")
        .sort((a, b) => (a.raised_at < b.raised_at ? 1 : -1))
        .map((c) => ({
          ...c,
          copy:
            c.type === "departure"
              ? null
              : inGameCopy(c.type, {
                  name: c.player_name,
                  days_idle: c.evidence?.days_idle ?? null,
                  phrase: c.evidence?.phrase ?? "",
                }),
        }));
      const board = verdicts.members.map((m) => ({
        player_tag: m.player_tag,
        name: m.name,
        role: m.role,
        judgment: m.judgment,
        judgment_reasons: judgmentReasons(m, verdicts.boundaries),
        promotion: m.promotion,
        demotion: m.demotion,
        removal: m.removal,
        standing: m.standing,
        hold: holdByTag.get(m.player_tag) ?? null,
        phrase: participationPhrase(m),
        facts: {
          war_rate: m.facts.war.rate,
          war_fidelity: m.facts.war.fidelity,
          ranked_battles: m.facts.ranked.battles,
          donations: m.facts.donations.average,
          days_idle: m.facts.days_idle,
          tenure_days: m.facts.tenure_days,
          tenure_known: m.facts.tenure_known,
          observed_days: m.facts.observed_days,
        },
        bucket: bucketFor(m),
      }));
      return {
        clan_tag: clanTag,
        evaluated_at: verdicts.evaluated_at,
        cached,
        as_of: verdicts.as_of,
        freshness_seconds: verdicts.freshness_seconds,
        recording_active_since: verdicts.recording_active_since,
        boundaries: verdicts.boundaries,
        policy_version: policy.version,
        band: verdicts.band,
        inbox,
        board,
        decline_reasons: DECLINE_REASONS,
      };
    },

    async history(clanTag, who, token = null) {
      requireLeader(who);
      const allCards = await ledger.cards(clanTag);
      const cards = allCards
        .filter((c) => c.status !== "proposed")
        .sort((a, b) => (a.raised_at < b.raised_at ? 1 : -1));
      // The membership timeline: Elixir's recent join / leave / role
      // events, each leave carrying what this ledger says about it, and
      // a welcome line a leader can paste for a join.
      const roster = token ? await fetchRoster(mcp, token, clanTag) : null;
      const byTag = (tag) =>
        cards.filter((c) => c.player_tag === tag && c.type === "departure");
      // Who a tag is, when the event itself does not say: the roster for
      // anyone still here, else what the ledger has named (cards, the
      // verdict snapshot, note authors).
      const knownName = await knownNames(clanTag);
      // The roster is the freshest name for anyone still here.
      for (const m of roster?.members ?? [])
        if (m.name) knownName.set(m.player_tag, m.name);
      const named = (row, tagKey, nameKey) => ({
        ...row,
        [nameKey]: row[nameKey] ?? knownName.get(row[tagKey]) ?? null,
      });
      const holds = (await ledger.holds(clanTag)).map((h) =>
        named(named(h, "player_tag", "player_name"), "by", "by_name"),
      );
      const timeline = (roster?.recent_events ?? [])
        .filter((e) => e.detail?.player_tag)
        .map((e) => {
          const tag = e.detail.player_tag;
          const explained =
            e.type === "member_left"
              ? (byTag(tag).find(
                  (c) =>
                    Math.abs(
                      Date.parse(c.evidence?.left_at) - Date.parse(e.at),
                    ) < DAY_MS,
                ) ??
                cards.find(
                  (c) =>
                    c.player_tag === tag &&
                    c.type === "removal" &&
                    c.status === "done" &&
                    Date.parse(c.decided_at) <= Date.parse(e.at) + DAY_MS,
                ) ??
                null)
              : null;
          // An event observed before Elixir stamped names (2026-09-13)
          // carries only a tag.
          const name = e.detail.name ?? knownName.get(tag) ?? null;
          return {
            type: e.type,
            at: e.at,
            player_tag: tag,
            name,
            role: e.detail.role ?? e.detail.role_at_departure ?? null,
            role_before: e.detail.role_before ?? null,
            role_after: e.detail.role_after ?? null,
            // A Done removal followed by the leave IS the kick, whether or
            // not the outcome pass has run since.
            classification:
              explained?.outcome?.classification ??
              (explained?.type === "removal" ? "member_kicked" : null),
            card_id: explained?.card_id ?? null,
            note: explained?.decision_note ?? null,
            copy:
              e.type === "member_joined"
                ? inGameCopy("welcome", { name })
                : explained?.outcome?.classification === "member_left"
                  ? inGameCopy("farewell", { name })
                  : null,
          };
        })
        .sort((a, b) => (a.at < b.at ? 1 : -1));
      return {
        cards: cards.map((c) => named(c, "decided_by", "decided_by_name")),
        holds,
        timeline,
        timeline_since: roster?.events_recorded_since ?? null,
      };
    },

    async decide(
      clanTag,
      who,
      cardId,
      { status, reason = null, note = null, classification = null },
    ) {
      requireLeader(who);
      const card = await ledger.card(clanTag, cardId);
      if (!card) throw new ManageError(404, "no_card");
      // A decided card is frozen; a withdrawn card cannot be resurrected.
      if (card.status !== "proposed") throw new ManageError(409, "card_closed");
      // A departure is answered, never declined: Kicked, Left or Ignore.
      if (card.type === "departure") {
        if (!DEPARTURE_CLASSIFICATIONS.includes(classification))
          throw new ManageError(400, "bad_classification");
        status = "done";
      } else if (status !== "done" && status !== "declined")
        throw new ManageError(400, "bad_status");
      if (status === "declined" && !DECLINE_REASONS.includes(reason))
        throw new ManageError(400, "bad_reason");
      const decided_at = new Date(now()).toISOString();
      const decided = {
        ...card,
        status,
        decided_at,
        decided_by: who.player_tag,
        decided_by_name: who.name ?? null,
        decline_reason: status === "declined" ? reason : null,
        // The leader's word, in their own words, bounded like a note.
        decision_note:
          typeof note === "string" && note.trim()
            ? note.trim().slice(0, 280)
            : null,
        ...(card.type === "departure"
          ? {
              outcome: {
                verified_at: decided_at,
                classification:
                  classification === "kick"
                    ? "member_kicked"
                    : classification === "leave"
                      ? "member_left"
                      : "ignored",
              },
            }
          : {}),
      };
      await ledger.putCard(clanTag, decided);
      return decided;
    },

    // ---- holds -----------------------------------------------------------
    async setHold(clanTag, who, playerTag, { until = null, note = null }) {
      requireLeader(who);
      if (until && Number.isNaN(Date.parse(until)))
        throw new ManageError(400, "bad_until");
      return ledger.putHold(clanTag, {
        player_tag: playerTag,
        kind: "leader",
        until,
        note,
        by: who.player_tag,
        by_name: who.name ?? null,
        set_at: new Date(now()).toISOString(),
      });
    },
    async clearHold(clanTag, who, playerTag) {
      requireLeader(who);
      await ledger.removeHold(clanTag, playerTag);
    },

    // ---- away: a member says so on their own page (2026-09-12). The
    // clock pauses like a leader's hold; the policy caps how long; a
    // leader can clear it; the board says it was the member's word.
    async myAway(clanTag, who) {
      const holds = await ledger.holds(clanTag);
      const mine = holds.find((h) => h.player_tag === who.player_tag) ?? null;
      const policy = await policyFor(clanTag);
      return {
        allowed: policy.values.away_max_days > 0,
        max_days: policy.values.away_max_days,
        hold: mine
          ? {
              ...mine,
              by_name:
                mine.by_name ??
                (await knownNames(clanTag)).get(mine.by) ??
                null,
            }
          : null,
      };
    },
    async setAway(clanTag, who, { until, note = null }) {
      const policy = await policyFor(clanTag);
      const max = policy.values.away_max_days;
      if (!(max > 0)) throw new ManageError(403, "away_off");
      const untilMs = Date.parse(String(until ?? ""));
      const t = now();
      if (Number.isNaN(untilMs) || untilMs <= t)
        throw new ManageError(400, "bad_until");
      if (untilMs > t + max * DAY_MS) throw new ManageError(400, "too_long");
      const existing = (await ledger.holds(clanTag)).find(
        (h) => h.player_tag === who.player_tag,
      );
      // A leader's hold is the leader's; the member does not overwrite it.
      if (existing && existing.kind !== "away")
        throw new ManageError(409, "held_by_leader");
      return ledger.putHold(clanTag, {
        player_tag: who.player_tag,
        kind: "away",
        until: new Date(untilMs).toISOString(),
        note: note ? String(note).slice(0, 200) : null,
        by: who.player_tag,
        by_name: who.name ?? null,
        set_at: new Date(t).toISOString(),
      });
    },
    async clearAway(clanTag, who) {
      const existing = (await ledger.holds(clanTag)).find(
        (h) => h.player_tag === who.player_tag,
      );
      if (!existing) return;
      if (existing.kind !== "away")
        throw new ManageError(409, "held_by_leader");
      await ledger.removeHold(clanTag, who.player_tag);
    },

    // ---- notes: elders write elder notes and read elder notes; leaders
    // write leader notes and read both --------------------------------------
    async notesFor(clanTag, who, playerTag) {
      if (!ELDER_PLUS.has(who.role)) throw new ManageError(403, "elders_only");
      const all = await ledger.notes(clanTag, playerTag);
      return all
        .filter((n) => n.tier === "elder" || isLeader(who))
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    },
    async addNote(clanTag, who, playerTag, text) {
      if (!ELDER_PLUS.has(who.role)) throw new ManageError(403, "elders_only");
      const body = String(text ?? "").trim();
      if (!body || body.length > 2000) throw new ManageError(400, "bad_note");
      return ledger.putNote(clanTag, {
        note_id: newId(),
        player_tag: playerTag,
        tier: isLeader(who) ? "leader" : "elder",
        author_tag: who.player_tag,
        author_name: who.name ?? null,
        text: body,
        created_at: new Date(now()).toISOString(),
      });
    },
    async removeNote(clanTag, who, noteId) {
      const all = await ledger.notes(clanTag);
      const note = all.find((n) => n.note_id === noteId);
      if (!note) throw new ManageError(404, "no_note");
      if (!(isLeader(who) || note.author_tag === who.player_tag))
        throw new ManageError(403, "not_your_note");
      await ledger.removeNote(clanTag, noteId);
    },

    // ---- standing for members; "you" ---------------------------------------
    async standing(clanTag, who, token) {
      const policy = await policyFor(clanTag);
      if (!policy.values.members_see_standing && !isLeader(who))
        throw new ManageError(403, "standing_private");
      if (!policy.values.elder_management_enabled)
        return { enabled: false, rows: [], you: null };
      const { verdicts } = await evaluateClan({ clanTag, token, who });
      const rows = standingForMembers(verdicts);
      const mine =
        verdicts.members.find((m) => m.player_tag === who.player_tag) ?? null;
      const holds = await ledger.holds(clanTag);
      const myHold = holds.find((h) => h.player_tag === who.player_tag) ?? null;
      return {
        enabled: true,
        as_of: verdicts.as_of,
        freshness_seconds: verdicts.freshness_seconds,
        rows,
        you: mine
          ? {
              status:
                rows.find((r) => r.player_tag === who.player_tag)?.status ??
                null,
              evidence: participationPhrase(mine),
              next: nextSteps(mine, policy.values),
              inactivity:
                mine.removal.state === "none"
                  ? null
                  : mine.removal.state === "recommended"
                    ? "at_risk"
                    : mine.removal.state,
              days_idle: mine.facts.days_idle,
              hold: myHold ? { until: myHold.until ?? null } : null,
            }
          : null,
      };
    },

    /** The public "How Elder works here" page, from the current policy. */
    async howElderWorks(clanTag) {
      const policy = await policyFor(clanTag);
      // The page is public and has no session to name the clan from; the
      // latest evaluation stamped the name clans_participation reported.
      const snapshot = await ledger.latestVerdicts(clanTag);
      return {
        clan_tag: clanTag,
        name: snapshot?.clan_name ?? null,
        values: policy.values,
        version: policy.version,
        groups: GROUPS,
        fields: FIELDS,
      };
    },
  };
}

function bucketFor(m) {
  if (m.actionable.promotion || m.actionable.demotion || m.actionable.removal)
    return "actionable";
  if (m.hold?.active) return "held";
  const heldJ = Object.values(m.judgment).some(
    (j) => j === "held" || j === "unknown",
  );
  if (
    m.removal.state === "at_risk" ||
    m.removal.state === "watch" ||
    m.promotion.state === "building" ||
    m.demotion.state === "building" ||
    m.promotion.state === "eligible" ||
    m.demotion.state === "eligible"
  )
    return "building";
  if (heldJ) return "held";
  return "clear";
}

export { CARD_TYPES };
