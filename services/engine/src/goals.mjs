/**
 * What a clan is FOR (round 2 of the build loop, 2026-09-25; from the
 * goals plan of 2026-09-13): a leader says what the clan is about and how
 * strict it is, and a whole starting policy follows, to tune before
 * saving. Since the tabbed editor (2026-09-25) the measurable goals ARE
 * the categories the clan counts (`declaredGoals`); only playing together
 * is its own field (`goal_together`), with `posture`. Goals open "How it
 * works here" and seed the recruiting pitch, and judge nothing on their
 * own; a leader who tunes a number is never overruled.
 *
 * Pure and deterministic: the same goals and posture always give the same
 * policy.
 */

import { FIELDS, FIELD_KEYS, TABS, defaults, validate } from "./policy.mjs";

/** What a clan can be for. Several can be on at once; real clans mix. */
export const GOALS = {
  war: {
    label: "Clan Wars",
    about: "We fight the River Race together.",
    point: "Clan Wars every week",
  },
  climbing: {
    label: "Climbing",
    about: "We push Trophy Road and Path of Legends.",
    point: "Climbing together on Trophy Road and in ranked",
  },
  donations: {
    label: "Donations",
    about: "We level each other's cards.",
    point: "Generous donations, every week",
  },
  together: {
    label: "Playing together",
    about: "We play with people we like, when we like.",
    point: "Friendly and low-drama",
  },
};

export const GOAL_KEYS = Object.keys(GOALS);

/** How hard the clan holds itself to its goals. */
export const POSTURES = {
  relaxed: {
    label: "Relaxed",
    about: "Real life first: long clocks, low minimums.",
  },
  standard: {
    label: "Standard",
    about: "Show up most weeks; inactive members make room after two weeks.",
  },
  strict: {
    label: "Strict",
    about: "Every week counts: high minimums, short clocks.",
  },
};

/** Starting points leaders recognise, each a set of goals and a posture. */
export const PRESETS = [
  {
    key: "war",
    label: "A war clan",
    goals: ["war", "donations"],
    posture: "strict",
  },
  {
    key: "climbing",
    label: "A climbing clan",
    goals: ["climbing"],
    posture: "standard",
  },
  {
    key: "donations",
    label: "A donation clan",
    goals: ["donations"],
    posture: "standard",
  },
  {
    key: "social",
    label: "A social clan",
    goals: ["together"],
    posture: "relaxed",
  },
  {
    key: "mixed",
    label: "A bit of everything",
    goals: ["war", "climbing", "donations", "together"],
    posture: "standard",
  },
];

const by = (posture, table) => table[posture] ?? table.standard;

/**
 * The whole starting policy for these goals and this posture, validated.
 * Every measurable goal is counted and weighted for Elder; a clan whose
 * only goal is playing together has Elders chosen by hand. Every posture
 * tracks inactivity, asks about departures, welcomes newcomers and lets
 * members mark themselves away.
 */
export function policyFromGoals(goals = [], posture = "standard") {
  const on = new Set(goals.filter((g) => GOALS[g]));
  const v = defaults();
  v.goal_together = on.has("together");
  v.posture = POSTURES[posture] ? posture : "standard";

  if (on.has("war")) {
    v.war_enabled = true;
    v.war_window_weeks = 4;
    v.war_min_decks = by(posture, { relaxed: 1, standard: 8, strict: 24 });
    v.elder_weight_war = 50;
  }
  if (on.has("climbing")) {
    v.ranked_enabled = true;
    v.ranked_window_weeks = 4;
    v.ranked_min_battles = by(posture, { relaxed: 0, standard: 5, strict: 20 });
    v.elder_weight_ranked = 20;
    v.trophies_enabled = true;
    v.elder_weight_trophies = 10;
  }
  if (on.has("donations")) {
    v.donations_enabled = true;
    v.donations_window_weeks = 4;
    v.donations_min_weekly = by(posture, {
      relaxed: 0,
      standard: 40,
      strict: 150,
    });
    v.elder_weight_donations = 30;
  }
  v.minimums_window_weeks = 2;
  v.minimums_rule = "any";

  const measured = on.has("war") || on.has("climbing") || on.has("donations");
  v.elder_mode = measured ? "categories" : "manual";
  v.tenure_min_days = by(posture, { relaxed: 30, standard: 21, strict: 14 });

  v.removal_enabled = true;
  Object.assign(
    v,
    by(posture, {
      relaxed: { watch_days: 7, at_risk_days: 14, confirm_days: 7 },
      standard: { watch_days: 3, at_risk_days: 7, confirm_days: 7 },
      strict: { watch_days: 2, at_risk_days: 4, confirm_days: 3 },
    }),
  );
  v.contribution_grace_max_days = by(posture, {
    relaxed: 7,
    standard: 3,
    strict: 0,
  });
  v.removal_includes_elders = posture === "strict";
  v.away_max_days = by(posture, { relaxed: 30, standard: 21, strict: 14 });
  v.away_suggestions_enabled = true;
  v.departures_enabled = true;
  v.welcome_enabled = true;
  v.announce_awards_enabled = true;
  v.announce_rules_enabled = true;
  v.members_see_standing = true;

  const checked = validate(v);
  if (!checked.ok)
    throw new Error(
      `goals ${[...on].join(",")} / ${posture} made an invalid policy: ${JSON.stringify(checked.errors)}`,
    );
  return checked.values;
}

/** The goal a category tab stands for. */
const CATEGORY_GOAL = {
  war: "war",
  ranked: "climbing",
  trophies: "climbing",
  donations: "donations",
};

/**
 * The starting values for one tab as it is turned on: that tab's
 * settings (and, for a category, its Elder weight) from the starting
 * policy of what the clan already counts plus this category, at the
 * clan's posture. Everything else in the draft is left alone.
 */
export function tabStart(values, tabKey) {
  const tab = TABS.find((t) => t.key === tabKey);
  if (!tab) return {};
  const goals = new Set(declaredGoals(values));
  if (CATEGORY_GOAL[tabKey]) goals.add(CATEGORY_GOAL[tabKey]);
  const start = policyFromGoals([...goals], values?.posture ?? "standard");
  return Object.fromEntries(
    FIELD_KEYS.filter(
      (k) =>
        tab.groups.includes(FIELDS[k].group) ||
        (CATEGORY_GOAL[tabKey] && k === `elder_weight_${tabKey}`),
    ).map((k) => [k, start[k]]),
  );
}

/**
 * The goals a policy declares, in order: the measurable ones are the
 * categories it counts (climbing is ranked play or trophy road), and
 * playing together is said on its own, since the game cannot measure it.
 */
export function declaredGoals(policy) {
  const on = {
    war: policy?.war_enabled === true,
    climbing:
      policy?.ranked_enabled === true || policy?.trophies_enabled === true,
    donations: policy?.donations_enabled === true,
    together: policy?.goal_together === true,
  };
  return GOAL_KEYS.filter((g) => on[g]);
}

/** A goal as a word in a sentence: Clan Wars is a name and keeps its
 *  capitals; the others are plain words. */
const goalWord = (g) =>
  g === "war" ? GOALS[g].label : GOALS[g].label.toLowerCase();

function joinWords(words) {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** The goals inside a sentence: "Clan Wars, donations and playing together". */
export const goalsInSentence = (goals) => joinWords(goals.map(goalWord));

/** The goals as a title: "Donations and Clan Wars". */
export const goalsPhrase = (goals) =>
  goalsInSentence(goals).replace(/^./, (c) => c.toUpperCase());

/**
 * A first draft of the recruiting pitch from the clan's goals, for a
 * leader to edit before saving: never saved on its own, never names a
 * clan, promises nothing the goals do not say.
 */
export function pitchFromGoals(goals = [], posture = "standard") {
  const on = GOAL_KEYS.filter((g) => goals.includes(g));
  if (on.length === 0) return null;
  const who = {
    relaxed: "Players who enjoy the game and like good company.",
    standard: "Active players who show up most weeks.",
    strict: "Committed players who show up every week.",
  }[POSTURES[posture] ? posture : "standard"];
  return {
    tagline: goalsPhrase(on),
    about: on.map((g) => GOALS[g].about).join(" "),
    points: on.map((g) => GOALS[g].point),
    looking_for: who,
    website_url: "",
    contact: "Request to join in game.",
  };
}
