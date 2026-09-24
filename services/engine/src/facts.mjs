/**
 * From Elixir's answers to per-member FACTS at an instant.
 *
 * Inputs are the two tools this app reads: `clans_participation` (columns
 * per ISO week and per war week) and `clans_roster` (roles, names). The
 * output is what the rules consume, computed as of `at`, using only
 * evidence that existed before `at`, so the same function replays any
 * past weekly boundary.
 *
 * Every fact carries how it was known: exact, `weekly` (a war week
 * without per-day polls, its decks spread over the days battled) or
 * `unknown` (null in the record). Unknown never becomes zero.
 */

const DAY_MS = 86400_000;

export function isoWeekStartUtc(date) {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d;
}

/**
 * Per-member facts as of `at`.
 * @param {object} participation the clans_participation answer
 * @param {object} policy the validated policy values
 * @param {Date} at the instant to judge at (a weekly boundary, or now)
 */
export function factsAt(participation, policy, at) {
  const atMs = at.getTime();
  const weeks = participation.weeks.map((w, i) => ({
    i,
    from: Date.parse(w.from),
    to: Date.parse(w.to),
  }));
  // ISO weeks that closed at or before `at`; the week containing `at` is partial.
  const closedWeeks = weeks.filter((w) => w.to <= atMs);
  const lastN = (n) => closedWeeks.slice(-n);
  const warWeeks = participation.war_weeks.map((w, i) => ({
    i,
    season_id: w.season_id,
    section_index: w.section_index,
    finished: w.finished_observed_at
      ? Date.parse(w.finished_observed_at)
      : null,
    started: w.started_observed_at ? Date.parse(w.started_observed_at) : null,
    // War days a member is asked to play (Jamie 2026-09-24): after the
    // boat crosses the line the rest of the week is optional, so a week
    // that finished on day 3 asks for 3. Colosseum has no line: 4.
    required:
      !w.is_colosseum && Number.isInteger(w.finish_war_day)
        ? Math.min(4, Math.max(1, w.finish_war_day))
        : 4,
  }));
  // War weeks that FINISHED before `at` (a week still being fought is not
  // evidence of a rate yet).
  const closedWars = warWeeks.filter(
    (w) => w.finished !== null && w.finished <= atMs,
  );
  const lastWars = (n) => closedWars.slice(-n);
  const firstRoster = participation.first_roster_observed_at
    ? Date.parse(participation.first_roster_observed_at)
    : null;

  return participation.members.map((m) => {
    const joined = m.joined_observed_at
      ? Date.parse(m.joined_observed_at)
      : null;
    const tenureDays =
      m.tenure_known && joined !== null
        ? Math.floor((atMs - joined) / DAY_MS)
        : null;
    const observedDays =
      joined !== null ? Math.floor((atMs - joined) / DAY_MS) : null;

    // Floor window: the last N closed ISO weeks for ranked, the last N
    // closed war weeks for war days.
    const floorWeeks = lastN(policy.floor_window_weeks);
    const rankedInFloor = floorWeeks.reduce(
      (s, w) => s + (m.ranked_battles[w.i] ?? 0),
      0,
    );
    // Decks, not days (Jamie 2026-09-24): the race's own weekly decksUsed
    // never depends on where a day boundary falls, and a day holds at most
    // four decks, so 16 decks is every war day played in full and 12 by a
    // day-3 finish is every day asked for. No day is attributed anywhere.
    const weekDecks = (w) => {
      const d = m.war_decks?.[w.i];
      return Number.isInteger(d) ? d : null;
    };
    const floorWars = lastWars(policy.floor_window_weeks);
    let warDecksInFloor = 0;
    let floorWarFidelity = floorWars.length ? "weekly" : "unknown";
    for (const w of floorWars) {
      const d = weekDecks(w);
      if (d === null) floorWarFidelity = "unknown";
      else warDecksInFloor += d;
    }
    // Whether the member's battle log is recorded at all (Elixir 3.16.0):
    // an unrecorded log makes every battle count a zero by construction,
    // so the ranked floor is unknown for them, never failed.
    const logRecorded =
      typeof m.log_recorded === "boolean" ? m.log_recorded : true;

    // War rate over the last N closed war weeks: decks played over decks
    // asked for (four a day up to the finish, so 16, or 12 or 8 on an early
    // finish). Decks after the finish add to what was played and are never
    // asked for, so they help and skipping them cannot hurt; capped at 1.
    const rateWars = lastWars(policy.war_rate_window_weeks);
    let rateFidelity = rateWars.length ? "weekly" : "unknown";
    const warDaysDetail = [];
    for (const w of rateWars) {
      const d = weekDecks(w);
      if (d === null) {
        rateFidelity = "unknown";
        continue;
      }
      warDaysDetail.push({
        season_id: w.season_id,
        section_index: w.section_index,
        decks: d,
        decks_asked: 4 * w.required,
      });
    }
    const warDecksPlayed = warDaysDetail.reduce((s, w) => s + w.decks, 0);
    const warDecksAsked = warDaysDetail.reduce((s, w) => s + w.decks_asked, 0);
    const warRate = warDecksAsked
      ? Math.min(1, warDecksPlayed / warDecksAsked)
      : 0;

    const rankedWeeks = lastN(policy.ranked_window_weeks);
    const rankedBattles = rankedWeeks.reduce(
      (s, w) => s + (m.ranked_battles[w.i] ?? 0),
      0,
    );
    const battlesWindow = rankedWeeks.reduce(
      (s, w) => s + (m.battles[w.i] ?? 0),
      0,
    );

    const donationWeeks = lastN(policy.donation_window_weeks);
    const known = donationWeeks
      .map((w) => m.donations[w.i])
      .filter((d) => d !== null && d !== undefined);
    const donationsAvg = known.length
      ? known.reduce((a, b) => a + b, 0) / known.length
      : null;

    const lastBattle = m.last_battle_time
      ? Date.parse(m.last_battle_time)
      : null;
    // The inactivity anchor is the LATER of the last battle and the join:
    // imported history can predate the membership (elixir-bot's lesson).
    const anchor = Math.max(lastBattle ?? -Infinity, joined ?? -Infinity);
    const daysIdle = Number.isFinite(anchor) ? (atMs - anchor) / DAY_MS : null;

    return {
      player_tag: m.player_tag,
      name: m.name,
      role: m.role ?? "member",
      joined_observed_at: m.joined_observed_at,
      tenure_days: tenureDays,
      tenure_known: Boolean(m.tenure_known),
      observed_days: observedDays,
      first_roster_observed_at: firstRoster
        ? new Date(firstRoster).toISOString()
        : null,
      floor: {
        weeks: policy.floor_window_weeks,
        war_decks: warDecksInFloor,
        war_fidelity: floorWarFidelity,
        ranked_battles: rankedInFloor,
        log_recorded: logRecorded,
        passes_war:
          floorWarFidelity !== "unknown" &&
          warDecksInFloor >= policy.floor_war_decks &&
          policy.floor_war_decks > 0,
        passes_ranked:
          logRecorded &&
          policy.floor_ranked_battles > 0 &&
          rankedInFloor >= policy.floor_ranked_battles,
      },
      war: {
        weeks: rateWars.length,
        rate: warRate,
        fidelity: rateFidelity,
        decks_played: warDecksPlayed,
        decks_asked: warDecksAsked,
        detail: warDaysDetail,
      },
      ranked: { weeks: rankedWeeks.length, battles: rankedBattles },
      battles: { weeks: rankedWeeks.length, count: battlesWindow },
      donations: {
        weeks: donationWeeks.length,
        known_weeks: known.length,
        average: donationsAvg,
      },
      last_battle_time: m.last_battle_time ?? null,
      days_idle: daysIdle === null ? null : Number(daysIdle.toFixed(2)),
    };
  });
}
