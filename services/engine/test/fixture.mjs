import { validate } from "../src/policy.mjs";

/**
 * A clans_participation answer, built to the tool's shape (values here
 * are invented). Six ISO weeks
 * ending in the partial week of NOW, and six closed war weeks whose
 * finishes are the weekly review boundaries, plus the week in progress.
 */

export const NOW = new Date("2026-09-12T20:00:00Z");
const DAY = 86400_000;
const WEEK = 7 * DAY;
// Monday 2026-08-03 00:00Z is the first ISO week; six weeks to W37.
const WEEK0 = Date.parse("2026-08-03T00:00:00Z");

export function weeks(n = 6) {
  return Array.from({ length: n }, (_, i) => {
    const from = new Date(WEEK0 + i * WEEK);
    const to = new Date(WEEK0 + (i + 1) * WEEK);
    return {
      iso_week: `2026-W${32 + i}`,
      from: from.toISOString(),
      to: to.toISOString(),
      complete: to <= NOW,
    };
  });
}

/** War weeks finish Mondays ~09:34Z: 08-10 ... 09-07 closed, 136/0 open. */
export function warWeeks() {
  const finishes = [
    "2026-08-10",
    "2026-08-17",
    "2026-08-24",
    "2026-08-31",
    "2026-09-07",
  ];
  const rows = finishes.map((d, i) => ({
    season_id: 135,
    section_index: i,
    is_colosseum: i === 4,
    started_observed_at: `${d}T09:34:00.000Z`,
    finished_observed_at: `${d}T09:34:00.000Z`,
  }));
  rows.push({
    season_id: 136,
    section_index: 0,
    is_colosseum: false,
    started_observed_at: "2026-09-07T09:34:00.000Z",
    finished_observed_at: null,
  });
  return rows;
}

/**
 * One member. `war` is decks per war week (six entries, the open week
 * last). Elixir serves no per-day war arrays (contracts 9.0.0 and 9.0.1:
 * weekly aggregates only), so neither does this fixture.
 */
export function member(tag, opts = {}) {
  const {
    name = tag.slice(1),
    role = "member",
    tenureDays = 120,
    tenureKnown = true,
    war = [16, 16, 16, 16, 16, 8],
    ranked = [0, 0, 0, 0, 0, 0],
    battles = [20, 20, 20, 20, 20, 10],
    donations = [200, 200, 200, 200, 200, 100],
    lastBattleDaysAgo = 0.5,
  } = opts;
  const joined = new Date(NOW.getTime() - tenureDays * DAY).toISOString();
  return {
    player_tag: tag,
    name,
    role,
    joined_observed_at: joined,
    tenure_known: tenureKnown,
    days_in_clan_observed: tenureDays,
    last_battle_time:
      lastBattleDaysAgo === null
        ? null
        : new Date(NOW.getTime() - lastBattleDaysAgo * DAY).toISOString(),
    days_since_battle: lastBattleDaysAgo,
    battles,
    ranked_battles: ranked,
    donations,
    war_decks: war,
    war_points: war.map((d) => (d ?? 0) * 200),
  };
}

export function participation(members, extra = {}) {
  return {
    clan_tag: "#TEST",
    name: "Test Clan",
    recording_active_since: "2026-05-01T00:00:00.000Z",
    first_roster_observed_at: "2026-05-01T00:00:00.000Z",
    weeks: weeks(),
    war_weeks: warWeeks(),
    member_count: members.length,
    members,
    meta: { as_of: NOW.toISOString(), freshness_seconds: 120 },
    ...extra,
  };
}

/**
 * A saved policy for an example clan that counts Clan Wars, ranked play
 * and donations, ranks Elder on a weighted mix of them, tracks inactivity
 * and asks about departures. The engine never runs without a saved policy;
 * this is the one most tests judge under.
 */
export const EXAMPLE_POLICY = validate({
  war_enabled: true,
  war_window_weeks: 4,
  ranked_enabled: true,
  ranked_window_weeks: 4,
  donations_enabled: true,
  donations_window_weeks: 4,
  minimums_window_weeks: 2,
  war_min_decks: 1,
  ranked_min_battles: 5,
  minimums_rule: "any",
  elder_mode: "categories",
  elder_weight_war: 55,
  elder_weight_ranked: 15,
  elder_weight_donations: 30,
  tenure_min_days: 28,
  band_floor_share: 0.2,
  band_ceiling_share: 0.3,
  worthiness_percentile: 0.5,
  promote_qualifying_weeks: 3,
  swap_margin: 0.05,
  demote_abandoned_weeks: 2,
  demote_outranked_weeks: 3,
  removal_enabled: true,
  watch_days: 3,
  at_risk_days: 5,
  confirm_days: 3,
  contribution_grace_max_days: 4,
  roster_cap: 50,
  away_max_days: 30,
  departures_enabled: true,
}).values;

/** An example clan's awards document: one of each kind, under its own
 *  names. Every real clan starts with none and adds its own. */
export const EXAMPLE_AWARDS = {
  schema: 1,
  awards: [
    {
      id: "season_champ",
      kind: "season_points_podium",
      name: "Season Champion",
      description:
        "The season's top war points, on the podium. Ties break on cards donated.",
      enabled: true,
      params: { podium: 3, tiebreak: "donations" },
    },
    {
      id: "ever_present",
      kind: "perfect_attendance",
      name: "Ever Present",
      description:
        "Four decks, every war day, every week of the season. Anyone who does it earns it.",
      enabled: true,
      params: { decks_per_day: 4, allowed_misses: 0 },
    },
    {
      id: "top_donor",
      kind: "donations_podium",
      name: "Top Donor",
      description: "The most cards donated over the season.",
      enabled: true,
      params: { podium: 3 },
    },
    {
      id: "top_rookie",
      kind: "rookie_podium",
      name: "Top Rookie",
      description:
        "The top war points among members in their first season here.",
      enabled: true,
      params: { podium: 3 },
    },
    {
      id: "clan_honour",
      kind: "leaders_pick",
      name: "Clan Honour",
      description: "Chosen by the leaders, with a note.",
      enabled: true,
      params: { granted_by: "leaders" },
    },
  ],
};
