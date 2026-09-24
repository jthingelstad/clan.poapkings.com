/**
 * Sentences from evidence. Two audiences, two vocabularies:
 *
 *  - leaders read a CARD: the verdict, the facts with their windows, the
 *    policy clause that fired (as a field key the editor links to);
 *  - members read STANDING: what they did, in a player's terms, and never
 *    a score, a percentile, a rank or the slot count (POLICY.md, "Talking
 *    about any of this"; elixir-bot's _ENGINE_INTERNALS_RES lists what
 *    leaked before).
 */

const pct = (x) => `${Math.round(x * 100)}%`;
const n = (x) =>
  x === null || x === undefined ? "unknown" : Math.round(x).toLocaleString();

/** Explain every fail-closed dimension, including snapshots already stored. */
export function judgmentReasons(v, boundaries) {
  const labels = {
    promotion: "Promotion",
    demotion: "Demotion",
    removal: "Removal",
  };
  const reasons = [];
  for (const [dimension, status] of Object.entries(v.judgment)) {
    const label = labels[dimension];
    if (status === "unknown") {
      reasons.push(
        `${label}: tenure unknown because the join predates the record.`,
      );
    } else if (status === "held") {
      const reason =
        v.facts?.floor?.log_recorded === false
          ? dimension === "removal"
            ? "battle log is not recorded, so inactivity cannot be measured"
            : "battle log is not recorded, so standing cannot be judged"
          : dimension === "removal"
            ? "no recorded battle or observed join anchors the clock"
            : boundaries.length === 0
              ? "no closed war review yet"
              : "war record incomplete in the review window";
      reasons.push(`${label} held: ${reason}.`);
    }
  }
  return reasons;
}

/** The member-safe phrase: "100% war decks over 4 war weeks, 12 ranked battles, ~213 donations a week". */
export function participationPhrase(v) {
  const f = v.facts;
  const bits = [];
  if (f.war.fidelity !== "unknown" && f.war.weeks > 0)
    bits.push(
      `${pct(f.war.rate)} war decks over ${f.war.weeks} war week${f.war.weeks === 1 ? "" : "s"}`,
    );
  if (f.ranked.battles > 0) bits.push(`${f.ranked.battles} ranked battles`);
  if (f.donations.average !== null && f.donations.average > 0)
    bits.push(`~${n(f.donations.average)} donations a week`);
  return bits.join(", ");
}

/** Facts for a card, each with its window and how it was known. */
export function cardFacts(v, policy) {
  const f = v.facts;
  const facts = [
    {
      key: "war",
      label: "War",
      value:
        f.war.fidelity === "unknown"
          ? "no war record in the window"
          : `${f.war.decks_played} of ${f.war.decks_asked} war decks (${pct(f.war.rate)})`,
      window: `last ${policy.war_rate_window_weeks} war weeks`,
      fidelity: f.war.fidelity,
    },
    {
      key: "ranked",
      label: "Ranked",
      value: `${f.ranked.battles} ranked battles`,
      window: `last ${policy.ranked_window_weeks} weeks`,
      fidelity: "daily",
    },
    {
      key: "donations",
      label: "Donations",
      value:
        f.donations.average === null
          ? "no snapshot in the window"
          : `~${n(f.donations.average)} a week (${f.donations.known_weeks} of ${f.donations.weeks} weeks known)`,
      window: `last ${policy.donation_window_weeks} weeks`,
      fidelity:
        f.donations.known_weeks === f.donations.weeks ? "daily" : "partial",
    },
    {
      key: "last_battle",
      label: "Last battle",
      value: f.last_battle_time
        ? `${f.days_idle} days ago`
        : f.joined_observed_at
          ? `none recorded since joining ${f.observed_days} days ago`
          : "unknown",
      window: "record",
      fidelity: f.last_battle_time ? "daily" : "unknown",
    },
    {
      key: "tenure",
      label: "In the clan",
      value: f.tenure_known
        ? `${f.tenure_days} days`
        : `at least ${f.observed_days ?? "?"} days (already here when recording began)`,
      window: "record",
      fidelity: f.tenure_known ? "daily" : "unknown",
    },
  ];
  return facts;
}

/** What a card says, and which policy fields decided it. */
export function cardRationale(type, v, policy, band) {
  if (type === "removal") {
    const r = v.removal;
    return {
      headline: `${r.days_idle} battle-free days: at risk at ${r.at_risk_days}, a card at ${r.at_risk_days + r.confirm_days}${r.grace_days ? ` (${r.grace_days} grace days for clearing the floor with ${band.open_slots} open slots)` : ""}.`,
      clauses: [
        "at_risk_days",
        "confirm_days",
        ...(r.grace_days ? ["contribution_grace_max_days"] : []),
      ],
    };
  }
  if (type === "promotion") {
    const s = v.standing;
    return {
      headline: `In the promotable set on ${v.promotion.weeks} weekly reviews (needs ${policy.promote_qualifying_weeks}); the corps holds ${band.current_elders} of a ${band.floor}-${band.ceil} band, target ${band.target}.`,
      clauses: [
        "promote_qualifying_weeks",
        "worthiness_percentile",
        s?.in_grow_line ? "band_ceiling_share" : "swap_margin",
      ],
    };
  }
  const reason = v.demotion.reason;
  return {
    headline:
      reason === "abandoned"
        ? `Failed both halves of the competitive floor on ${v.demotion.weeks} weekly reviews (needs ${policy.demote_abandoned_weeks}).`
        : `Outranked past the ceiling on ${v.demotion.weeks} weekly reviews (needs ${policy.demote_outranked_weeks}); a higher-ranked member takes the seat.`,
    clauses:
      reason === "abandoned"
        ? ["demote_abandoned_weeks", "floor_war_decks", "floor_ranked_battles"]
        : ["demote_outranked_weeks", "band_ceiling_share", "swap_margin"],
  };
}

/**
 * The member-facing standing list: holding, rising, slipping, each with the
 * member-safe phrase. Never scores, percentiles, ranks or the slot count.
 */
export function standingForMembers(verdicts) {
  const rows = verdicts.members
    .filter((m) => m.role === "member" || m.role === "elder")
    .map((m) => ({
      player_tag: m.player_tag,
      name: m.name,
      role: m.role,
      status:
        m.role === "elder"
          ? m.demotion.state === "eligible" || m.demotion.state === "building"
            ? "slipping"
            : "holding"
          : m.promotion.state === "eligible" || m.promotion.state === "building"
            ? "rising"
            : m.standing?.passes_floor
              ? "participating"
              : "quiet",
      evidence: participationPhrase(m),
      judgment:
        m.judgment.promotion === "not_applicable"
          ? m.judgment.demotion
          : m.judgment.promotion,
    }));
  const order = {
    holding: 0,
    slipping: 1,
    rising: 2,
    participating: 3,
    quiet: 4,
  };
  rows.sort(
    (a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name),
  );
  return rows;
}

/** The one or two things that would move a member's standing. */
export function nextSteps(v, policy) {
  const f = v.facts;
  const steps = [];
  if (v.role !== "member") return steps;
  if (!f.tenure_known)
    steps.push(
      "Your join predates the record, so tenure is unknown here until the days accrue.",
    );
  else if (f.tenure_days < policy.tenure_min_days)
    steps.push(
      `${policy.tenure_min_days - f.tenure_days} more days in the clan before Elder consideration.`,
    );
  if (!f.floor.passes_war && !f.floor.passes_ranked)
    steps.push(
      `Clear the floor: ${policy.floor_war_decks} war deck${policy.floor_war_decks === 1 ? "" : "s"} played, or ${policy.floor_ranked_battles} ranked battles, in ${policy.floor_window_weeks} weeks.`,
    );
  if (f.war.fidelity !== "unknown" && f.war.rate < 1)
    steps.push(
      "Play every war deck: four a war day, sixteen a week (twelve when the boat finishes on day 3).",
    );
  steps.push(
    "Once our boat crosses the finish line, the rest of that week's war days are optional: playing them still counts for you, and skipping them never counts against you.",
  );
  if (f.donations.average !== null && f.donations.average < 100)
    steps.push(
      "Donate weekly; the average over four weeks counts, not one big week.",
    );
  return steps.slice(0, 2);
}

/**
 * Paste-ready in-game copy for a card or a timeline moment: the bot's
 * relay cards without the bot. Plain sentences a leader can drop in clan
 * chat as they are or edit first. Clan chat clips at 200 characters and
 * the game's filter censors "&" and "+" followed by digits, so neither
 * appears here (elixir-bot's clan_chat_copy guardrail).
 */
export function inGameCopy(kind, { name, days_idle = null, phrase = "" } = {}) {
  const who = String(name ?? "a member")
    .replace(/[&+]/g, " ")
    .trim();
  const text = {
    promotion: `Congrats ${who}, promoted to Elder for showing up: ${phrase || "war days played, ranked battles, donations"}. Keep it going.`,
    demotion: `${who} steps down from Elder for now: participation slipped over the last weeks. Play war days and it comes back.`,
    removal: `${who} was removed for inactivity (${days_idle === null ? "a long stretch" : `${Math.round(days_idle)} days`} without a battle). Always welcome back when you are playing again.`,
    welcome: `Welcome ${who}! Play your war days and donate; that is how Elder works here.`,
    farewell: `Thanks for your time with us ${who}, good luck out there.`,
  }[kind];
  if (!text) return null;
  return text.length > 200 ? `${text.slice(0, 197).trimEnd()}...` : text;
}
