/**
 * One member's own view of themselves in their clan (round 4 of the build
 * loop, 2026-09-25): their numbers week by week from Elixir's
 * participation read, this week so far, and their time here. Statistics
 * only: it works for any clan, with or without a policy. What the clan's
 * policy makes of the numbers is added by the caller from `evaluate`.
 * Pure: the participation answer, a roster and a tag in; one member out.
 */

const DAY_MS = 86400_000;

/** Days a war week asks for: four a day up to the clan's finish, or all
 *  four days in Colosseum (null while the week is open). */
function daysAsked(w) {
  if (!w.finished_observed_at) return null;
  if (w.is_colosseum) return 4;
  return Number.isInteger(w.finish_war_day)
    ? Math.min(4, Math.max(1, w.finish_war_day))
    : 4;
}

/**
 * @param {object} participation the clans_participation answer
 * @param {string} tag the member's player tag
 * @param {object} [roster] the clans_roster answer (trophies, role events)
 * @param {Date} [now]
 * @returns {object|null} null when the tag is not on the clan's roster
 */
export function memberWeeks(
  participation,
  tag,
  roster = null,
  now = new Date(),
) {
  const m = participation.members.find((x) => x.player_tag === tag);
  if (!m) return null;
  const iso = participation.weeks.map((w, i) => ({
    iso_week: w.iso_week ?? null,
    from: w.from,
    to: w.to,
    complete: w.complete !== false && Date.parse(w.to) <= now.getTime(),
    battles: m.battles?.[i] ?? null,
    ranked_battles: m.ranked_battles?.[i] ?? null,
    donations: m.donations?.[i] ?? null,
  }));
  const war = participation.war_weeks.map((w, i) => {
    const decks = m.war_decks?.[i];
    const days = daysAsked(w);
    return {
      season_id: w.season_id,
      section_index: w.section_index,
      is_colosseum: Boolean(w.is_colosseum),
      started_at: w.started_observed_at ?? null,
      finished_at: w.finished_observed_at ?? null,
      open: !w.finished_observed_at,
      decks: Number.isInteger(decks) ? decks : null,
      decks_asked: days === null ? null : 4 * days,
      points: m.war_points?.[i] ?? null,
    };
  });
  const r = roster?.members?.find((x) => x.player_tag === tag) ?? null;
  const joined = m.joined_observed_at ? Date.parse(m.joined_observed_at) : null;
  const events = (roster?.recent_events ?? [])
    .filter((e) => e.detail?.player_tag === tag)
    .filter((e) => e.type === "member_joined" || e.type === "role_changed")
    .map((e) => ({
      type: e.type,
      at: e.at,
      role_before: e.detail.role_before ?? null,
      role_after: e.detail.role_after ?? null,
    }))
    .sort((a, b) => (a.at < b.at ? 1 : -1));
  return {
    player_tag: m.player_tag,
    name: m.name ?? r?.name ?? null,
    role: m.role ?? r?.role ?? "member",
    this_week: iso.find((w) => !w.complete) ?? null,
    this_war_week: war.find((w) => w.open) ?? null,
    weeks: iso,
    war_weeks: war,
    trophies: r?.trophies ?? null,
    last_battle_time: m.last_battle_time ?? null,
    time_here: {
      joined_observed_at: m.joined_observed_at ?? null,
      tenure_known: Boolean(m.tenure_known),
      days:
        joined === null ? null : Math.floor((now.getTime() - joined) / DAY_MS),
      recording_since:
        participation.first_roster_observed_at ??
        participation.recording_active_since ??
        null,
      events,
    },
  };
}
