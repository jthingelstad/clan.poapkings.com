/**
 * A clans_participation answer, built to the tool's shape (captured live
 * 2026-09-12 from POAP KINGS; values here are invented). Six ISO weeks
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
 * last); `days` optionally per-day decks per war week (null = unpolled).
 */
export function member(tag, opts = {}) {
  const {
    name = tag.slice(1),
    role = "member",
    tenureDays = 120,
    tenureKnown = true,
    war = [16, 16, 16, 16, 16, 8],
    days = null,
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
    war_decks_by_day:
      days ??
      war.map((d) => (d === null ? [null, null, null, null] : spread(d))),
    war_battles_by_day: war.map((d) => (d === null ? [0, 0, 0, 0] : spread(d))),
  };
}

/** Spread a weekly deck count over four days, four at a time. */
export function spread(decks) {
  let left = decks;
  return [0, 1, 2, 3].map(() => {
    const d = Math.min(4, Math.max(0, left));
    left -= d;
    return d;
  });
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
