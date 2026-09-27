/**
 * The week in the clan (2026-09-27): the weekly clan report, as a page
 * first; the email waits on Elixir's mail kind for it. Pure: Elixir's
 * participation answer, the roster's recent events and the clan's policy
 * in; one week out.
 *
 * Jamie's calls: the week is tied to the Monday reset (it closes when the
 * war week that ends that Monday finishes, or at the game's 10:00 UTC
 * Monday reset, whichever comes first); everyone who took part is named,
 * with what they did, and nobody who did not is listed; what the report
 * highlights is what the clan's active policy counts, and with no policy
 * (or one that counts nothing) where the clan was busiest; a member who
 * left is "departed", never kicked or left.
 */

import { countedCategories } from "./policy.mjs";

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;
/** The game's daily reset is 10:00 UTC; Monday's closes the week. */
export const WEEK_RESET_HOURS = 10;

/** The report's areas, in the order they are shown when nothing else
 *  orders them. Trophy road has no weekly number in the record, so a
 *  clan that counts it is shown the battles its members played. */
export const WEEK_AREAS = ["war", "donations", "ranked", "battles"];
export const WEEK_AREA_LABELS = {
  war: "Clan Wars",
  donations: "Donations",
  ranked: "Ranked play",
  battles: "Battles",
};
const AREA_OF_CATEGORY = {
  war: "war",
  ranked: "ranked",
  donations: "donations",
  trophies: "battles",
};
const COLUMN = {
  donations: "donations",
  ranked: "ranked_battles",
  battles: "battles",
};
const ROLE_ORDER = ["member", "elder", "coLeader", "leader"];

/** Days a finished war week asked for: four decks a day up to the clan's
 *  finish, or all four days in Colosseum (null while the week is open). */
export function warDaysAsked(w) {
  if (!w?.finished_observed_at) return null;
  if (w.is_colosseum) return 4;
  return Number.isInteger(w.finish_war_day)
    ? Math.min(4, Math.max(1, w.finish_war_day))
    : 4;
}

/** The war week that belongs to an ISO week: the one that finished at the
 *  Monday reset ending it, or, still running, the one that began at the
 *  Monday reset opening it. */
function warIndexFor(participation, week) {
  const from = Date.parse(week.from);
  const to = Date.parse(week.to);
  const ww = participation.war_weeks ?? [];
  const finished = ww.findIndex((w) => {
    const f = Date.parse(w.finished_observed_at ?? "");
    return f >= to && f < to + DAY_MS;
  });
  if (finished >= 0) return finished;
  return ww.findIndex((w) => {
    if (w.finished_observed_at) return false;
    const s = Date.parse(w.started_observed_at ?? "");
    return s >= from && s < from + DAY_MS;
  });
}

/** When a week's report is final: its war week's finish, or the Monday
 *  reset after it, whichever is first. */
function closesAt(participation, week) {
  const reset = Date.parse(week.to) + WEEK_RESET_HOURS * HOUR_MS;
  const wi = warIndexFor(participation, week);
  const finished = Date.parse(
    participation.war_weeks?.[wi]?.finished_observed_at ?? "",
  );
  return Number.isFinite(finished) ? Math.min(finished, reset) : reset;
}

/** The closed weeks a report can be about, newest first. */
export function reportWeeks(participation, now = new Date()) {
  const t = now.getTime();
  return (participation.weeks ?? [])
    .map((w, i) => ({ w, i, closes: closesAt(participation, w) }))
    .filter(({ closes }) => closes <= t)
    .reverse()
    .map(({ w, i, closes }) => ({
      index: i,
      iso_week: w.iso_week ?? null,
      from: w.from,
      to: w.to,
      closed_at: new Date(closes).toISOString(),
    }));
}

/** Who could have taken part in a week: members whose current stint began
 *  before it ended; `joined_during` for a stint that began inside it. */
function membersOf(participation, week) {
  const from = Date.parse(week.from);
  const to = Date.parse(week.to);
  return (participation.members ?? [])
    .map((m) => {
      const joined = Date.parse(m.joined_observed_at ?? "");
      return {
        m,
        joined_during:
          m.tenure_known !== false &&
          Number.isFinite(joined) &&
          joined >= from &&
          joined < to,
        after: Number.isFinite(joined) && joined >= to,
      };
    })
    .filter((x) => !x.after);
}

const byValue = (a, b) =>
  b.value - a.value || String(a.name).localeCompare(String(b.name));

/** One area of one week: its total and everyone who took part. */
function area(key, participation, week, index, members) {
  if (key === "war") {
    const wi = warIndexFor(participation, week);
    if (wi < 0) return null;
    // A war week nobody has a reading for is unknown, not a week of zero.
    if (!members.some(({ m }) => Number.isInteger(m.war_decks?.[wi])))
      return null;
    const w = participation.war_weeks[wi];
    const days = warDaysAsked(w);
    const asked = days === null ? null : 4 * days;
    const rows = members
      .map(({ m, joined_during }) => ({
        player_tag: m.player_tag,
        name: m.name ?? null,
        value: m.war_decks?.[wi],
        points: m.war_points?.[wi] ?? null,
        joined_during,
      }))
      .filter((r) => Number.isInteger(r.value) && r.value > 0)
      .map((r) => ({
        ...r,
        all_decks: asked !== null && r.value >= asked,
      }))
      .sort(byValue);
    const points = rows.every((r) => r.points === null)
      ? null
      : rows.reduce((s, r) => s + (r.points ?? 0), 0);
    return {
      key,
      label: WEEK_AREA_LABELS[key],
      total: rows.reduce((s, r) => s + r.value, 0),
      points,
      war: {
        season_id: w.season_id ?? null,
        section_index: w.section_index ?? null,
        is_colosseum: Boolean(w.is_colosseum),
        finished_early: w.finished_early === true,
        finish_war_day: Number.isInteger(w.finish_war_day)
          ? w.finish_war_day
          : null,
        decks_asked: asked,
        all_decks: rows.filter((r) => r.all_decks).length,
      },
      participants: rows,
    };
  }
  const col = COLUMN[key];
  const rows = members
    .map(({ m, joined_during }) => ({
      player_tag: m.player_tag,
      name: m.name ?? null,
      value: m[col]?.[index],
      joined_during,
    }))
    .filter((r) => Number.isFinite(r.value) && r.value > 0)
    .sort(byValue);
  // A week with no reading for anyone is not a week of nothing.
  const read = members.some(({ m }) => Number.isFinite(m[col]?.[index]));
  if (!read) return null;
  return {
    key,
    label: WEEK_AREA_LABELS[key],
    total: rows.reduce((s, r) => s + r.value, 0),
    participants: rows,
  };
}

/** The roster's joins, departures and role changes inside [from, to). */
function membership(roster, from, to, names) {
  const events = roster?.recent_events ?? [];
  const inWeek = events
    .filter((e) => e.detail?.player_tag)
    .filter((e) => {
      const at = Date.parse(e.at);
      return at >= from && at < to;
    })
    .sort((a, b) => (a.at < b.at ? -1 : 1));
  const who = (e) => ({
    player_tag: e.detail.player_tag,
    name: e.detail.name ?? names.get(e.detail.player_tag) ?? null,
    at: e.at,
  });
  const out = { joined: [], departed: [], promoted: [], demoted: [] };
  for (const e of inWeek) {
    if (e.type === "member_joined") out.joined.push(who(e));
    else if (e.type === "member_left") out.departed.push(who(e));
    else if (e.type === "role_changed") {
      const before = ROLE_ORDER.indexOf(e.detail.role_before);
      const after = ROLE_ORDER.indexOf(e.detail.role_after);
      if (before < 0 || after < 0 || before === after) continue;
      out[after > before ? "promoted" : "demoted"].push({
        ...who(e),
        role_before: e.detail.role_before,
        role_after: e.detail.role_after,
      });
    }
  }
  const oldest = events
    .map((e) => Date.parse(e.at))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];
  return {
    ...out,
    // The roster's recent events reach back only so far: say so rather
    // than show an older week as one where nobody came or went.
    events_from: oldest === undefined ? null : new Date(oldest).toISOString(),
    complete: oldest !== undefined && oldest <= from,
  };
}

/**
 * Which areas the report highlights, and why. An active policy that
 * counts something highlights exactly that; otherwise the areas at least
 * half the clan took part in, or the busiest one when none reaches half.
 */
function highlights(areas, policy, members) {
  const counted = policy
    ? [...new Set(countedCategories(policy).map((c) => AREA_OF_CATEGORY[c]))]
    : [];
  const present = new Map(areas.map((a) => [a.key, a]));
  const declared = counted.filter((k) => present.has(k));
  if (counted.length) return { basis: "policy", keys: declared, counted };
  const busy = [...areas].sort(
    (a, b) =>
      b.participants.length - a.participants.length ||
      WEEK_AREAS.indexOf(a.key) - WEEK_AREAS.indexOf(b.key),
  );
  const half = busy.filter(
    (a) => members > 0 && a.participants.length * 2 >= members,
  );
  const keys = (
    half.length ? half : busy.slice(0, 1).filter((a) => a.participants.length)
  ).map((a) => a.key);
  return { basis: "activity", keys, counted: [] };
}

/**
 * @param {object} participation the clans_participation answer
 * @param {object} [opts]
 * @param {object} [opts.roster] the clans_roster answer (recent events)
 * @param {object} [opts.policy] the clan's ACTIVE policy values, or null
 * @param {Date} [opts.now]
 * @param {string} [opts.week] an ISO week id ("2026-W38"); the latest
 *   closed week when omitted
 * @returns {object|null} null when there is no such closed week
 */
export function weeklyReport(
  participation,
  { roster = null, policy = null, now = new Date(), week = null } = {},
) {
  const closed = reportWeeks(participation, now);
  const wanted = week ? String(week).toUpperCase() : null;
  const pick = wanted
    ? closed.find((w) => String(w.iso_week).toUpperCase() === wanted)
    : closed[0];
  const names = new Map(
    [...(roster?.members ?? []), ...(participation.members ?? [])]
      .filter((m) => m.name)
      .map((m) => [m.player_tag, m.name]),
  );
  const weeks = closed.map(({ iso_week, from, to }) => ({
    iso_week,
    from,
    to,
  }));
  const soFar = thisWeekSoFar(participation, now);
  if (!pick) return wanted ? null : { week: null, weeks, so_far: soFar };
  const w = participation.weeks[pick.index];
  const members = membersOf(participation, w);
  const areas = WEEK_AREAS.map((k) =>
    area(k, participation, w, pick.index, members),
  ).filter(Boolean);
  const hl = highlights(areas, policy, members.length);
  const order = (a) => {
    const i = hl.keys.indexOf(a.key);
    return i >= 0 ? i : hl.keys.length + WEEK_AREAS.indexOf(a.key);
  };
  return {
    week: {
      iso_week: pick.iso_week,
      from: pick.from,
      to: pick.to,
      closed_at: pick.closed_at,
    },
    members: members.length,
    joined_during: members.filter((x) => x.joined_during).length,
    highlight: { basis: hl.basis, counted: hl.counted },
    areas: [...areas]
      .sort((a, b) => order(a) - order(b))
      .map((a) => ({ ...a, highlighted: hl.keys.includes(a.key) })),
    membership: membership(
      roster,
      Date.parse(pick.from),
      Date.parse(pick.to),
      names,
    ),
    weeks,
    so_far: soFar,
  };
}

/** The week still running: each area's total and how many took part. */
function thisWeekSoFar(participation, now) {
  const t = now.getTime();
  const index = (participation.weeks ?? []).findIndex(
    (w) => Date.parse(w.from) <= t && t < Date.parse(w.to),
  );
  if (index < 0) return null;
  const w = participation.weeks[index];
  const members = membersOf(participation, w);
  const areas = WEEK_AREAS.map((k) => {
    if (k === "war") {
      const ww = participation.war_weeks ?? [];
      const wi = ww.findIndex((x) => !x.finished_observed_at);
      if (wi < 0) return null;
      if (!members.some(({ m }) => Number.isInteger(m.war_decks?.[wi])))
        return null;
      const played = members
        .map(({ m }) => m.war_decks?.[wi])
        .filter((v) => Number.isInteger(v) && v > 0);
      return {
        key: k,
        label: WEEK_AREA_LABELS[k],
        total: played.reduce((s, v) => s + v, 0),
        took_part: played.length,
      };
    }
    const a = area(k, participation, w, index, members);
    return a
      ? {
          key: k,
          label: a.label,
          total: a.total,
          took_part: a.participants.length,
        }
      : null;
  }).filter(Boolean);
  return { iso_week: w.iso_week ?? null, from: w.from, areas };
}
