/**
 * The Manage service: evaluation on demand with the leader's token, the
 * card lifecycle, holds, notes, policy versions, standing, scouting. Pure
 * engine in, ledger and Elixir out. Every function takes the caller's
 * resolved context (`who`: their verified tag and role in this clan).
 */

import {
  CARD_TYPES,
  cardFacts,
  cardRationale,
  defaults,
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
      };
    return { values: defaults(), version: 0, saved_at: null, saved_by: null };
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

    /** The policy editor's data: fields with help, groups, current values, versions. */
    async policyView(clanTag, who) {
      const policy = await policyFor(clanTag);
      const versions = await ledger.policyVersions(clanTag);
      return {
        can_edit: isLeader(who),
        current: policy,
        groups: GROUPS,
        fields: FIELDS,
        versions: versions
          .map((v) => ({
            version: v.version,
            saved_at: v.saved_at,
            saved_by: v.saved_by,
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
        .sort((a, b) => (a.evidence?.as_of < b.evidence?.as_of ? 1 : -1));
      const board = verdicts.members.map((m) => ({
        player_tag: m.player_tag,
        name: m.name,
        role: m.role,
        judgment: m.judgment,
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

    async history(clanTag, who) {
      requireLeader(who);
      const cards = (await ledger.cards(clanTag))
        .filter((c) => c.status !== "proposed")
        .sort((a, b) => (a.raised_at < b.raised_at ? 1 : -1));
      const holds = await ledger.holds(clanTag);
      return { cards, holds };
    },

    async decide(clanTag, who, cardId, { status, reason = null, note = null }) {
      requireLeader(who);
      if (status !== "done" && status !== "declined")
        throw new ManageError(400, "bad_status");
      if (status === "declined" && !DECLINE_REASONS.includes(reason))
        throw new ManageError(400, "bad_reason");
      const card = await ledger.card(clanTag, cardId);
      if (!card) throw new ManageError(404, "no_card");
      // A decided card is frozen; a withdrawn card cannot be resurrected.
      if (card.status !== "proposed") throw new ManageError(409, "card_closed");
      const decided_at = new Date(now()).toISOString();
      const decided = {
        ...card,
        status,
        decided_at,
        decided_by: who.player_tag,
        decline_reason: status === "declined" ? reason : null,
        decision_note: note,
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
        until,
        note,
        by: who.player_tag,
        set_at: new Date(now()).toISOString(),
      });
    },
    async clearHold(clanTag, who, playerTag) {
      requireLeader(who);
      await ledger.removeHold(clanTag, playerTag);
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
      return {
        clan_tag: clanTag,
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
