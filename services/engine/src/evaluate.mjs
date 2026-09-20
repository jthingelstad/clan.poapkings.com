/**
 * verdicts = evaluate(record, policy, now, decisions)
 *
 * A pure function. elixir-bot kept weekly counters because its database
 * rolled forward; Elixir records, so "in the promotable set on three
 * separate weekly reviews" is computed here by replaying the band at
 * each past weekly boundary from history. Nothing is stored between runs
 * except decisions and holds, which are inputs.
 *
 * Weekly boundaries are the instants the record saw each war week finish
 * (the game's own Monday reset, observed), newest last; the current
 * instant is judged separately for the removal clock and the standing a
 * leader sees today.
 */

import { factsAt } from "./facts.mjs";
import { band, scores, passesFloor, LEADERSHIP } from "./standing.mjs";

export const ELDER_PLUS = new Set(["elder", "coLeader", "leader"]);
const DAY_MS = 86400_000;

export const CARD_TYPES = ["promotion", "demotion", "removal"];

/** The weekly review instants inside the record, oldest first. */
export function reviewBoundaries(participation, now, limit) {
  const nowMs = now.getTime();
  const finished = participation.war_weeks
    .map((w) =>
      w.finished_observed_at ? Date.parse(w.finished_observed_at) : null,
    )
    .filter((t) => t !== null && t <= nowMs)
    .sort((a, b) => a - b);
  return finished.slice(-limit).map((t) => new Date(t));
}

function holdActive(hold, nowMs) {
  if (!hold) return false;
  if (!hold.until) return true;
  return Date.parse(hold.until) > nowMs;
}

/** Days until which a declined card blocks re-nomination, or null. */
function blockedUntil(decisions, tag, type, cooldownDays) {
  const mine = decisions
    .filter((d) => d.player_tag === tag && d.type === type && d.decided_at)
    .sort((a, b) => Date.parse(b.decided_at) - Date.parse(a.decided_at));
  const last = mine[0];
  if (!last || last.status !== "declined") return null;
  let until = Date.parse(last.decided_at) + cooldownDays * DAY_MS;
  if (last.expires_at && Date.parse(last.expires_at) > until)
    until = Date.parse(last.expires_at);
  return new Date(until).toISOString();
}

/**
 * elixir-bot's promotion and demotion machines, replayed over a trail of
 * weekly gates (oldest first). Exported so the hysteresis has its own tests.
 * @param {Array<{promotable:boolean, demotable:boolean, reason:string|null, role:string}>} trail
 */
export function replayMachines(trail, policy) {
  let pState = "none";
  let pWeeks = 0;
  let pMiss = 0;
  let dState = "none";
  let dWeeks = 0;
  let dReason = null;
  for (const step of trail) {
    const gate = step.promotable;
    const dGate = step.demotable;
    const reason = step.reason ?? null;
    const roleThen = step.role ?? "member";
    if (pState === "none") {
      if (gate) {
        pState = "building";
        pWeeks = 1;
        pMiss = 0;
      }
    } else if (pState === "building") {
      if (gate) {
        pWeeks += 1;
        pMiss = 0;
      } else {
        pMiss += 1;
        if (pMiss >= 2) {
          pState = "none";
          pWeeks = 0;
          pMiss = 0;
        }
      }
      if (pState === "building" && pWeeks >= policy.promote_qualifying_weeks)
        pState = "eligible";
    } else if (pState === "eligible") {
      if (gate) pMiss = 0;
      else {
        pMiss += 1;
        if (pMiss >= 2) {
          pState = "building";
          pWeeks = Math.max(0, Math.floor(pWeeks / 2));
          pMiss = 0;
        }
      }
    }
    if (pState === "eligible" && roleThen !== "member") {
      pState = "none";
      pWeeks = 0;
      pMiss = 0;
    }
    const threshold =
      reason === "abandoned"
        ? policy.demote_abandoned_weeks
        : policy.demote_outranked_weeks;
    if (dGate) {
      dWeeks += 1;
      dReason = reason;
      dState = dWeeks >= threshold ? "eligible" : "building";
    } else {
      dState = "none";
      dWeeks = 0;
      dReason = null;
    }
    if (dState === "eligible" && roleThen !== "elder") {
      dState = "none";
      dWeeks = 0;
    }
  }
  return { pState, pWeeks, pMiss, dState, dWeeks, dReason };
}

/**
 * @param {object} input
 * @param {object} input.participation clans_participation answer
 * @param {object} input.policy validated policy values
 * @param {Date}   input.now
 * @param {Array}  [input.decisions] decided cards: { player_tag, type, status, decided_at, expires_at? }
 * @param {Array}  [input.holds] { player_tag, until|null }
 * @param {string} [input.policy_version]
 */
export function evaluate({
  participation,
  policy,
  now,
  decisions = [],
  holds = [],
  policy_version = null,
}) {
  const nowMs = now.getTime();
  const rosterSize = participation.members.length;
  const holdByTag = new Map(holds.map((h) => [h.player_tag, h]));
  const maxWeeks = Math.max(
    policy.promote_qualifying_weeks,
    policy.demote_outranked_weeks,
    policy.demote_abandoned_weeks,
  );
  // Enough boundaries to see a reset (two misses) and a full qualifying run.
  const boundaries = reviewBoundaries(participation, now, maxWeeks + 3);

  // Replay the band at each boundary.
  const reviews = boundaries.map((at) => {
    const facts = factsAt(participation, policy, at);
    const byTag = new Map(facts.map((f) => [f.player_tag, f]));
    const rows = scores(facts, policy);
    const b = band(rows, byTag, rosterSize, policy);
    return { at, facts: byTag, rows, band: b };
  });

  // Today's facts and standing.
  const factsNow = factsAt(participation, policy, now);
  const byTagNow = new Map(factsNow.map((f) => [f.player_tag, f]));
  const rowsNow = scores(factsNow, policy);
  const bandNow = band(rowsNow, byTagNow, rosterSize, policy);
  const slack = Math.max(0, policy.roster_cap - rosterSize) / policy.roster_cap;

  const members = factsNow.map((f) => {
    const tag = f.player_tag;
    const row = rowsNow.get(tag) ?? null;
    const hold = holdByTag.get(tag) ?? null;
    const onHold = holdActive(hold, nowMs);

    // ---- promotion / demotion machines, replayed over the boundaries ----
    const trail = reviews.map((r) => ({
      at: r.at.toISOString(),
      promotable: r.band.promotable.has(tag),
      demotable: r.band.demotable.has(tag),
      reason: r.band.demote_reasons.get(tag) ?? null,
      role: r.facts.get(tag)?.role ?? "member",
      rank: r.band.rank.get(tag) ?? null,
      score: r.rows.get(tag)?.score ?? null,
    }));
    let { pState, pWeeks, pMiss, dState, dWeeks, dReason } = replayMachines(
      trail,
      policy,
    );
    // A member holding the role already needs no card either way.
    if (f.role !== "member") {
      pState = "none";
      pWeeks = 0;
    }
    if (f.role !== "elder") {
      dState = "none";
      dWeeks = 0;
      dReason = null;
    }

    // ---- readiness (fail closed) ----
    const latest = reviews.at(-1);
    const latestFacts = latest?.facts.get(tag) ?? f;
    const promotionJudgment = LEADERSHIP.has(f.role)
      ? "not_applicable"
      : !policy.elder_management_enabled
        ? "off"
        : !f.tenure_known && f.role === "member"
          ? "unknown"
          : latestFacts.floor.log_recorded === false ||
              reviews.length === 0 ||
              latestFacts.war.fidelity === "unknown"
            ? "held"
            : "ready";
    const demotionJudgment =
      f.role !== "elder"
        ? "not_applicable"
        : !policy.elder_management_enabled
          ? "off"
          : latestFacts.floor.log_recorded === false ||
              reviews.length === 0 ||
              latestFacts.floor.war_fidelity === "unknown"
            ? "held"
            : "ready";

    // ---- removal clock, at now ----
    let confirmDays = policy.confirm_days;
    let graceDays = 0;
    if (slack > 0 && passesFloor(f)) {
      graceDays = Math.round(policy.contribution_grace_max_days * slack);
      confirmDays += graceDays;
    }
    let rState = "none";
    if (f.days_idle !== null) {
      if (f.days_idle >= policy.at_risk_days + confirmDays)
        rState = "recommended";
      else if (f.days_idle >= policy.at_risk_days) rState = "at_risk";
      else if (f.days_idle >= policy.watch_days) rState = "watch";
    }
    let shielded = null;
    if (rState === "recommended") {
      if (ELDER_PLUS.has(f.role)) shielded = "role";
      else if (onHold) shielded = "hold";
      else if (!policy.removal_enabled) shielded = "policy";
      if (shielded) rState = "at_risk";
    }
    const removalJudgment =
      f.floor.log_recorded === false || f.days_idle === null
        ? "held"
        : !policy.removal_enabled
          ? "off"
          : "ready";

    // ---- cooldowns from decisions ----
    const cooldown = {
      promotion: blockedUntil(
        decisions,
        tag,
        "promotion",
        policy.renominate_promotion_days,
      ),
      demotion: blockedUntil(
        decisions,
        tag,
        "demotion",
        policy.renominate_demotion_days,
      ),
      removal: blockedUntil(
        decisions,
        tag,
        "removal",
        policy.renominate_removal_days,
      ),
    };
    const past = (t) => !cooldown[t] || Date.parse(cooldown[t]) <= nowMs;

    const actionable = {
      promotion:
        promotionJudgment === "ready" &&
        pState === "eligible" &&
        bandNow.promotable.has(tag) &&
        past("promotion"),
      demotion:
        demotionJudgment === "ready" &&
        dState === "eligible" &&
        bandNow.demotable.has(tag) &&
        past("demotion"),
      removal:
        removalJudgment === "ready" &&
        rState === "recommended" &&
        past("removal"),
    };

    return {
      player_tag: tag,
      name: f.name,
      role: f.role,
      judgment: {
        promotion: promotionJudgment,
        demotion: demotionJudgment,
        removal: removalJudgment,
      },
      facts: f,
      standing: row
        ? {
            score: Number(row.score.toFixed(4)),
            competitive: Number(row.competitive.toFixed(4)),
            war_pct: Number(row.war_pct.toFixed(4)),
            ranked_pct: Number(row.ranked_pct.toFixed(4)),
            donation_pct: Number(row.donation_pct.toFixed(4)),
            rank: bandNow.rank.get(tag) ?? null,
            eligible: bandNow.eligible.has(tag),
            worthy: bandNow.should_be.has(tag) || row.score >= bandNow.median,
            passes_floor: passesFloor(f),
            in_grow_line: bandNow.promotable.has(tag),
          }
        : null,
      promotion: {
        state: pState,
        weeks: pWeeks,
        misses: pMiss,
        promotable_now: bandNow.promotable.has(tag),
        cooldown_until: cooldown.promotion,
      },
      demotion: {
        state: dState,
        weeks: dWeeks,
        reason: dReason ?? bandNow.demote_reasons.get(tag) ?? null,
        demotable_now: bandNow.demotable.has(tag),
        cooldown_until: cooldown.demotion,
      },
      removal: {
        state: rState,
        days_idle: f.days_idle,
        at_risk_days: policy.at_risk_days,
        confirm_days: confirmDays,
        grace_days: graceDays,
        shielded,
        cooldown_until: cooldown.removal,
      },
      hold: hold ? { ...hold, active: onHold } : null,
      actionable,
      trail,
    };
  });

  return {
    evaluated_at: now.toISOString(),
    policy_version,
    // The clan's name as clans_participation reported it, so a page with
    // no session to ask (How Elder works here) can still say who.
    clan_name: participation.name ?? null,
    as_of: participation.meta?.as_of ?? null,
    freshness_seconds: participation.meta?.freshness_seconds ?? null,
    recording_active_since: participation.recording_active_since ?? null,
    first_roster_observed_at: participation.first_roster_observed_at ?? null,
    boundaries: boundaries.map((b) => b.toISOString()),
    band: {
      roster_size: rosterSize,
      ranked_population: bandNow.ranked_population,
      floor: bandNow.floor,
      target: bandNow.target,
      ceil: bandNow.ceil,
      current_elders: bandNow.current_elders,
      median: Number(bandNow.median.toFixed(4)),
      open_slots: Math.max(0, policy.roster_cap - rosterSize),
      swaps: bandNow.swaps,
    },
    members,
  };
}

/**
 * Card reconciliation: given verdicts and the open cards, which cards to
 * raise and which to withdraw. One open card per (member, type).
 */
export function reconcileCards(verdicts, openCards) {
  const open = new Map(openCards.map((c) => [`${c.player_tag}|${c.type}`, c]));
  const raise = [];
  const withdraw = [];
  for (const m of verdicts.members) {
    for (const type of CARD_TYPES) {
      const key = `${m.player_tag}|${type}`;
      const card = open.get(key);
      if (m.actionable[type]) {
        if (!card) raise.push({ player_tag: m.player_tag, type, verdict: m });
      } else if (card) {
        withdraw.push({ card, reason: withdrawReason(type, m) });
      }
    }
  }
  return { raise, withdraw };
}

function withdrawReason(type, m) {
  if (type === "removal") {
    if (m.removal.shielded === "hold") return "The member is on hold.";
    if (m.removal.state === "none" || m.removal.state === "watch")
      return "The member played; the inactivity clock reset.";
    if (m.judgment.removal !== "ready")
      return "The evidence went stale; the clock is held.";
    return "The removal no longer qualifies under the policy.";
  }
  if (type === "promotion") {
    if (m.role !== "member") return "The role changed.";
    if (m.judgment.promotion !== "ready") return "The evidence is held.";
    return "No longer in the promotable set on sustained reviews.";
  }
  if (m.role !== "elder") return "The role changed.";
  if (m.judgment.demotion !== "ready") return "The evidence is held.";
  return "No longer demotable on sustained reviews.";
}
