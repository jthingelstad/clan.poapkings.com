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
 * Credit for ONE war day, elixir-bot's `_war_day_credit`: finishing is
 * worth more than the decks say.
 *   credit = (1 - bonus) * used/available + bonus * (complete ? 1 : 0)
 */
export function warDayCredit(used, available, fullDayBonus) {
  if (!available) return 0;
  const u = Math.max(0, Math.min(used ?? 0, available));
  const fraction = u / available;
  const complete = u >= available ? 1 : 0;
  return (1 - fullDayBonus) * fraction + fullDayBonus * complete;
}

/**
 * A war week's per-day decks as the record knows them. Polled days are
 * exact; a week with no polled day at all falls back to its weekly total
 * spread over the days the member's recorded war battles fell on (or, with
 * no battle record either, evenly over four days). The fidelity rides along.
 */
export function warWeekDays(decks, decksByDay, battlesByDay) {
  const polled = (decksByDay ?? []).some((d) => d !== null && d !== undefined);
  if (polled)
    return {
      fidelity: "daily",
      days: [0, 1, 2, 3].map((i) => decksByDay[i] ?? 0),
    };
  if (decks === null || decks === undefined)
    return { fidelity: "unknown", days: null };
  const battled = (battlesByDay ?? []).map((b) => (b > 0 ? 1 : 0));
  const battledDays = battled.reduce((a, b) => a + b, 0);
  if (decks === 0) return { fidelity: "weekly", days: [0, 0, 0, 0] };
  if (battledDays > 0) {
    // Spread the weekly total over the days that saw a battle, capped at 4.
    let left = decks;
    let remaining = battledDays;
    const days = battled.map((b) => {
      if (!b) return 0;
      const share = Math.min(4, Math.ceil(left / remaining));
      left -= share;
      remaining -= 1;
      return share;
    });
    return { fidelity: "weekly", days };
  }
  const full = Math.floor(decks / 4);
  const rest = decks % 4;
  const days = [0, 1, 2, 3].map((i) => (i < full ? 4 : i === full ? rest : 0));
  return { fidelity: "weekly", days };
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
    const floorWars = lastWars(policy.floor_window_weeks);
    let warDaysInFloor = 0;
    let floorWarFidelity = floorWars.length ? "daily" : "unknown";
    for (const w of floorWars) {
      // Elixir 3.16.0 counts the days battled itself (polls and recorded
      // war battles, null without coverage); the spread below is the
      // fallback for an older door or an uncovered week.
      const counted = m.war_days_battled?.[w.i];
      if (Number.isInteger(counted)) {
        warDaysInFloor += counted;
        continue;
      }
      const ww = warWeekDays(
        m.war_decks[w.i],
        m.war_decks_by_day?.[w.i],
        m.war_battles_by_day?.[w.i],
      );
      if (ww.fidelity === "unknown") floorWarFidelity = "unknown";
      else {
        if (ww.fidelity === "weekly" && floorWarFidelity !== "unknown")
          floorWarFidelity = "weekly";
        warDaysInFloor += ww.days.filter((d) => d > 0).length;
      }
    }
    // Whether the member's battle log is recorded at all (Elixir 3.16.0):
    // an unrecorded log makes every battle count a zero by construction,
    // so the ranked floor is unknown for them, never failed.
    const logRecorded =
      typeof m.log_recorded === "boolean" ? m.log_recorded : true;

    // War rate over the last N closed war weeks: per-day credit averaged
    // over every war day in the window.
    const rateWars = lastWars(policy.war_rate_window_weeks);
    const credits = [];
    let rateFidelity = rateWars.length ? "daily" : "unknown";
    const warDaysDetail = [];
    for (const w of rateWars) {
      const ww = warWeekDays(
        m.war_decks[w.i],
        m.war_decks_by_day?.[w.i],
        m.war_battles_by_day?.[w.i],
      );
      if (ww.fidelity === "unknown") {
        rateFidelity = "unknown";
        continue;
      }
      if (ww.fidelity === "weekly" && rateFidelity !== "unknown")
        rateFidelity = "weekly";
      for (const d of ww.days)
        credits.push(warDayCredit(d, 4, policy.full_day_bonus));
      warDaysDetail.push({
        season_id: w.season_id,
        section_index: w.section_index,
        decks: ww.days,
        fidelity: ww.fidelity,
      });
    }
    const warRate = credits.length
      ? credits.reduce((a, b) => a + b, 0) / credits.length
      : 0;
    const warDecksPlayed = warDaysDetail.reduce(
      (s, w) => s + w.decks.reduce((a, b) => a + b, 0),
      0,
    );
    const warDaysPlayed = warDaysDetail.reduce(
      (s, w) => s + w.decks.filter((d) => d > 0).length,
      0,
    );
    const warDaysAvailable = warDaysDetail.length * 4;

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
        war_days: warDaysInFloor,
        war_fidelity: floorWarFidelity,
        ranked_battles: rankedInFloor,
        log_recorded: logRecorded,
        passes_war:
          floorWarFidelity !== "unknown" &&
          warDaysInFloor >= policy.floor_war_days &&
          policy.floor_war_days > 0,
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
        days_played: warDaysPlayed,
        days_available: warDaysAvailable,
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
