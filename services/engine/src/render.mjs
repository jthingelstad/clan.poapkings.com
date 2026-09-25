/**
 * Sentences from evidence and from the clan's own policy. Two audiences,
 * two vocabularies:
 *
 *  - leaders read a CARD: the verdict, the facts with their windows, the
 *    policy clause that fired (as a field key the editor links to);
 *  - members read STANDING and HOW IT WORKS HERE: what they did and what
 *    this clan counts, in a player's terms, and never a score, a
 *    percentile, a rank or the slot count.
 *
 * Every sentence follows the policy: a category the clan does not count is
 * never mentioned, and nothing here describes how any clan should run.
 */

import {
  CATEGORY_LABELS,
  countedCategories,
  elderWeights,
  ranksElder,
  setMinimums,
} from "./policy.mjs";
import { POSTURES, declaredGoals, goalsInSentence } from "./goals.mjs";

const pct = (x) => `${Math.round(x * 100)}%`;
const n = (x) =>
  x === null || x === undefined ? "unknown" : Math.round(x).toLocaleString();
const plural = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/** "a, b and c" / "a, b or c". */
function list(items, joiner = "and") {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${joiner} ${items.at(-1)}`;
}

/** Explain every fail-closed dimension, including snapshots already stored. */
export function judgmentReasons(v, boundaries, policy = null) {
  const weights = policy ? elderWeights(policy) : {};
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
      const minimums = v.facts?.minimums;
      const reason =
        minimums?.log_recorded === false
          ? dimension === "removal"
            ? "battle log is not recorded, so inactivity cannot be measured"
            : "battle log is not recorded, so standing cannot be judged"
          : dimension === "removal"
            ? "no recorded battle or observed join anchors the clock"
            : boundaries.length === 0
              ? "no closed weekly review yet"
              : (weights.war ?? 0) > 0 && v.facts?.war?.fidelity === "unknown"
                ? "war record incomplete in the review window"
                : (weights.trophies ?? 0) > 0 &&
                    v.facts?.trophies?.count == null
                  ? "trophies are not in the latest roster read"
                  : minimums?.unknown
                    ? "the record cannot say whether the minimums are met"
                    : "the record is incomplete in the review window";
      reasons.push(`${label} held: ${reason}.`);
    }
  }
  return reasons;
}

/** The member-safe phrase for what the clan counts:
 *  "100% war decks over 4 war weeks, 12 ranked battles, ~213 donations a week". */
export function participationPhrase(v, policy) {
  const f = v.facts;
  const counted = new Set(countedCategories(policy));
  const bits = [];
  if (counted.has("war") && f.war.fidelity !== "unknown" && f.war.weeks > 0)
    bits.push(
      `${pct(f.war.rate)} war decks over ${plural(f.war.weeks, "war week")}`,
    );
  if (counted.has("ranked") && f.ranked.battles > 0)
    bits.push(`${f.ranked.battles} ranked battles`);
  if (
    counted.has("donations") &&
    f.donations.average !== null &&
    f.donations.average > 0
  )
    bits.push(`~${n(f.donations.average)} donations a week`);
  if (counted.has("trophies") && f.trophies?.count != null)
    bits.push(`${n(f.trophies.count)} trophies`);
  return bits.join(", ");
}

/** Facts for a card, each with its window and how it was known. */
export function cardFacts(v, policy) {
  const f = v.facts;
  const counted = new Set(countedCategories(policy));
  const facts = [];
  if (counted.has("war"))
    facts.push({
      key: "war",
      label: "War",
      value:
        f.war.fidelity === "unknown"
          ? "no war record in the window"
          : `${f.war.decks_played} of ${f.war.decks_asked} war decks (${pct(f.war.rate)})`,
      window: `last ${policy.war_window_weeks} war weeks`,
      fidelity: f.war.fidelity,
    });
  if (counted.has("ranked"))
    facts.push({
      key: "ranked",
      label: "Ranked",
      value: `${f.ranked.battles} ranked battles`,
      window: `last ${policy.ranked_window_weeks} weeks`,
      fidelity: f.minimums.log_recorded === false ? "unknown" : "daily",
    });
  if (counted.has("donations"))
    facts.push({
      key: "donations",
      label: "Donations",
      value:
        f.donations.average === null
          ? "no snapshot in the window"
          : `~${n(f.donations.average)} a week (${f.donations.known_weeks} of ${f.donations.weeks} weeks known)`,
      window: `last ${policy.donations_window_weeks} weeks`,
      fidelity:
        f.donations.known_weeks === f.donations.weeks ? "daily" : "partial",
    });
  if (counted.has("trophies"))
    facts.push({
      key: "trophies",
      label: "Trophies",
      value:
        f.trophies?.count == null
          ? "not in the latest roster read"
          : `${n(f.trophies.count)} trophies`,
      window: "today",
      fidelity: f.trophies?.count == null ? "unknown" : "daily",
    });
  facts.push(
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
  );
  return facts;
}

/** The policy fields each minimum is set by. */
const MINIMUM_FIELD = {
  war: "war_min_decks",
  ranked: "ranked_min_battles",
  donations: "donations_min_weekly",
  trophies: "trophies_min",
};

/** What a card says, and which policy fields decided it. */
export function cardRationale(type, v, policy, verdicts) {
  if (type === "removal") {
    const r = v.removal;
    const slots = verdicts?.roster?.open_slots ?? verdicts?.band?.open_slots;
    return {
      headline: `${r.days_idle} battle-free days: at risk at ${r.at_risk_days}, an action at ${r.at_risk_days + r.confirm_days}${r.grace_days ? ` (${r.grace_days} grace days for meeting the minimums with ${slots} open slots)` : ""}.`,
      clauses: [
        "at_risk_days",
        "confirm_days",
        ...(r.grace_days ? ["contribution_grace_max_days"] : []),
      ],
    };
  }
  const band = verdicts?.band ?? {};
  if (type === "promotion") {
    const s = v.standing;
    return {
      headline: `In the promotable set on ${v.promotion.weeks} weekly reviews (needs ${policy.promote_qualifying_weeks}); Elders hold ${band.current_elders} of a ${band.floor}-${band.ceil} band, target ${band.target}.`,
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
        ? `Missed the minimums on ${v.demotion.weeks} weekly reviews (needs ${policy.demote_abandoned_weeks}).`
        : `Outranked past the upper share on ${v.demotion.weeks} weekly reviews (needs ${policy.demote_outranked_weeks}); a higher-ranked member takes the seat.`,
    clauses:
      reason === "abandoned"
        ? [
            "demote_abandoned_weeks",
            ...Object.keys(setMinimums(policy)).map((c) => MINIMUM_FIELD[c]),
          ]
        : ["demote_outranked_weeks", "band_ceiling_share", "swap_margin"],
  };
}

/**
 * The member-facing standing list: holding, rising, slipping, each with the
 * member-safe phrase. Never scores, percentiles, ranks or the slot count.
 */
export function standingForMembers(verdicts, policy) {
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
            : m.standing?.passes_minimums
              ? "participating"
              : "quiet",
      evidence: participationPhrase(m, policy),
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

/** A minimum in a player's words: "4 war decks". */
function minimumPhrase(category, value) {
  if (category === "war") return plural(value, "war deck");
  if (category === "ranked") return plural(value, "ranked battle");
  if (category === "donations") return `${n(value)} donations a week`;
  return `${n(value)} trophies`;
}

/** The one or two things that would move a member's standing, from what
 *  this clan counts and where the member is lowest. */
export function nextSteps(v, policy) {
  const f = v.facts;
  const steps = [];
  if (v.role !== "member" || !ranksElder(policy)) return steps;
  if (!f.tenure_known)
    steps.push(
      "Your join predates the record, so tenure is unknown here until the days accrue.",
    );
  else if (f.tenure_days < policy.tenure_min_days)
    steps.push(
      `${policy.tenure_min_days - f.tenure_days} more days in the clan before Elder consideration.`,
    );
  const minimums = setMinimums(policy);
  if (!f.minimums.passes && Object.keys(minimums).length)
    steps.push(
      `Meet the minimums: ${list(
        Object.entries(minimums).map(([c, value]) => minimumPhrase(c, value)),
        policy.minimums_rule === "all" ? "and" : "or",
      )} in ${plural(policy.minimums_window_weeks, "week")}.`,
    );
  // Where the member is lowest among what counts most.
  const weights = elderWeights(policy);
  const pctOf = v.standing?.pct ?? {};
  const weakest = Object.entries(weights)
    .filter(([c]) => (pctOf[c] ?? 0) < 0.5)
    .sort(
      (a, b) =>
        b[1] * (1 - (pctOf[b[0]] ?? 0)) - a[1] * (1 - (pctOf[a[0]] ?? 0)),
    )
    .map(([c]) => c);
  const advice = {
    war: "Play the war decks you are asked for: four a war day, up to the clan's finish.",
    ranked: `Play ranked battles: ${CATEGORY_LABELS.ranked.toLowerCase()} counts here.`,
    donations: `Donate every week: the average over ${plural(policy.donations_window_weeks, "week")} counts, not one big week.`,
    trophies: "Climb trophy road: trophies count here.",
  };
  for (const c of weakest) steps.push(advice[c]);
  return steps.slice(0, 2);
}

/**
 * How this clan runs, in a member's words, straight from its policy: what
 * it counts, how Elder is chosen, what the minimums are, and whether
 * inactivity is tracked. Sections a policy leaves off are omitted.
 * Never a score, a percentile, a margin or the slot count.
 */
export function describePolicy(policy) {
  const sections = [];
  const counted = countedCategories(policy);
  const weights = elderWeights(policy);
  const minimums = setMinimums(policy);
  const goals = declaredGoals(policy);
  if (goals.length)
    sections.push({
      key: "about",
      title: "About this clan",
      lines: [
        `This clan is about ${goalsInSentence(goals)}.`,
        ...(POSTURES[policy.posture]
          ? [
              `${POSTURES[policy.posture].label}. ${POSTURES[policy.posture].about}`,
            ]
          : []),
      ],
    });
  const window = (c) =>
    c === "war"
      ? `war decks played over war decks asked for across the last ${plural(policy.war_window_weeks, "war week")} (four a war day up to the clan's finish; Colosseum asks every day)`
      : c === "ranked"
        ? `ranked battles over the last ${plural(policy.ranked_window_weeks, "week")}`
        : c === "donations"
          ? `the weekly donation average over the last ${plural(policy.donations_window_weeks, "week")}`
          : "trophies today";

  if (counted.length)
    sections.push({
      key: "counts",
      title: "What this clan counts",
      lines: counted.map((c) => `${CATEGORY_LABELS[c]}: ${window(c)}.`),
    });

  if (Object.keys(minimums).length)
    sections.push({
      key: "minimums",
      title: "Minimums",
      lines: [
        `${policy.minimums_rule === "all" ? "All of" : "Any one of"}: ${list(
          Object.entries(minimums).map(([c, value]) => minimumPhrase(c, value)),
          policy.minimums_rule === "all" ? "and" : "or",
        )}, over ${plural(policy.minimums_window_weeks, "week")}.`,
      ],
    });

  if (!ranksElder(policy))
    sections.push({
      key: "elder",
      title: "Elder",
      lines: ["Leaders choose Elders."],
    });
  else {
    const shares = Object.entries(weights)
      .sort((a, b) => b[1] - a[1])
      .map(([c, w]) => `${CATEGORY_LABELS[c]} ${pct(w)}`);
    sections.push({
      key: "elder",
      title: "Elder",
      lines: [
        `Elder is earned by participation, compared across the clan's members and Elders: ${list(shares)}.`,
        `To be considered: ${plural(policy.tenure_min_days, "day")} in the clan${Object.keys(minimums).length ? " and the minimums" : ""}.`,
        `Elders are between ${pct(policy.band_floor_share)} and ${pct(policy.band_ceiling_share)} of the roster.`,
        `A promotion needs ${plural(policy.promote_qualifying_weeks, "weekly review")}; an Elder steps down after ${policy.demote_abandoned_weeks} ${Object.keys(minimums).length ? "reviews missing the minimums, or " : ""}${plural(policy.demote_outranked_weeks, "review")} outranked while the seat is needed.`,
      ],
    });
  }

  if (policy.removal_enabled) {
    const lines = [
      `A member with no battle for ${plural(policy.at_risk_days, "day")} is at risk; after ${plural(policy.at_risk_days + policy.confirm_days, "day")} the leaders decide on removal.`,
    ];
    if (policy.contribution_grace_max_days > 0)
      lines.push(
        `Meeting the minimums earns up to ${plural(policy.contribution_grace_max_days, "extra day")} while the clan is not full.`,
      );
    if (policy.away_max_days > 0)
      lines.push(
        `Going to be away? Mark it on your Away page for up to ${plural(policy.away_max_days, "day")} and your clock pauses.`,
      );
    if (policy.away_max_days > 0 && policy.away_suggestions_enabled)
      lines.push(
        "If your clock reaches at risk, you are asked on your Actions page whether you are away.",
      );
    lines.push(
      policy.removal_includes_elders
        ? "This applies to Elders too."
        : "Elders are not removed for inactivity.",
    );
    sections.push({ key: "removal", title: "Inactivity", lines });
  }
  if (policy.welcome_enabled)
    sections.push({
      key: "welcome",
      title: "Newcomers",
      lines: ["Elders and leaders are asked to welcome every newcomer."],
    });
  return sections;
}

/**
 * Paste-ready in-game copy for a card or a timeline moment: plain
 * sentences a leader can drop in clan chat as they are or edit first.
 * Clan chat clips at 200 characters and the game's filter censors "&" and
 * "+" followed by digits, so neither appears here.
 */
export function inGameCopy(kind, { name, days_idle = null, phrase = "" } = {}) {
  const who = String(name ?? "a member")
    .replace(/[&+]/g, " ")
    .trim();
  const text = {
    promotion: `Congrats ${who}, promoted to Elder${phrase ? `: ${phrase}` : ""}.`,
    demotion: `${who} moves from Elder back to Member for now. It can come back.`,
    removal: `${who} was removed for inactivity (${days_idle === null ? "a long stretch" : `${Math.round(days_idle)} days`} without a battle). Welcome back any time you are playing again.`,
    welcome: `Welcome to the clan, ${who}!`,
    farewell: `Thanks for your time with us ${who}, good luck out there.`,
  }[kind];
  if (!text) return null;
  const safe = text.replace(/[&]/g, "and").replace(/\+(?=\d)/g, "");
  return safe.length > 200 ? `${safe.slice(0, 197).trimEnd()}...` : safe;
}

/**
 * A Clan Leader Message (Jamie, 2026-09-25): the game's title-and-message
 * mail a leader or co-leader sends to every member's Inbox, durable where
 * clan chat is not. The game takes a title of at most 24 characters and a
 * message of about 180 (observed in the game; nothing in the API), so both
 * are held under that. Whether it uses clan chat's filter is not observed,
 * so the same care is taken: no "&" between words, no "+" before digits.
 */
export const LEADER_MESSAGE = { title: 24, body: 180 };

const filterSafe = (text) =>
  String(text ?? "")
    .replace(/\s*&\s*/g, " and ")
    .replace(/\+(?=\d)/g, "")
    .replace(/\s+/g, " ")
    .trim();

const clip = (text, max) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** Join items into a line that fits, saying how many did not. */
function fitList(items, max, sep = "; ") {
  const out = [];
  for (const item of items) {
    const next = [...out, item].join(sep);
    const rest = items.length - out.length - 1;
    if (next.length + (rest ? ` and ${rest} more.`.length : 1) > max) break;
    out.push(item);
  }
  const left = items.length - out.length;
  return `${out.join(sep)}${left ? ` and ${left} more.` : "."}`;
}

/**
 * The title and message for a leader-message action:
 *  - promotion / demotion: carried by the action itself, one per person
 *    (promoting and announcing are one step, as clans have done them);
 *  - awards: a closed season's winners;
 *  - rules: how the clan runs (first version) or what changed.
 */
export function leaderMessage(kind, data = {}) {
  const name = filterSafe(data.name ?? "a member");
  let title;
  let body;
  if (kind === "promotion") {
    title = "Congrats, new Elder!";
    body = `${name} is now an Elder${data.phrase ? `: ${filterSafe(data.phrase)}` : ""}. Thank you for showing up for the clan.`;
  } else if (kind === "demotion") {
    title = "Elder update";
    body = `${name} moves from Elder back to Member for now. Keep playing and it can come back.`;
  } else if (kind === "awards") {
    title = `Season ${data.season_id} awards`;
    const lines = (data.awards ?? []).map(
      (a) => `${filterSafe(a.name)}: ${a.winners.map(filterSafe).join(", ")}`,
    );
    body = lines.length
      ? fitList(lines, LEADER_MESSAGE.body - " Well played!".length)
      : "The season is closed.";
    if (body.length + " Well played!".length <= LEADER_MESSAGE.body)
      body += " Well played!";
  } else if (kind === "rules") {
    if (data.first) {
      title = "How our clan runs";
      body = `We now run the clan with Elixir Clan${data.goals ? `: ${filterSafe(data.goals)}` : ""}. Sign in with Elixir to see how it works and where you stand.`;
    } else {
      title = "Our clan rules changed";
      body = `We changed ${fitList(
        (data.changes ?? []).map((c) => filterSafe(c)),
        120,
        ", ",
      ).replace(/\.$/, "")}. See How it works here in Elixir Clan.`;
    }
  } else return null;
  return {
    title: clip(filterSafe(title), LEADER_MESSAGE.title),
    body: clip(filterSafe(body), LEADER_MESSAGE.body),
  };
}
