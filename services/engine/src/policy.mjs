/**
 * Policy: how one clan runs, as versioned configuration its leaders write.
 * Nothing in clan management runs until a leader or co-leader has saved a
 * policy (Jamie, 2026-09-25): before then there are no actions, no standing,
 * no inactivity clock and no awards, only the roster and its statistics.
 *
 * A policy is built from CATEGORIES the clan chooses to count (Clan Wars,
 * ranked play, donations, trophy road), each with its own settings. Elder
 * is either chosen by the leaders by hand or ranked on a weighted mix of
 * the counted categories; inactivity removal and departure questions are
 * each switched on or off. Everything starts off: a leader turns on what
 * the clan does. The field help is the documentation of the rules; it says
 * what a setting does, never what a clan should believe.
 *
 * Fields are flat and grouped as the editor reads them. `when` makes a
 * group or field apply only under other values: a list of clauses, any of
 * which may match; a clause matches when every field in it has the value.
 */

export const POLICY_SCHEMA_VERSION = 2;

/**
 * The smallest clan a policy engages with (Jamie, 2026-09-25): as a clan
 * takes no part in Clan Wars until it has 10 members, a policy has nothing
 * to judge at 1, 3 or 5. Below it a clan is still here (its roster and
 * every member's statistics, Recruit, Scout), but no policy can be created,
 * and a saved one pauses, kept, until the clan is back at this size.
 */
export const MIN_MEMBERS = 10;

export const CATEGORIES = ["war", "ranked", "donations", "trophies"];

export const CATEGORY_LABELS = {
  war: "Clan Wars",
  ranked: "Ranked play",
  donations: "Donations",
  trophies: "Trophy road",
};

const ANY_CATEGORY = CATEGORIES.map((c) => ({ [`${c}_enabled`]: true }));
const RANKING = [{ elder_mode: "categories" }];

export const GROUPS = [
  {
    key: "war",
    title: "Clan Wars",
    why: "War decks played in the River Race, from each war week's own deck count. A member is asked for four decks a war day up to the clan's finish, and all four days in Colosseum; decks played after the finish count and are never asked for.",
  },
  {
    key: "ranked",
    title: "Ranked play",
    why: "Ranked battles played, counted per week. Only games played count, not the league reached.",
  },
  {
    key: "donations",
    title: "Donations",
    why: "Cards donated, from the game's weekly counter, averaged over whole weeks.",
  },
  {
    key: "trophies",
    title: "Trophy road",
    why: "Each member's trophies today, from the latest roster read.",
  },
  {
    key: "minimums",
    title: "Minimums",
    why: "The least a member does to count as taking part in what the clan counts. Meeting them is needed to be promoted and to keep Elder, and it earns inactivity grace. Only minimums above zero apply; with none set, everyone meets them.",
    when: ANY_CATEGORY,
  },
  {
    key: "elder",
    title: "Elder",
    why: "How this clan chooses its Elders.",
  },
  {
    key: "band",
    title: "How many Elders",
    why: "Elders as a share of the whole roster, leadership included. Nobody is promoted just to reach the lower share, and growth stops at the upper one.",
    when: RANKING,
  },
  {
    key: "promotion",
    title: "Promotion",
    why: "Sustained, never a snapshot: a member is in the promotable set on several weekly reviews before an action is suggested. One missed review is tolerated; two in a row start the count again.",
    when: RANKING,
  },
  {
    key: "demotion",
    title: "Demotion",
    why: "Sustained evidence, never a small rank movement, with two reasons: missing the minimums, or being outranked when a higher-ranked member takes the seat.",
    when: RANKING,
  },
  {
    key: "removal",
    title: "Inactivity and removal",
    why: "Measured from battles played, never from logins, and counted from the later of the last battle and the join.",
  },
  {
    key: "departures",
    title: "Arrivals and departures",
    why: "A leave and a kick look the same in the roster: leaders can be asked which it was, so the clan's history says. A newcomer can be welcomed: elders and leaders get the action, with a line for clan chat.",
  },
  {
    key: "actions",
    title: "Actions",
    why: "How the actions leaders take behave after a decision.",
    when: [{ elder_mode: "categories" }, { removal_enabled: true }],
  },
  {
    key: "members",
    title: "What members see",
    why: "Every member sees how this clan runs. This decides whether they also see where each member stands.",
    when: RANKING,
  },
];

const weightWhy =
  "Weights are relative: 60, 20 and 20 mean three fifths, one fifth and one fifth of the Elder score. Zero leaves the category out of it.";

/** @type {Record<string, {group:string,label:string,unit:string,type:"integer"|"number"|"boolean"|"enum",min?:number,max?:number,options?:Array<{value:string,label:string}>,default:any,why:string,when?:Array<Record<string, any>>}>} */
export const FIELDS = {
  // ---- categories -------------------------------------------------------
  war_enabled: {
    group: "war",
    label: "Count Clan Wars",
    unit: "on/off",
    type: "boolean",
    default: false,
    why: "Track war decks for this clan's minimums and Elder score.",
  },
  war_window_weeks: {
    group: "war",
    label: "War rate window",
    unit: "war weeks",
    type: "integer",
    min: 1,
    max: 8,
    default: 4,
    why: "War decks played over war decks asked for, across the last this-many finished war weeks.",
    when: [{ war_enabled: true }],
  },
  ranked_enabled: {
    group: "ranked",
    label: "Count ranked play",
    unit: "on/off",
    type: "boolean",
    default: false,
    why: "Track ranked battles for this clan's minimums and Elder score.",
  },
  ranked_window_weeks: {
    group: "ranked",
    label: "Ranked window",
    unit: "weeks",
    type: "integer",
    min: 1,
    max: 8,
    default: 4,
    why: "Ranked battles played over the last this-many whole weeks.",
    when: [{ ranked_enabled: true }],
  },
  donations_enabled: {
    group: "donations",
    label: "Count donations",
    unit: "on/off",
    type: "boolean",
    default: false,
    why: "Track donations for this clan's minimums and Elder score.",
  },
  donations_window_weeks: {
    group: "donations",
    label: "Donation window",
    unit: "weeks",
    type: "integer",
    min: 1,
    max: 8,
    default: 4,
    why: "The weekly average over the last this-many whole weeks; a single week swings on the reset.",
    when: [{ donations_enabled: true }],
  },
  trophies_enabled: {
    group: "trophies",
    label: "Count trophy road",
    unit: "on/off",
    type: "boolean",
    default: false,
    why: "Track trophies for this clan's minimums and Elder score.",
  },

  // ---- minimums ---------------------------------------------------------
  minimums_window_weeks: {
    group: "minimums",
    label: "Minimums window",
    unit: "weeks",
    type: "integer",
    min: 1,
    max: 8,
    default: 2,
    why: "War decks and ranked battles are counted over this many weeks for the minimums; donations are the weekly average over it.",
    when: ANY_CATEGORY,
  },
  war_min_decks: {
    group: "minimums",
    label: "War decks played",
    unit: "decks in the window",
    type: "integer",
    min: 0,
    max: 64,
    default: 0,
    why: "Zero sets no war minimum.",
    when: [{ war_enabled: true }],
  },
  ranked_min_battles: {
    group: "minimums",
    label: "Ranked battles",
    unit: "battles in the window",
    type: "integer",
    min: 0,
    max: 200,
    default: 0,
    why: "Zero sets no ranked minimum.",
    when: [{ ranked_enabled: true }],
  },
  donations_min_weekly: {
    group: "minimums",
    label: "Donations",
    unit: "cards a week, on average",
    type: "integer",
    min: 0,
    max: 5000,
    default: 0,
    why: "Zero sets no donation minimum.",
    when: [{ donations_enabled: true }],
  },
  trophies_min: {
    group: "minimums",
    label: "Trophies",
    unit: "trophies",
    type: "integer",
    min: 0,
    max: 20000,
    default: 0,
    why: "Zero sets no trophy minimum.",
    when: [{ trophies_enabled: true }],
  },
  minimums_rule: {
    group: "minimums",
    label: "A member meets the minimums by meeting",
    unit: "rule",
    type: "enum",
    options: [
      { value: "any", label: "any one of them" },
      { value: "all", label: "all of them" },
    ],
    default: "any",
    why: "Only the minimums set above zero take part.",
    when: ANY_CATEGORY,
  },

  // ---- elder --------------------------------------------------------------
  elder_mode: {
    group: "elder",
    label: "Elders are chosen",
    unit: "mode",
    type: "enum",
    options: [
      { value: "manual", label: "by the leaders, by hand" },
      {
        value: "categories",
        label: "by participation in what the clan counts",
      },
    ],
    default: "manual",
    why: "By hand, the app suggests no promotion or demotion. By participation, members are ranked on the weighted categories below and leaders decide the actions that follow.",
  },
  elder_weight_war: {
    group: "elder",
    label: "Clan Wars weight",
    unit: "share",
    type: "integer",
    min: 0,
    max: 100,
    default: 0,
    why: weightWhy,
    when: [{ elder_mode: "categories", war_enabled: true }],
  },
  elder_weight_ranked: {
    group: "elder",
    label: "Ranked play weight",
    unit: "share",
    type: "integer",
    min: 0,
    max: 100,
    default: 0,
    why: weightWhy,
    when: [{ elder_mode: "categories", ranked_enabled: true }],
  },
  elder_weight_donations: {
    group: "elder",
    label: "Donations weight",
    unit: "share",
    type: "integer",
    min: 0,
    max: 100,
    default: 0,
    why: weightWhy,
    when: [{ elder_mode: "categories", donations_enabled: true }],
  },
  elder_weight_trophies: {
    group: "elder",
    label: "Trophy road weight",
    unit: "share",
    type: "integer",
    min: 0,
    max: 100,
    default: 0,
    why: weightWhy,
    when: [{ elder_mode: "categories", trophies_enabled: true }],
  },
  tenure_min_days: {
    group: "elder",
    label: "Days in the clan before promotion",
    unit: "days",
    type: "integer",
    min: 0,
    max: 365,
    default: 14,
    why: "Time in the clan gates promotion and breaks close calls; it never earns Elder on its own. A member whose join predates the record has an unknown tenure and is held, not assumed.",
    when: RANKING,
  },

  // ---- band -----------------------------------------------------------------
  band_floor_share: {
    group: "band",
    label: "Lower share",
    unit: "share of the roster",
    type: "number",
    min: 0,
    max: 1,
    default: 0.2,
    why: "A drift limit, not a quota: nothing is promoted to reach it.",
    when: RANKING,
  },
  band_ceiling_share: {
    group: "band",
    label: "Upper share",
    unit: "share of the roster",
    type: "number",
    min: 0,
    max: 1,
    default: 0.3,
    why: "Growth stops here; past it, the lowest-ranked Elder is outranked. The target is the midpoint. 1 sets no upper limit.",
    when: RANKING,
  },
  worthiness_percentile: {
    group: "band",
    label: "Promotion floor",
    unit: "percentile",
    type: "number",
    min: 0,
    max: 1,
    default: 0.5,
    why: "A member must score at or above this point of the ranked roster (0.5 is the median) to be promoted at all.",
    when: RANKING,
  },

  // ---- promotion / demotion ---------------------------------------------------
  promote_qualifying_weeks: {
    group: "promotion",
    label: "Qualifying weekly reviews",
    unit: "reviews",
    type: "integer",
    min: 1,
    max: 8,
    default: 3,
    why: "In the promotable set on this many weekly reviews before an action is suggested.",
    when: RANKING,
  },
  swap_margin: {
    group: "promotion",
    label: "Swap margin",
    unit: "score",
    type: "number",
    min: 0,
    max: 0.5,
    default: 0.05,
    why: "A challenger must outscore the lowest Elder by this much to take the seat when the band is full. Inside the margin, the longer tenure decides.",
    when: RANKING,
  },
  demote_abandoned_weeks: {
    group: "demotion",
    label: "Missed the minimums: reviews",
    unit: "reviews",
    type: "integer",
    min: 1,
    max: 8,
    default: 2,
    why: "An Elder who misses the minimums on this many weekly reviews in a row.",
    when: RANKING,
  },
  demote_outranked_weeks: {
    group: "demotion",
    label: "Outranked: reviews",
    unit: "reviews",
    type: "integer",
    min: 1,
    max: 8,
    default: 3,
    why: "An Elder outside the upper share while a higher-ranked member takes the seat. Matching the promotion count lets the swap land together.",
    when: RANKING,
  },

  // ---- removal ------------------------------------------------------------------
  removal_enabled: {
    group: "removal",
    label: "Suggest removals",
    unit: "on/off",
    type: "boolean",
    default: false,
    why: "Track inactivity and suggest removal to leaders as an action.",
  },
  watch_days: {
    group: "removal",
    label: "Getting quiet",
    unit: "battle-free days",
    type: "integer",
    min: 1,
    max: 60,
    default: 3,
    why: "Shown to leaders on the board; never an action.",
    when: [{ removal_enabled: true }],
  },
  at_risk_days: {
    group: "removal",
    label: "At risk",
    unit: "battle-free days",
    type: "integer",
    min: 1,
    max: 90,
    default: 7,
    why: "Counted from the last battle, or from the join for a member who has not battled since.",
    when: [{ removal_enabled: true }],
  },
  confirm_days: {
    group: "removal",
    label: "Removal action after",
    unit: "more days",
    type: "integer",
    min: 0,
    max: 90,
    default: 7,
    why: "At risk plus this many days suggests a removal action.",
    when: [{ removal_enabled: true }],
  },
  contribution_grace_max_days: {
    group: "removal",
    label: "Grace for meeting the minimums",
    unit: "extra days at an empty roster",
    type: "integer",
    min: 0,
    max: 30,
    default: 0,
    why: "A member who meets the minimums earns up to this many extra days, shrinking as the roster fills and reaching zero when it is full. Zero turns grace off.",
    when: [{ removal_enabled: true }],
  },
  roster_cap: {
    group: "removal",
    label: "Roster size",
    unit: "members",
    type: "integer",
    min: 1,
    max: 50,
    default: 50,
    why: "The clan's full size; open slots are this minus the roster. Grace uses it.",
    when: [{ removal_enabled: true }],
  },
  removal_includes_elders: {
    group: "removal",
    label: "Elders can get removal actions",
    unit: "on/off",
    type: "boolean",
    default: false,
    why: "Off, an inactive Elder is shown at risk but never gets a removal action. Leaders and co-leaders never do.",
    when: [{ removal_enabled: true }],
  },
  away_max_days: {
    group: "removal",
    label: "Members may mark themselves away for",
    unit: "days at most",
    type: "integer",
    min: 0,
    max: 90,
    default: 0,
    why: "A member who says they will be away pauses their own clock, up to this long. Zero turns it off; leaders can always hold or clear.",
    when: [{ removal_enabled: true }],
  },
  away_suggestions_enabled: {
    group: "removal",
    label: "Ask quiet members if they are away",
    unit: "on/off",
    type: "boolean",
    default: false,
    why: "A member whose inactivity clock reaches at risk gets an action of their own: going to be away? It closes itself when they play again or mark themselves away.",
    when: [{ removal_enabled: true }],
  },

  // ---- departures -------------------------------------------------------------
  departures_enabled: {
    group: "departures",
    label: "Ask about departures",
    unit: "on/off",
    type: "boolean",
    default: false,
    why: "When a member leaves and no removal action explains it, leaders get an action: kicked, left, or ignore.",
  },
  welcome_enabled: {
    group: "departures",
    label: "Suggest welcoming newcomers",
    unit: "on/off",
    type: "boolean",
    default: false,
    why: "When a member joins, elders and leaders get an action to welcome them, with a line to paste in clan chat. It closes itself after a few days.",
  },

  // ---- actions ----------------------------------------------------------------------
  outcome_window_hours: {
    group: "actions",
    label: "Outcome window",
    unit: "hours",
    type: "integer",
    min: 1,
    max: 168,
    default: 48,
    why: "After an action is completed, the record must show the change (role moved, membership closed) within this window or the action is flagged for a look.",
    when: [{ elder_mode: "categories" }, { removal_enabled: true }],
  },
  renominate_removal_days: {
    group: "actions",
    label: "After a declined removal",
    unit: "days",
    type: "integer",
    min: 0,
    max: 90,
    default: 7,
    why: "A declined removal is raised again after this long if the member still qualifies.",
    when: [{ removal_enabled: true }],
  },
  renominate_promotion_days: {
    group: "actions",
    label: "After a declined promotion",
    unit: "days",
    type: "integer",
    min: 0,
    max: 90,
    default: 14,
    why: "A declined promotion is raised again after this long on sustained evidence.",
    when: RANKING,
  },
  renominate_demotion_days: {
    group: "actions",
    label: "After a declined demotion",
    unit: "days",
    type: "integer",
    min: 0,
    max: 90,
    default: 14,
    why: "A declined demotion is raised again after this long on sustained evidence.",
    when: RANKING,
  },

  // ---- members -------------------------------------------------------------------------
  members_see_standing: {
    group: "members",
    label: "Members see where everyone stands",
    unit: "on/off",
    type: "boolean",
    default: true,
    why: "Who holds Elder, who is rising, who is slipping, each with their own evidence in a player's terms. Nobody below co-leader ever sees a removal action or who is on a clock.",
    when: RANKING,
  },
};

export const FIELD_KEYS = Object.keys(FIELDS);

/** Whether a `when` applies under these values (no `when` always does). */
export function applies(when, values) {
  if (!when) return true;
  return when.some((clause) =>
    Object.entries(clause).every(([k, v]) => values?.[k] === v),
  );
}

/** The starting values a new policy is drafted from: everything off. */
export function defaults() {
  return Object.fromEntries(FIELD_KEYS.map((k) => [k, FIELDS[k].default]));
}

/** The categories this policy counts. */
export function countedCategories(policy) {
  return CATEGORIES.filter((c) => policy?.[`${c}_enabled`] === true);
}

/**
 * The Elder score's weights, normalized to sum to 1, over the counted
 * categories with a weight above zero; empty when Elder is chosen by hand.
 */
export function elderWeights(policy) {
  if (policy?.elder_mode !== "categories") return {};
  const raw = countedCategories(policy)
    .map((c) => [c, Number(policy[`elder_weight_${c}`]) || 0])
    .filter(([, w]) => w > 0);
  const total = raw.reduce((s, [, w]) => s + w, 0);
  return total > 0
    ? Object.fromEntries(raw.map(([c, w]) => [c, w / total]))
    : {};
}

/** Whether Elder is ranked by participation under this policy. */
export const ranksElder = (policy) =>
  Object.keys(elderWeights(policy)).length > 0;

/** The minimums this policy sets: counted categories with a threshold above zero. */
export function setMinimums(policy) {
  const out = {};
  if (policy?.war_enabled && policy.war_min_decks > 0)
    out.war = policy.war_min_decks;
  if (policy?.ranked_enabled && policy.ranked_min_battles > 0)
    out.ranked = policy.ranked_min_battles;
  if (policy?.donations_enabled && policy.donations_min_weekly > 0)
    out.donations = policy.donations_min_weekly;
  if (policy?.trophies_enabled && policy.trophies_min > 0)
    out.trophies = policy.trophies_min;
  return out;
}

/**
 * Validate a candidate policy. Returns { ok, values, errors } where errors
 * are sentences a leader would need, keyed by the field that owns them.
 * Unknown keys are refused; missing keys take the starting value.
 */
export function validate(input = {}) {
  const errors = {};
  const values = defaults();
  for (const key of Object.keys(input ?? {})) {
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
    } else if (f.type === "enum") {
      if (!f.options.some((o) => o.value === v)) {
        errors[key] =
          `${f.label} is one of: ${f.options.map((o) => o.label).join(", ")}.`;
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
  if (values.elder_mode === "categories" && !ranksElder(values))
    errors.elder_mode =
      countedCategories(values).length === 0
        ? "Ranking Elders by participation needs at least one category the clan counts."
        : "Give at least one counted category a weight above zero.";
  if (values.band_ceiling_share < values.band_floor_share)
    errors.band_ceiling_share = "The upper share cannot be below the lower.";
  if (values.at_risk_days < values.watch_days)
    errors.at_risk_days = "At risk cannot come before getting quiet.";
  if (
    values.removal_enabled &&
    values.away_suggestions_enabled &&
    !(values.away_max_days > 0)
  )
    errors.away_suggestions_enabled =
      "Asking members if they are away needs members to be allowed to mark themselves away.";
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
