/**
 * The Manage service: evaluation on demand with the leader's token, the
 * card lifecycle, holds, notes, policy versions, standing, scouting. Pure
 * engine in, ledger and Elixir out. Every function takes the caller's
 * resolved context (`who`: their verified tag and role in this clan).
 *
 * Nothing here runs for a clan until a leader or co-leader has saved its
 * policy (Jamie, 2026-09-25): every management call refuses with
 * `409 no_policy` before then, and the policy editor is the one way in.
 * Nor below MIN_MEMBERS (10, as Clan Wars): no policy can be created, and
 * a saved one pauses, kept, with `409 too_few_members`, until the clan is
 * back at that size. The size is the latest roster or participation read,
 * kept as one number in the ledger so the gate costs no Elixir read.
 */

import {
  CARD_TYPES,
  DEPARTURE_CLASSIFICATIONS,
  cardFacts,
  cardRationale,
  defaults,
  departuresFrom,
  describePolicy,
  inGameCopy,
  judgmentReasons,
  diff as policyDiff,
  evaluate,
  nextSteps,
  participationPhrase,
  ranksElder,
  reconcileCards,
  standingForMembers,
  validate,
  FIELDS,
  GROUPS,
  MIN_MEMBERS,
  audienceOf,
  awayCandidates,
  canAct,
  JUDGING_TYPES,
  leaderMessage,
  goalsInSentence,
  declaredGoals,
  welcomesFrom,
} from "@elixir-clan/engine";
import { newId } from "./ledger.mjs";
import { createActionStore } from "./actions.mjs";

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
  constructor(status, code, message, detail = null) {
    super(message ?? code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/** Below the smallest clan a policy engages with: say how many there are. */
export const tooFewMembers = (members) =>
  new ManageError(409, "too_few_members", null, {
    members,
    min_members: MIN_MEMBERS,
  });

const SIZE_STALE_MS = 3600_000;

/** Remember a clan's member count from a read already made; written only
 *  when it changed or the last note is over an hour old. */
export async function noteClanSize(ledger, clanTag, members, t) {
  if (!Number.isInteger(members)) return;
  const known = await ledger.clanSize(clanTag);
  if (
    known &&
    known.members === members &&
    t - Date.parse(known.observed_at) < SIZE_STALE_MS
  )
    return;
  await ledger.saveClanSize(clanTag, {
    members,
    observed_at: new Date(t).toISOString(),
  });
}

/** The roster's member count, as the roster states it. */
export const rosterSize = (roster) =>
  roster ? (roster.member_count ?? roster.members?.length ?? null) : null;

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

  /** The clan's saved policy, or the starting values with `set: false`
   *  (a draft for the editor, never something to judge by). */
  async function policyFor(clanTag) {
    const current = await ledger.currentPolicy(clanTag);
    if (current)
      return {
        set: true,
        // A field added since the version was saved takes its starting value.
        values: { ...defaults(), ...current.values },
        version: current.version,
        saved_at: current.saved_at,
        saved_by: current.saved_by,
        saved_by_name: current.saved_by_name ?? null,
      };
    return {
      set: false,
      values: defaults(),
      version: 0,
      saved_at: null,
      saved_by: null,
      saved_by_name: null,
    };
  }

  const noteSize = (clanTag, members) =>
    noteClanSize(ledger, clanTag, members, now());

  /** The saved policy, or `409 no_policy`: no management without one;
   *  and `409 too_few_members` while the clan's noted size is below
   *  MIN_MEMBERS. An evaluation passes `size: false` and re-reads the
   *  size from its own participation read, so a clan that grew resumes. */
  async function requirePolicy(clanTag, { size = true } = {}) {
    const policy = await policyFor(clanTag);
    if (!policy.set) throw new ManageError(409, "no_policy");
    if (size) {
      const known = await ledger.clanSize(clanTag);
      if (known && known.members < MIN_MEMBERS)
        throw tooFewMembers(known.members);
    }
    return policy;
  }

  /**
   * When the policy asks for it, a new version raises "tell the clan how it
   * runs" for leaders, with a Clan Leader Message ready: how the clan runs
   * for the first version, what changed after. One is open at a time; a
   * newer version replaces it.
   */
  async function announceRules(clanTag, saved, changes) {
    const cards = await ledger.cards(clanTag);
    const open = cards.filter(
      (c) => c.type === "rules_announcement" && c.status === "proposed",
    );
    for (const c of open)
      await withdrawAction(clanTag, c, `Version ${saved.version} was saved.`);
    if (!saved.values.announce_rules_enabled) return;
    if (changes && changes.length === 0) return;
    const goals = declaredGoals(saved.values);
    const message = leaderMessage("rules", {
      first: !changes,
      goals: goals.length ? goalsInSentence(goals) : null,
      changes: (changes ?? []).map((c) => c.label),
    });
    await raiseAction(
      clanTag,
      {
        card_id: newId(),
        clan_tag: clanTag,
        player_tag: null,
        player_name: null,
        role_at_raise: null,
        type: "rules_announcement",
        status: "proposed",
        raised_at: new Date(now()).toISOString(),
        policy_version: saved.version,
        evidence: {
          version: saved.version,
          changes: (changes ?? []).map((c) => c.label),
          message,
        },
      },
      cards,
      {
        text: changes
          ? `Policy version ${saved.version} changed ${changes.length} setting${changes.length === 1 ? "" : "s"}.`
          : `Policy version ${saved.version}: the clan's first.`,
        detail: { clauses: ["announce_rules_enabled"] },
      },
    );
  }

  /** The clan's member count now: one roster read (noted), else the last
   *  noted count when Elixir cannot answer. */
  async function currentSize(clanTag, token) {
    const roster = token ? await fetchRoster(mcp, token, clanTag) : null;
    const members = rosterSize(roster);
    if (members !== null) {
      await noteSize(clanTag, members);
      return members;
    }
    return (await ledger.clanSize(clanTag))?.members ?? null;
  }

  // ---- actions and their logs (shared with the awards service) --------
  const {
    person,
    logAction,
    raiseAction,
    withdrawAction,
    shapeAction,
    logsByCard,
  } = createActionStore({ ledger, now });

  /** Tag -> trophies today, when the policy counts trophy road. */
  const trophiesFrom = (roster) =>
    roster
      ? new Map(
          (roster.members ?? []).map((m) => [m.player_tag, m.trophies ?? null]),
        )
      : null;

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
    const policy = await requirePolicy(clanTag, { size: false });
    const cached = await ledger.latestVerdicts(clanTag);
    // A clan last seen below the minimum is re-read, never served a cache.
    const known = await ledger.clanSize(clanTag);
    const small = known !== null && known.members < MIN_MEMBERS;
    if (
      !force &&
      !participation &&
      !small &&
      cached &&
      cached.policy_version === policy.version &&
      t - Date.parse(cached.evaluated_at) < EVALUATION_TTL_MS
    )
      return { verdicts: cached, policy, cached: true };

    const part =
      participation ?? (await fetchParticipation(mcp, token, clanTag));
    // Too small to judge: remember the size and stop, before any card moves.
    if (!participation) {
      await noteSize(clanTag, part.members.length);
      if (part.members.length < MIN_MEMBERS)
        throw tooFewMembers(part.members.length);
    }
    // The roster carries today's trophies and the join/leave events; read
    // only when the policy needs one of them.
    const needsRoster =
      policy.values.trophies_enabled ||
      policy.values.departures_enabled ||
      policy.values.welcome_enabled;
    const roster =
      !participation && needsRoster
        ? await fetchRoster(mcp, token, clanTag)
        : null;
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
      trophies: policy.values.trophies_enabled ? trophiesFrom(roster) : null,
    });
    // Reconcile cards against the fresh verdicts.
    const open = cards.filter((c) => c.status === "proposed");
    const { raise, withdraw } = reconcileCards(verdicts, open);
    for (const { card, reason } of withdraw)
      await withdrawAction(clanTag, card, reason);
    for (const { player_tag, type, verdict } of raise) {
      const raised_at = new Date(t).toISOString();
      const facts = cardFacts(verdict, policy.values);
      const rationale = cardRationale(type, verdict, policy.values, verdicts);
      await raiseAction(
        clanTag,
        {
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
            facts,
            rationale,
            phrase: participationPhrase(verdict, policy.values),
            days_idle: verdict.removal.days_idle,
            standing: verdict.standing,
          },
        },
        cards,
        {
          text: rationale.headline,
          detail: {
            clauses: rationale.clauses,
            facts: facts.map((f) => `${f.label}: ${f.value} (${f.window})`),
            as_of: verdicts.as_of,
          },
        },
      );
    }
    // Outcome verification for completed promotions, demotions and
    // removals, from the record.
    const memberByTag = new Map(verdicts.members.map((m) => [m.player_tag, m]));
    for (const c of cards) {
      if (
        c.status !== "done" ||
        !["promotion", "demotion", "removal"].includes(c.type) ||
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
        const classification =
          c.type === "removal" ? "member_kicked" : "role_changed";
        await ledger.putCard(clanTag, {
          ...c,
          outcome: {
            verified_at: new Date(t).toISOString(),
            delay_hours: Number(((t - decidedMs) / 3600_000).toFixed(1)),
            classification,
          },
        });
        await logAction(clanTag, c.card_id, "outcome_verified", {
          text:
            c.type === "removal"
              ? "The record shows the member gone."
              : "The record shows the role changed.",
          detail: { classification },
        });
      } else if (
        t - decidedMs >
        policy.values.outcome_window_hours * 3600_000
      ) {
        const note =
          "No matching change in the record inside the outcome window.";
        await ledger.putCard(clanTag, {
          ...c,
          outcome: { flagged_at: new Date(t).toISOString(), note },
        });
        await logAction(clanTag, c.card_id, "outcome_flagged", { text: note });
      }
    }
    // Going to be away? A member whose own clock is at risk is asked, when
    // the policy says so; the action closes itself when they play again or
    // mark themselves away.
    const awayOn =
      policy.values.removal_enabled &&
      policy.values.away_max_days > 0 &&
      policy.values.away_suggestions_enabled;
    const askAway = new Map(
      (awayOn ? awayCandidates(verdicts) : []).map((m) => [m.player_tag, m]),
    );
    const awayHolds = new Map(
      holds
        .filter(
          (h) => h.kind === "away" && (!h.until || Date.parse(h.until) > t),
        )
        .map((h) => [h.player_tag, h]),
    );
    for (const c of cards.filter(
      (c) => c.type === "away" && c.status === "proposed",
    )) {
      const away = awayHolds.get(c.player_tag);
      if (away) {
        const note = `Marked away${away.until ? ` until ${away.until.slice(0, 10)}` : ""}.`;
        await ledger.putCard(clanTag, {
          ...c,
          status: "done",
          decided_at: new Date(t).toISOString(),
          decided_by: c.player_tag,
          decided_by_name: c.player_name ?? null,
          decision_note: note,
        });
        await logAction(clanTag, c.card_id, "completed", {
          by: { tag: c.player_tag, name: c.player_name ?? null, role: null },
          text: note,
        });
      } else if (!awayOn)
        await withdrawAction(
          clanTag,
          c,
          "The policy no longer asks quiet members.",
        );
      else if (!askAway.has(c.player_tag))
        await withdrawAction(clanTag, c, "They played again.");
    }
    for (const m of askAway.values()) {
      if (
        cards.some(
          (c) =>
            c.type === "away" &&
            c.player_tag === m.player_tag &&
            c.status === "proposed",
        )
      )
        continue;
      const days = Math.floor(m.removal.days_idle);
      await raiseAction(
        clanTag,
        {
          card_id: newId(),
          clan_tag: clanTag,
          player_tag: m.player_tag,
          player_name: m.name,
          role_at_raise: m.role,
          type: "away",
          status: "proposed",
          raised_at: new Date(t).toISOString(),
          policy_version: policy.version,
          evidence: {
            as_of: verdicts.as_of,
            days_idle: m.removal.days_idle,
            at_risk_days: m.removal.at_risk_days,
            away_max_days: policy.values.away_max_days,
          },
        },
        cards,
        {
          text: `${days} battle-free days, at risk from ${m.removal.at_risk_days}: asked whether they are away.`,
          detail: { clauses: ["away_suggestions_enabled", "at_risk_days"] },
        },
      );
    }
    // Departures the record shows and this ledger has not explained (a
    // removal card marked Done explains its own): one card each, Kicked /
    // Left / Ignore for a leader to say, when the policy asks for them.
    // The roster read is the source of the events; the previous snapshot
    // lends the member's last line. Switched off, open ones are withdrawn.
    if (!policy.values.departures_enabled) {
      for (const c of cards.filter(
        (c) => c.type === "departure" && c.status === "proposed",
      ))
        await withdrawAction(
          clanTag,
          c,
          "The policy no longer asks about departures.",
        );
    }
    if (!policy.values.welcome_enabled) {
      for (const c of cards.filter(
        (c) => c.type === "welcome" && c.status === "proposed",
      ))
        await withdrawAction(
          clanTag,
          c,
          "The policy no longer suggests welcomes.",
        );
    }
    if (!participation && roster && policy.values.welcome_enabled) {
      // Newcomers to welcome: elders and leaders get the action; it closes
      // itself if they leave first or after a week.
      const allCards = await ledger.cards(clanTag);
      const currentTags = new Set(
        (roster.members ?? []).map((m) => m.player_tag),
      );
      for (const c of allCards.filter(
        (c) => c.type === "welcome" && c.status === "proposed",
      )) {
        if (!currentTags.has(c.player_tag))
          await withdrawAction(clanTag, c, "They left before a welcome.");
        else if (t - Date.parse(c.evidence?.joined_at) > 7 * DAY_MS)
          await withdrawAction(clanTag, c, "Too long after they joined.");
      }
      for (const w of welcomesFrom(
        roster.recent_events,
        allCards,
        currentTags,
        new Date(t),
      ))
        await raiseAction(
          clanTag,
          {
            card_id: newId(),
            clan_tag: clanTag,
            player_tag: w.player_tag,
            player_name: w.player_name,
            role_at_raise: "member",
            type: "welcome",
            status: "proposed",
            raised_at: new Date(t).toISOString(),
            policy_version: policy.version,
            evidence: { joined_at: w.joined_at },
          },
          allCards,
          {
            text: `${w.player_name ?? w.player_tag} joined the clan ${w.joined_at.slice(0, 10)}.`,
            detail: { clauses: ["welcome_enabled"] },
          },
        );
    }
    if (!participation) {
      if (roster && policy.values.departures_enabled) {
        const lastKnown = new Map(
          (cached?.members ?? []).map((m) => [m.player_tag, m]),
        );
        const allCards = await ledger.cards(clanTag);
        const currentTags = new Set(
          (roster.members ?? []).map((m) => m.player_tag),
        );
        // An open departure card whose member is back is withdrawn: its
        // question no longer has an answer that is true.
        for (const c of allCards.filter(
          (c) =>
            c.type === "departure" &&
            c.status === "proposed" &&
            currentTags.has(c.player_tag),
        )) {
          await withdrawAction(clanTag, c, "The member rejoined the clan.");
        }
        for (const d of departuresFrom(
          roster.recent_events,
          allCards,
          lastKnown,
          currentTags,
        )) {
          await raiseAction(
            clanTag,
            {
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
                  d.last?.facts?.days_idle ??
                  d.last?.removal?.days_idle ??
                  null,
                tenure_days: d.last?.facts?.tenure_days ?? null,
                removal_state: d.last?.removal?.state ?? null,
                phrase: d.last
                  ? participationPhrase(d.last, policy.values)
                  : null,
              },
            },
            allCards,
            {
              text: `${d.player_name ?? d.last?.name ?? d.player_tag} left the clan ${d.left_at.slice(0, 10)} and no removal action explains it.`,
              detail: { clauses: ["departures_enabled"] },
            },
          );
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

    noteSize,

    /** Open actions this person may take, for the rail's count: a ledger
     *  read, no evaluation. */
    async openActionCount(clanTag, who) {
      if (!(await policyFor(clanTag)).set) return 0;
      const size = await ledger.clanSize(clanTag);
      if (size && size.members < MIN_MEMBERS) return 0;
      return (await ledger.cards(clanTag)).filter(
        (c) => c.status === "proposed" && canAct(c, who),
      ).length;
    },

    /**
     * Actions, for everyone in a clan with a policy: the open ones this
     * person may take (assigned to them, or open to their role), and the
     * ones closed in the last 30 days they could have taken, each with its
     * log. Opening it evaluates (five-minute cache), so actions are raised
     * by whoever looks first.
     */
    async actionsView(clanTag, who, token, { refresh = false } = {}) {
      const { verdicts, policy, cached } = await evaluateClan({
        clanTag,
        token,
        who,
        force: refresh,
      });
      const t = now();
      const byCard = await logsByCard(clanTag);
      const mine = (await ledger.cards(clanTag)).filter((c) => canAct(c, who));
      const closedAt = (c) => c.decided_at ?? c.withdrawn_at ?? c.raised_at;
      return {
        clan_tag: clanTag,
        evaluated_at: verdicts.evaluated_at,
        cached,
        as_of: verdicts.as_of,
        freshness_seconds: verdicts.freshness_seconds,
        policy_version: policy.version,
        open: mine
          .filter((c) => c.status === "proposed")
          .sort((a, b) => (a.raised_at < b.raised_at ? 1 : -1))
          .map((c) => shapeAction(c, byCard.get(c.card_id), who)),
        recent: mine
          .filter(
            (c) =>
              c.status !== "proposed" &&
              t - Date.parse(closedAt(c)) < 30 * DAY_MS,
          )
          .sort((a, b) => (closedAt(a) < closedAt(b) ? 1 : -1))
          .slice(0, 30)
          .map((c) => shapeAction(c, byCard.get(c.card_id), who)),
        decline_reasons: DECLINE_REASONS,
      };
    },

    /** A comment in an action's log, from anyone who may see the action,
     *  open or closed. */
    async comment(clanTag, who, cardId, text) {
      await requirePolicy(clanTag);
      const card = await ledger.card(clanTag, cardId);
      if (!card || !canAct(card, who)) throw new ManageError(404, "no_action");
      const body = String(text ?? "").trim();
      if (!body || body.length > 1000)
        throw new ManageError(400, "bad_comment");
      return logAction(clanTag, card.card_id, "comment", {
        by: person(who),
        text: body,
      });
    },

    /** What the chrome needs to know about the clan's policy: whether one
     *  is set, and the switches that decide which pages exist. */
    async policySummary(clanTag) {
      const policy = await policyFor(clanTag);
      const members = (await ledger.clanSize(clanTag))?.members ?? null;
      // Active: saved, and the clan not known to be below the minimum.
      const active = policy.set && !(members !== null && members < MIN_MEMBERS);
      return {
        set: policy.set,
        active,
        version: policy.version,
        members,
        min_members: MIN_MEMBERS,
        ranks_elder: active && ranksElder(policy.values),
        removal: active && policy.values.removal_enabled,
        away:
          active &&
          policy.values.removal_enabled &&
          policy.values.away_max_days > 0,
        members_see_standing:
          active && policy.values.members_see_standing === true,
      };
    },

    /** The policy editor's data: fields with help, groups, current values,
     *  versions, and whether the clan is big enough for a policy at all. */
    async policyView(clanTag, who, token = null) {
      const policy = await policyFor(clanTag);
      const members = await currentSize(clanTag, token);
      const versions = await ledger.policyVersions(clanTag);
      const names = await knownNames(clanTag);
      return {
        can_edit: isLeader(who),
        set: policy.set,
        members,
        min_members: MIN_MEMBERS,
        // Unknown (Elixir did not answer) never blocks; the save checks.
        big_enough: members === null || members >= MIN_MEMBERS,
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

    async savePolicy(clanTag, who, input, note, token = null) {
      requireLeader(who);
      const members = await currentSize(clanTag, token);
      if (members !== null && members < MIN_MEMBERS)
        throw tooFewMembers(members);
      const checked = validate(input);
      if (!checked.ok)
        throw Object.assign(new ManageError(400, "invalid_policy"), {
          errors: checked.errors,
        });
      const prior = await policyFor(clanTag);
      const before = prior.set ? prior.values : {};
      const saved = await ledger.savePolicy(clanTag, {
        values: checked.values,
        by: who.player_tag,
        by_name: who.name ?? null,
        note,
      });
      const changes = policyDiff(before, checked.values);
      await announceRules(clanTag, saved, prior.set ? changes : null);
      return { ...saved, changes };
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
      await noteSize(clanTag, r.body.members.length);
      if (r.body.members.length < MIN_MEMBERS)
        throw tooFewMembers(r.body.members.length);
      const current = await policyFor(clanTag);
      const roster =
        checked.values.trophies_enabled || current.values.trophies_enabled
          ? await fetchRoster(mcp, token, clanTag)
          : null;
      const at = new Date(now());
      const under = (values, version) => {
        const v = evaluate({
          participation: r.body,
          policy: values,
          now: at,
          policy_version: version,
          trophies: values.trophies_enabled ? trophiesFrom(roster) : null,
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
        // Before the first save there is nothing current to compare with.
        current: current.set ? under(current.values, current.version) : null,
        draft: under(checked.values, "draft"),
        changes: policyDiff(current.set ? current.values : {}, checked.values),
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
      const byCard = await logsByCard(clanTag);
      const inbox = cards
        .filter((c) => c.status === "proposed" && canAct(c, who))
        .sort((a, b) => (a.raised_at < b.raised_at ? 1 : -1))
        .map((c) => shapeAction(c, byCard.get(c.card_id), who));
      const board = verdicts.members.map((m) => ({
        player_tag: m.player_tag,
        name: m.name,
        role: m.role,
        judgment: m.judgment,
        judgment_reasons: judgmentReasons(
          m,
          verdicts.boundaries,
          policy.values,
        ),
        promotion: m.promotion,
        demotion: m.demotion,
        removal: m.removal,
        standing: m.standing,
        hold: holdByTag.get(m.player_tag) ?? null,
        phrase: participationPhrase(m, policy.values),
        facts: {
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
        policy: {
          ranks_elder: ranksElder(policy.values),
          removal: policy.values.removal_enabled,
          departures: policy.values.departures_enabled,
        },
        band: verdicts.band,
        roster: verdicts.roster ?? null,
        inbox,
        board,
        decline_reasons: DECLINE_REASONS,
      };
    },

    async history(clanTag, who, token = null) {
      requireLeader(who);
      await requirePolicy(clanTag);
      const allCards = await ledger.cards(clanTag);
      const byCard = await logsByCard(clanTag);
      const cards = allCards
        .filter((c) => c.status !== "proposed")
        .sort((a, b) => (a.raised_at < b.raised_at ? 1 : -1))
        .map((c) => shapeAction(c, byCard.get(c.card_id), who));
      // The membership timeline: Elixir's recent join / leave / role
      // events, each leave carrying what this ledger says about it, and
      // a welcome line a leader can paste for a join.
      const roster = token ? await fetchRoster(mcp, token, clanTag) : null;
      if (roster) await noteSize(clanTag, rosterSize(roster));
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
      await requirePolicy(clanTag);
      const card = await ledger.card(clanTag, cardId);
      // Only the people an action is for may take it (or see it at all).
      if (!card || !canAct(card, who)) {
        if (card && audienceOf(card).kind === "leaders")
          throw new ManageError(403, "leaders_only");
        throw new ManageError(404, "no_action");
      }
      // A decided action is frozen; a withdrawn one cannot be resurrected.
      if (card.status !== "proposed")
        throw new ManageError(409, "action_closed");
      // A departure is answered, never declined: Kicked, Left or Ignore.
      if (card.type === "departure") {
        if (!DEPARTURE_CLASSIFICATIONS.includes(classification))
          throw new ManageError(400, "bad_classification");
        status = "done";
      } else if (status !== "done" && status !== "declined")
        throw new ManageError(400, "bad_status");
      // Declining a judgment on a member says why; anything else may just
      // be no.
      if (
        status === "declined" &&
        !DECLINE_REASONS.includes(reason) &&
        !(!JUDGING_TYPES.has(card.type) && reason === null)
      )
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
      const channel = shapeAction(card, [], who).channel;
      await logAction(
        clanTag,
        card.card_id,
        status === "done" ? "completed" : "declined",
        {
          by: person(who),
          text: decided.decision_note,
          detail: {
            reason: decided.decline_reason,
            classification: decided.outcome?.classification ?? null,
            // Completing a leader-message action says the message was sent.
            ...(status === "done" && channel ? { channel } : {}),
          },
        },
      );
      return decided;
    },

    // ---- holds -----------------------------------------------------------
    async setHold(clanTag, who, playerTag, { until = null, note = null }) {
      requireLeader(who);
      await requirePolicy(clanTag);
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
      await requirePolicy(clanTag);
      await ledger.removeHold(clanTag, playerTag);
    },

    // ---- away: a member says so on their own page (2026-09-12). The
    // clock pauses like a leader's hold; the policy caps how long; a
    // leader can clear it; the board says it was the member's word.
    async myAway(clanTag, who) {
      const holds = await ledger.holds(clanTag);
      const mine = holds.find((h) => h.player_tag === who.player_tag) ?? null;
      const policy = await policyFor(clanTag);
      const allowed =
        policy.set &&
        policy.values.removal_enabled &&
        policy.values.away_max_days > 0;
      return {
        allowed,
        max_days: allowed ? policy.values.away_max_days : 0,
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
      if (!policy.set || !policy.values.removal_enabled || !(max > 0))
        throw new ManageError(403, "away_off");
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
      const hold = await ledger.putHold(clanTag, {
        player_tag: who.player_tag,
        kind: "away",
        until: new Date(untilMs).toISOString(),
        note: note ? String(note).slice(0, 200) : null,
        by: who.player_tag,
        by_name: who.name ?? null,
        set_at: new Date(t).toISOString(),
      });
      // Marking away completes the "going to be away?" action, if one is open.
      for (const c of (await ledger.cards(clanTag)).filter(
        (c) =>
          c.type === "away" &&
          c.status === "proposed" &&
          c.player_tag === who.player_tag,
      )) {
        const text = `Marked away until ${hold.until.slice(0, 10)}.`;
        await ledger.putCard(clanTag, {
          ...c,
          status: "done",
          decided_at: new Date(t).toISOString(),
          decided_by: who.player_tag,
          decided_by_name: who.name ?? null,
          decision_note: text,
        });
        await logAction(clanTag, c.card_id, "completed", {
          by: person(who),
          text,
        });
      }
      return hold;
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
      await requirePolicy(clanTag);
      const all = await ledger.notes(clanTag, playerTag);
      return all
        .filter((n) => n.tier === "elder" || isLeader(who))
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    },
    async addNote(clanTag, who, playerTag, text) {
      if (!ELDER_PLUS.has(who.role)) throw new ManageError(403, "elders_only");
      await requirePolicy(clanTag);
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
    /**
     * Every member of a clan with a policy sees how it runs, in their words
     * (`how`), and their own line; the list of where everyone stands is
     * there when Elder is ranked and the policy shows it to members (a
     * leader always sees it). Nothing is evaluated that the policy does
     * not use.
     */
    async standing(clanTag, who, token) {
      const policy = await requirePolicy(clanTag, { size: false });
      const how = describePolicy(policy.values);
      const ranked = ranksElder(policy.values);
      if (!ranked && !policy.values.removal_enabled) {
        // Nothing to evaluate: the noted size alone says whether it runs.
        await requirePolicy(clanTag);
        return {
          policy_version: policy.version,
          how,
          ranks_elder: false,
          rows: null,
          you: null,
        };
      }
      const { verdicts } = await evaluateClan({ clanTag, token, who });
      const showRows =
        ranked && (policy.values.members_see_standing || isLeader(who));
      const rows = ranked ? standingForMembers(verdicts, policy.values) : [];
      const mine =
        verdicts.members.find((m) => m.player_tag === who.player_tag) ?? null;
      const holds = await ledger.holds(clanTag);
      const myHold = holds.find((h) => h.player_tag === who.player_tag) ?? null;
      return {
        policy_version: policy.version,
        how,
        ranks_elder: ranked,
        as_of: verdicts.as_of,
        freshness_seconds: verdicts.freshness_seconds,
        rows: showRows ? rows : null,
        you: mine
          ? {
              status:
                rows.find((r) => r.player_tag === who.player_tag)?.status ??
                null,
              evidence: participationPhrase(mine, policy.values),
              next: nextSteps(mine, policy.values),
              inactivity: !policy.values.removal_enabled
                ? null
                : mine.removal.state === "none"
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
