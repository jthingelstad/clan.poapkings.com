/**
 * Policy: the constants of elixir-bot's engine/management.py as per-clan
 * configuration. Every field carries its label, unit, range, the POAP
 * KINGS default and a short WHY lifted from prompts/POLICY.md; that prose
 * is the help text in the editor and the only documentation of the rules.
 *
 * Fields are grouped as the policy reads. A dimension (elder management,
 * removal) can be switched off; a clan that wants only inactivity cards
 * gets only inactivity cards. Windows are in whole weeks (the record is
 * read per ISO week and per war week), evaluated at week boundaries.
 */

export const POLICY_SCHEMA_VERSION = 1;

export const GROUPS = [
  {
    key: "consideration",
    title: "Consideration",
    why: "Two hard filters, both evaluated live. Tenure gates promotion in; a sitting Elder is never demoted over tenure. The competitive floor is war OR ranked, counted equally.",
  },
  {
    key: "standing",
    title: "Standing",
    why: "Every member and Elder is ranked against the others (leaders and co-leaders excluded) on three participation metrics, each turned into a percentile. Nothing about account power counts.",
  },
  {
    key: "band",
    title: "Elder band",
    why: "Elders should be a share of the whole active roster, leadership included. Ceiling is hard; target is the aim; floor is a drift limit, not a quota. Growth is gated on worthiness at the median.",
  },
  {
    key: "promotion",
    title: "Promotion",
    why: "Sustained, never a snapshot: in the promotable set on several weekly reviews. One miss is tolerated; two in a row resets the clock. A swap needs a clear margin, and inside the margin tenure decides.",
  },
  {
    key: "demotion",
    title: "Demotion",
    why: "A negative action needs sustained evidence, never a small rank movement. Two reasons, two cadences: abandoned the floor (fast) or outranked past the ceiling (matches the challenger's cadence so the swap lands together).",
  },
  {
    key: "removal",
    title: "Removal",
    why: "Inactivity and absence, measured from battles played and never from logins. A flat clock; trophies buy no rope, newcomers get no shield. The only leeway is contribution grace, which shrinks as the roster fills.",
  },
  {
    key: "renomination",
    title: "Re-nomination",
    why: "Declining a card is the only 'not now'. The engine re-nominates on sustained evidence after a cooldown, not on a leader-set clock.",
  },
  {
    key: "transparency",
    title: "Transparency",
    why: "The clan is told why, in terms a player can act on: who holds Elder, who is rising, who is slipping, each with their own participation evidence. Never internal scores, percentiles, rank positions or the slot count.",
  },
];

/** @type {Record<string, {group:string,label:string,unit:string,type:"integer"|"number"|"boolean",min?:number,max?:number,default:any,why:string}>} */
export const FIELDS = {
  elder_management_enabled: {
    group: "consideration",
    label: "Elder management",
    unit: "on/off",
    type: "boolean",
    default: true,
    why: "Turn off to raise no promotion or demotion cards and show no standing; removal keeps working on its own.",
  },
  tenure_min_days: {
    group: "consideration",
    label: "Minimum tenure to be considered",
    unit: "days",
    type: "integer",
    min: 0,
    max: 365,
    default: 28,
    why: "Time served does not earn Elder; it gates consideration and breaks close calls. A member whose join predates the record has an unknown tenure and is held, not assumed.",
  },
  floor_window_weeks: {
    group: "consideration",
    label: "Competitive floor window",
    unit: "weeks",
    type: "integer",
    min: 1,
    max: 8,
    default: 2,
    why: "The window the floor looks back over (default 14 days). War and ranked count equally here.",
  },
  floor_war_days: {
    group: "consideration",
    label: "War days with a deck played",
    unit: "days in the window",
    type: "integer",
    min: 0,
    max: 8,
    default: 1,
    why: "At least this many finalized war days with a deck actually played clears the floor on its own.",
  },
  floor_ranked_battles: {
    group: "consideration",
    label: "Ranked battles",
    unit: "battles in the window",
    type: "integer",
    min: 0,
    max: 200,
    default: 5,
    why: "At least this many ranked battles clears the floor on its own. Participation, not the league reached: every input is in the player's control.",
  },
  war_rate_window_weeks: {
    group: "standing",
    label: "War rate window",
    unit: "war weeks",
    type: "integer",
    min: 1,
    max: 8,
    default: 4,
    why: "Per-day war credit averaged over these war weeks (default 28 days).",
  },
  full_day_bonus: {
    group: "standing",
    label: "Full-day bonus",
    unit: "share of a day's credit",
    type: "number",
    min: 0,
    max: 1,
    default: 0.25,
    why: "Finishing a war day is worth more than the deck count suggests: 4 of 4 decks scores 1.00, 3 of 4 scores 0.56, 2 of 4 scores 0.38. Four decks is worth about 2.7x two decks, not 2x.",
  },
  ranked_window_weeks: {
    group: "standing",
    label: "Ranked battles window",
    unit: "weeks",
    type: "integer",
    min: 1,
    max: 8,
    default: 4,
    why: "How many ranked battles were played in this window; the league reached never counts.",
  },
  donation_window_weeks: {
    group: "standing",
    label: "Donation average window",
    unit: "weeks",
    type: "integer",
    min: 1,
    max: 8,
    default: 4,
    why: "The trailing average of the weekly donation counter, not a single week's snapshot; one week swings on the reset.",
  },
  war_weight: {
    group: "standing",
    label: "War weight",
    unit: "share of the score",
    type: "number",
    min: 0,
    max: 1,
    default: 0.65,
    why: "score = war_weight x competitive + donation_weight x donation%. War is the primary path because it is direct clan contribution.",
  },
  donation_weight: {
    group: "standing",
    label: "Donation weight",
    unit: "share of the score",
    type: "number",
    min: 0,
    max: 1,
    default: 0.35,
    why: "Donations are the lighter half: lead by example, not the main route. War weight and donation weight must sum to 1.",
  },
  ranked_weight: {
    group: "standing",
    label: "Ranked weight",
    unit: "share of the gap war leaves",
    type: "number",
    min: 0,
    max: 1,
    default: 0.4,
    why: "competitive = war% + ranked_weight x ranked% x (1 - war%). Ranked only represents the clan, so it fills part of the gap war leaves rather than substituting for it; doing both is rewarded.",
  },
  band_floor_share: {
    group: "band",
    label: "Elder floor",
    unit: "share of the roster",
    type: "number",
    min: 0,
    max: 1,
    default: 0.2,
    why: "A drift limit, not a quota. Nothing force-promotes to reach it; a clan without enough worthy members simply carries fewer Elders.",
  },
  band_ceiling_share: {
    group: "band",
    label: "Elder ceiling",
    unit: "share of the roster",
    type: "number",
    min: 0,
    max: 1,
    default: 0.3,
    why: "Hard. Growth stops there, and only past it is anyone demoted for the count alone. The target is the midpoint.",
  },
  worthiness_percentile: {
    group: "band",
    label: "Worthiness floor",
    unit: "percentile",
    type: "number",
    min: 0,
    max: 1,
    default: 0.5,
    why: "A member must score at or above this point of the ranked roster (0.5 = the median) to be promoted at all. Promoting a below-average member to hit a number is exactly what the target must not cause.",
  },
  promote_qualifying_weeks: {
    group: "promotion",
    label: "Qualifying weekly reviews",
    unit: "reviews",
    type: "integer",
    min: 1,
    max: 8,
    default: 3,
    why: "In the promotable set on this many weekly reviews before a card is raised. One miss is tolerated; two in a row resets the clock.",
  },
  swap_margin: {
    group: "promotion",
    label: "Swap margin",
    unit: "score",
    type: "number",
    min: 0,
    max: 0.5,
    default: 0.05,
    why: "A challenger must out-score the boundary Elder by this much to take the seat. Inside the margin it is a close call and tenure decides it; tenure never manufactures a promotion.",
  },
  demote_abandoned_weeks: {
    group: "demotion",
    label: "Abandoned: weeks",
    unit: "reviews",
    type: "integer",
    min: 1,
    max: 8,
    default: 2,
    why: "An Elder who fails both halves of the floor has abandoned the duty; this cadence is deliberately faster than promotion.",
  },
  demote_outranked_weeks: {
    group: "demotion",
    label: "Outranked: weeks",
    unit: "reviews",
    type: "integer",
    min: 1,
    max: 8,
    default: 3,
    why: "Fell outside the ceiling and a higher-ranked member took the seat. Matches the challenger's promotion cadence so the swap lands together and the count never dips mid-swap.",
  },
  removal_enabled: {
    group: "removal",
    label: "Removal",
    unit: "on/off",
    type: "boolean",
    default: true,
    why: "Turn off to raise no removal cards; the inactivity clock is still shown to leaders.",
  },
  watch_days: {
    group: "removal",
    label: "Watch",
    unit: "battle-free days",
    type: "integer",
    min: 1,
    max: 60,
    default: 3,
    why: "The 'getting quiet' line: shown on the board, never a card.",
  },
  at_risk_days: {
    group: "removal",
    label: "At risk",
    unit: "battle-free days",
    type: "integer",
    min: 1,
    max: 90,
    default: 5,
    why: "A flat clock from the last battle (or the join, for a member who has not battled since). Trophies buy no extra rope.",
  },
  confirm_days: {
    group: "removal",
    label: "Confirm",
    unit: "more days",
    type: "integer",
    min: 0,
    max: 90,
    default: 3,
    why: "At risk plus this many days proposes a removal card (default day 8).",
  },
  contribution_grace_max_days: {
    group: "removal",
    label: "Contribution grace",
    unit: "extra days at an empty roster",
    type: "integer",
    min: 0,
    max: 30,
    default: 4,
    why: "A member who currently clears the competitive floor earns up to this many extra confirm days, shrinking linearly as the roster fills and reaching zero when it is full. An idle seat only costs something when there is no slot to spare.",
  },
  roster_cap: {
    group: "removal",
    label: "Roster cap",
    unit: "members",
    type: "integer",
    min: 1,
    max: 50,
    default: 50,
    why: "The game's clan size; open slots are the cap minus the active roster.",
  },
  away_max_days: {
    group: "removal",
    label: "Members may mark themselves away for",
    unit: "days at most",
    type: "integer",
    min: 0,
    max: 90,
    default: 30,
    why: "A member who tells the clan they will be away pauses their own clock, up to this long (0 turns it off; leaders can always hold or clear). elixir-bot took this by chat; here the member says it on their own page.",
  },
  outcome_window_hours: {
    group: "removal",
    label: "Outcome window",
    unit: "hours",
    type: "integer",
    min: 1,
    max: 168,
    default: 48,
    why: "After a card is marked Done, the record must show the change (role moved, membership closed) within this window or the card is flagged for a look.",
  },
  renominate_removal_days: {
    group: "renomination",
    label: "After a declined removal",
    unit: "days",
    type: "integer",
    min: 0,
    max: 90,
    default: 7,
    why: "A declined removal card re-nominates after this long if the member still qualifies.",
  },
  renominate_promotion_days: {
    group: "renomination",
    label: "After a declined promotion",
    unit: "days",
    type: "integer",
    min: 0,
    max: 90,
    default: 14,
    why: "A declined promotion re-nominates on sustained evidence after this long.",
  },
  renominate_demotion_days: {
    group: "renomination",
    label: "After a declined demotion",
    unit: "days",
    type: "integer",
    min: 0,
    max: 90,
    default: 14,
    why: "A declined demotion re-nominates on sustained evidence after this long.",
  },
  members_see_standing: {
    group: "transparency",
    label: "Members may see standing",
    unit: "on/off",
    type: "boolean",
    default: true,
    why: "Who holds Elder, who is rising, who is slipping, each with their own evidence in a player's terms. Nobody below co-leader ever sees a removal card or who is on a clock.",
  },
};

export const FIELD_KEYS = Object.keys(FIELDS);

export function defaults() {
  return Object.fromEntries(FIELD_KEYS.map((k) => [k, FIELDS[k].default]));
}

/**
 * Validate a candidate policy. Returns { ok, values, errors } where errors
 * are sentences a leader would need, keyed by the field that owns them.
 * Unknown keys are refused; missing keys take the default.
 */
export function validate(input = {}) {
  const errors = {};
  const values = defaults();
  for (const key of Object.keys(input)) {
    if (!FIELDS[key]) {
      errors[key] = "This is not a policy field.";
      continue;
    }
    const f = FIELDS[key];
    let v = input[key];
    if (f.type === "boolean") {
      if (typeof v !== "boolean") {
        errors[key] = `${f.label} is on or off.`;
        continue;
      }
    } else {
      v = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
      if (typeof v !== "number" || Number.isNaN(v)) {
        errors[key] = `${f.label} needs a number (${f.unit}).`;
        continue;
      }
      if (f.type === "integer" && !Number.isInteger(v)) {
        errors[key] = `${f.label} is a whole number of ${f.unit}.`;
        continue;
      }
      if (v < f.min || v > f.max) {
        errors[key] =
          `${f.label} must be between ${f.min} and ${f.max} ${f.unit}.`;
        continue;
      }
    }
    values[key] = v;
  }
  // Cross-field sense, in the leader's words.
  if (values.band_ceiling_share < values.band_floor_share)
    errors.band_ceiling_share = "The Elder ceiling cannot be below the floor.";
  if (Math.abs(values.war_weight + values.donation_weight - 1) > 1e-9)
    errors.donation_weight =
      "War weight and donation weight must add up to 1 (for example 0.65 and 0.35).";
  if (values.floor_war_days === 0 && values.floor_ranked_battles === 0)
    errors.floor_war_days =
      "With both floors at zero everyone clears the floor; set at least one.";
  if (values.at_risk_days < values.watch_days)
    errors.at_risk_days = "At risk cannot come before Watch.";
  return { ok: Object.keys(errors).length === 0, values, errors };
}

/** Which fields differ between two policies, for the versions view. */
export function diff(before = {}, after = {}) {
  return FIELD_KEYS.filter((k) => before[k] !== after[k]).map((k) => ({
    key: k,
    label: FIELDS[k].label,
    before: before[k],
    after: after[k],
  }));
}
