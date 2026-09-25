/**
 * Standing and the Elder band, as a pure function of the facts at one
 * instant. Each category the policy weights is turned into a
 * participation percentile; the score is their weighted mix.
 *
 * Two populations, deliberately different. The band is a share of the
 * WHOLE active roster, leadership included. Rank, median and who can be
 * promoted run over the RANKED population (members + elders), because a
 * co-leader cannot be promoted to elder and should not dilute the median.
 */

import { elderWeights } from "./policy.mjs";

export const LEADERSHIP = new Set(["leader", "coLeader"]);

/** Mid-rank percentile of `value` within `values` (ties share the midpoint). */
export function percentile(value, values) {
  const n = values.length;
  if (n === 0) return 0;
  let below = 0;
  let equal = 0;
  for (const v of values) {
    if (v < value) below += 1;
    else if (v === value) equal += 1;
  }
  return (below + 0.5 * equal) / n;
}

/** Percentile for a metric where zero means did not participate: zero
 *  scores 0, participants are ranked against each other. */
export function participationPercentile(value, values) {
  if (!(value > 0)) return 0;
  return percentile(
    value,
    values.filter((v) => v > 0),
  );
}

/** Whether a member meets the policy's minimums (true with none set). */
export function passesMinimums(f) {
  return f.minimums.passes;
}

/** The value a category contributes, from a member's facts. */
const METRIC = {
  war: (f) => f.war.rate,
  ranked: (f) => f.ranked.battles,
  donations: (f) => f.donations.average ?? 0,
  trophies: (f) => f.trophies.count ?? 0,
};

/** Score every ranked member. Returns a Map tag -> score row. */
export function scores(facts, policy) {
  const weights = elderWeights(policy);
  const ranked = facts.filter((f) => !LEADERSHIP.has(f.role));
  const rows = new Map();
  for (const f of ranked) {
    const values = Object.fromEntries(
      Object.keys(weights).map((c) => [c, METRIC[c](f)]),
    );
    rows.set(f.player_tag, {
      player_tag: f.player_tag,
      name: f.name,
      role: f.role,
      tenure_days: f.tenure_days,
      tenure_known: f.tenure_known,
      values,
    });
  }
  const all = [...rows.values()];
  for (const r of rows.values()) {
    r.pct = {};
    r.score = 0;
    for (const [c, w] of Object.entries(weights)) {
      r.pct[c] = participationPercentile(
        r.values[c],
        all.map((x) => x.values[c]),
      );
      r.score += w * r.pct[c];
    }
  }
  return rows;
}

const byRank = (rows) =>
  [...rows.values()].sort(
    (a, b) =>
      b.score - a.score ||
      (b.tenure_days ?? 0) - (a.tenure_days ?? 0) ||
      (a.player_tag < b.player_tag ? -1 : 1),
  );

/**
 * The band and this instant's promotable / demotable sets.
 * `factsByTag` supplies the floor for eligibility; `rosterSize` is the
 * whole active roster, leadership included.
 */
export function band(rows, factsByTag, rosterSize, policy) {
  const order = byRank(rows);
  const n = order.length;
  const rank = new Map(order.map((r, i) => [r.player_tag, i + 1]));
  const floor = Math.round(policy.band_floor_share * rosterSize);
  const ceil = Math.round(policy.band_ceiling_share * rosterSize);
  const target = Math.round((floor + ceil) / 2);
  const currentElders = order.filter((r) => r.role === "elder").length;
  const sorted = order.map((r) => r.score).sort((a, b) => a - b);
  const median = n
    ? n % 2
      ? sorted[(n - 1) / 2]
      : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : 0;
  // Worthiness: at or above the policy's percentile of the ranked scores.
  // With the default 0.5 that is the median.
  const worthy = (r) => {
    if (policy.worthiness_percentile === 0.5) return r.score >= median;
    return percentile(r.score, sorted) >= policy.worthiness_percentile;
  };

  // Eligibility to HOLD elder: the minimums. To be promotable IN a member
  // also needs known tenure at or above the policy's; an unknown tenure is
  // never assumed.
  const eligible = (r) => {
    const f = factsByTag.get(r.player_tag);
    if (!f || !passesMinimums(f)) return false;
    if (r.role === "elder") return true;
    return r.tenure_known && (r.tenure_days ?? 0) >= policy.tenure_min_days;
  };
  const tenureUnknown = new Set(
    order
      .filter((r) => r.role !== "elder" && !r.tenure_known)
      .map((r) => r.player_tag),
  );
  const abandoned = new Set(
    order
      .filter(
        (r) =>
          r.role === "elder" && !passesMinimums(factsByTag.get(r.player_tag)),
      )
      .map((r) => r.player_tag),
  );
  const eligibleOrder = order.filter(eligible).map((r) => r.player_tag);
  const growLine = new Set(eligibleOrder.slice(0, target));
  const holdLine = new Set(eligibleOrder.slice(0, ceil));
  const shouldBe = new Set(
    [...growLine].filter(
      (t) => rows.get(t).role === "elder" || worthy(rows.get(t)),
    ),
  );
  const wantPromote = [...shouldBe].filter(
    (t) => rows.get(t).role === "member",
  );
  const outranked = order
    .filter(
      (r) =>
        r.role === "elder" &&
        !holdLine.has(r.player_tag) &&
        !abandoned.has(r.player_tag),
    )
    .map((r) => r.player_tag);

  const demoteReasons = new Map([...abandoned].map((t) => [t, "abandoned"]));
  const promotable = new Set();
  const demotable = new Set(abandoned);
  const swapDetail = [];
  // Pair ACROSS the line: weakest challenger against strongest outranked elder.
  const challengers = [...holdLine].filter(
    (t) => rows.get(t).role === "member" && worthy(rows.get(t)),
  );
  const outByRank = [...outranked].sort((a, b) => rank.get(a) - rank.get(b));
  const contenders = [...challengers]
    .sort((a, b) => rank.get(a) - rank.get(b))
    .slice(0, outByRank.length);
  const promByRank = [...contenders].sort((a, b) => rank.get(b) - rank.get(a));
  const paired = Math.min(promByRank.length, outByRank.length);
  for (let i = 0; i < paired; i += 1) {
    const m = promByRank[i];
    const e = outByRank[i];
    const margin = rows.get(m).score - rows.get(e).score;
    const closeCall = margin > 0 && margin < policy.swap_margin;
    const tenureWins =
      closeCall &&
      rows.get(m).tenure_known &&
      rows.get(e).tenure_known &&
      rows.get(m).tenure_days > rows.get(e).tenure_days;
    const swaps = margin >= policy.swap_margin || tenureWins;
    swapDetail.push({
      challenger: m,
      incumbent: e,
      margin: Number(margin.toFixed(4)),
      close_call: closeCall,
      tenure_wins: tenureWins,
      swaps,
    });
    if (swaps) {
      promotable.add(m);
      demotable.add(e);
      demoteReasons.set(e, "outranked");
    }
  }
  for (const e of outByRank.slice(paired)) {
    demotable.add(e);
    demoteReasons.set(e, "outranked");
  }
  // Growth into open seats: toward the target, then only close calls, never
  // past the ceiling.
  const held = currentElders - demotable.size + promotable.size;
  const growth = wantPromote
    .filter((t) => !promotable.has(t))
    .sort((a, b) => rank.get(a) - rank.get(b));
  const taken = [];
  for (const m of growth) {
    const used = held + taken.length;
    if (used >= ceil) break;
    if (used < target) {
      taken.push(m);
      continue;
    }
    const prev = taken.at(-1);
    if (!prev || rows.get(prev).score - rows.get(m).score >= policy.swap_margin)
      break;
    taken.push(m);
  }
  for (const t of taken) promotable.add(t);

  return {
    ranked_population: n,
    roster_size: rosterSize,
    floor,
    ceil,
    target,
    current_elders: currentElders,
    median,
    rank,
    order: order.map((r) => r.player_tag),
    eligible: new Set(eligibleOrder),
    tenure_unknown: tenureUnknown,
    abandoned,
    outranked: new Set(outranked),
    promotable,
    demotable,
    demote_reasons: demoteReasons,
    should_be: shouldBe,
    swaps: swapDetail,
  };
}
