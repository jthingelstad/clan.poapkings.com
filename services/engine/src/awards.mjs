/**
 * Awards: elixir-bot's season awards (engine/awards.py, award_outcomes.py)
 * as per-clan configuration, judged from Elixir's record.
 *
 * A catalog of KINDS, not a rules engine (Jamie, 2026-09-12): each kind is
 * one small function with a few tunable parameters, and every award a
 * clan runs is an instance of a kind with the clan's own name and
 * description. The starting set is the kinds' examples; a clan's policy is
 * Elixir Clan's own and is never described by another clan's name (Jamie
 * 2026-09-24). Free Pass is POAP KINGS' own recognition of its War Champ
 * (a leaders_pick, granted by hand), so only that clan starts with it.
 *
 * Periods are war seasons as the record saw them (war_weeks grouped by
 * season_id). A season is judged only once it is CLOSED (every week
 * finished, and either its Colosseum week is the last or a later season
 * has begun) and COMPLETE (its first section is in the record). Live
 * standings for the open season are provisional and say so.
 *
 * Everything here is pure: participation in, standings and grants-due
 * out. The ledger and the clock are the caller's.
 */

export const AWARDS_SCHEMA_VERSION = 1;
export const MAX_AWARDS = 12;
export const PODIUM_MAX = 3;

/** @type {Record<string, {title:string, rule:string, params:Record<string, any>, computed:boolean}>} */
export const AWARD_KINDS = {
  season_points_podium: {
    title: "Season points podium",
    rule: "The members with the most war points over the season, on the podium in order. Equal points are a tie; the tiebreak decides the order on the podium and the tie is still named.",
    computed: true,
    params: {
      podium: {
        label: "Podium size",
        type: "integer",
        min: 1,
        max: PODIUM_MAX,
        default: 3,
        why: "How many places are granted: 1 names a champion, 3 a podium.",
      },
      tiebreak: {
        label: "Tiebreak",
        type: "enum",
        options: ["donations", "none"],
        default: "donations",
        why: "Equal points: the higher donor takes the higher place, or the tie stands and both hold the place.",
      },
    },
  },
  perfect_attendance: {
    title: "Perfect attendance",
    rule: "Pass or fail, never a ranking: every member who played the decks asked for in every week of the season earns it (four a war day up to the boat's finish, so 16, or 12 when it finished on day 3). Any number can.",
    computed: true,
    params: {
      decks_per_day: {
        label: "Decks required per war day",
        type: "integer",
        min: 1,
        max: 4,
        default: 4,
        why: "Four is every deck the game offers. Three forgives one deck a day.",
      },
      allowed_misses: {
        label: "War days' worth of decks allowed short",
        type: "integer",
        min: 0,
        max: 4,
        default: 0,
        why: "How many war days' worth of decks a member may fall short over the season and still earn it. Zero is perfect.",
      },
    },
  },
  donations_podium: {
    title: "Donations podium",
    rule: "The members who donated the most cards over the season, summing each week's donation counter as the record saw it at week end.",
    computed: true,
    params: {
      podium: {
        label: "Podium size",
        type: "integer",
        min: 1,
        max: PODIUM_MAX,
        default: 3,
        why: "How many places are granted.",
      },
    },
  },
  rookie_podium: {
    title: "Rookie podium",
    rule: "The season points podium among members in their FIRST war season here: joined during this season, or joined during the previous one without playing a war day in it, as far as the record shows. A member whose join predates the record is never a rookie.",
    computed: true,
    params: {
      podium: {
        label: "Podium size",
        type: "integer",
        min: 1,
        max: PODIUM_MAX,
        default: 3,
        why: "How many places are granted.",
      },
    },
  },
  leaders_pick: {
    title: "Leaders' pick",
    rule: "Granted by hand, with a note, to a member for a season. The clan's own recognition: nothing here decides it.",
    computed: false,
    params: {
      granted_by: {
        label: "Who may grant it",
        type: "enum",
        options: ["leaders", "elders"],
        default: "leaders",
        why: "Leaders means the leader and co-leaders; elders adds every elder.",
      },
    },
  },
};

/** The starting awards, as elixir-bot ran them. Free Pass is POAP KINGS'
 *  own and starts only there. */
export function defaultAwards(clanTag = null) {
  return {
    schema: AWARDS_SCHEMA_VERSION,
    awards: [
      {
        id: "war_champ",
        kind: "season_points_podium",
        name: "War Champ",
        description:
          "The season's top war points, on the podium. Ties break on cards donated.",
        enabled: true,
        params: { podium: 3, tiebreak: "donations" },
      },
      {
        id: "iron_king",
        kind: "perfect_attendance",
        name: "Iron King",
        description:
          "Four decks, every war day, every week of the season. Anyone who does it earns it.",
        enabled: true,
        params: { decks_per_day: 4, allowed_misses: 0 },
      },
      {
        id: "donation_champ",
        kind: "donations_podium",
        name: "Donation Champ",
        description: "The most cards donated over the season.",
        enabled: true,
        params: { podium: 3 },
      },
      {
        id: "rookie_mvp",
        kind: "rookie_podium",
        name: "Rookie MVP",
        description:
          "The top war points among members in their first season here.",
        enabled: true,
        params: { podium: 3 },
      },
      ...(clanTag === POAP_KINGS ? [FREE_PASS] : []),
    ],
  };
}

const POAP_KINGS = "#J2RGCRVG";
const FREE_PASS = {
  id: "free_pass",
  kind: "leaders_pick",
  name: "Free Pass",
  description:
    "The War Champ's reward: the highest finisher who did not hold it last season, chosen by the leaders with the podium in view.",
  enabled: true,
  params: { granted_by: "leaders" },
};

const ID_RE = /^[a-z][a-z0-9_]{1,31}$/;

/**
 * Validate a candidate awards document. Returns { ok, values, errors };
 * errors are keyed `awards.<index>.<field>` (or `publish`) in a leader's
 * words. Unknown kinds and parameters are refused; missing parameters take
 * the kind's default.
 */
export function validateAwards(input = {}) {
  const errors = {};
  const list = Array.isArray(input.awards) ? input.awards : null;
  if (!list)
    return {
      ok: false,
      values: null,
      errors: { awards: "Awards must be a list." },
    };
  if (list.length > MAX_AWARDS) errors.awards = `At most ${MAX_AWARDS} awards.`;
  const seen = new Set();
  const awards = list.map((a, i) => {
    const at = (f) => `awards.${i}.${f}`;
    const id = String(a?.id ?? "").trim();
    if (!ID_RE.test(id))
      errors[at("id")] =
        "The id is 2 to 32 characters: lowercase letters, digits and underscores, starting with a letter.";
    else if (seen.has(id)) errors[at("id")] = "Two awards share this id.";
    seen.add(id);
    const kind = AWARD_KINDS[a?.kind];
    if (!kind) {
      errors[at("kind")] = "This is not a kind of award.";
      return null;
    }
    const name = String(a?.name ?? "").trim();
    if (!name || name.length > 40)
      errors[at("name")] = "The name is 1 to 40 characters.";
    const description = String(a?.description ?? "").trim();
    if (description.length > 300)
      errors[at("description")] = "The description is at most 300 characters.";
    const params = {};
    for (const [key, p] of Object.entries(kind.params)) {
      let v = a?.params?.[key];
      if (v === undefined || v === null || v === "") v = p.default;
      if (p.type === "enum") {
        if (!p.options.includes(v)) {
          errors[at(`params.${key}`)] =
            `${p.label} is one of ${p.options.join(", ")}.`;
          continue;
        }
      } else {
        v = typeof v === "string" ? Number(v) : v;
        if (!Number.isInteger(v) || v < p.min || v > p.max) {
          errors[at(`params.${key}`)] =
            `${p.label} is a whole number between ${p.min} and ${p.max}.`;
          continue;
        }
      }
      params[key] = v;
    }
    for (const key of Object.keys(a?.params ?? {}))
      if (!kind.params[key])
        errors[at(`params.${key}`)] = "This is not a setting of this kind.";
    return {
      id,
      kind: a.kind,
      name,
      description,
      enabled: a?.enabled !== false,
      params,
    };
  });
  const ok = Object.keys(errors).length === 0;
  return {
    ok,
    values: ok ? { schema: AWARDS_SCHEMA_VERSION, awards } : null,
    errors,
  };
}

/** One sentence per award: its rule under its parameters, for the docs. */
export function describeAward(award) {
  const k = AWARD_KINDS[award.kind];
  const p = award.params;
  switch (award.kind) {
    case "season_points_podium":
      return `${p.podium === 1 ? "The member" : `The ${p.podium} members`} with the most war points over the season${p.tiebreak === "donations" ? "; equal points break on cards donated" : "; equal points share the place"}.`;
    case "perfect_attendance":
      return `${p.decks_per_day === 4 ? "Every deck" : `At least ${p.decks_per_day} decks a war day`} in every war week of the season, up to the boat's finish${p.allowed_misses ? `, with up to ${p.allowed_misses} day${p.allowed_misses === 1 ? "'s" : "s'"} worth of decks short forgiven` : ""}. Anyone who does it earns it.`;
    case "donations_podium":
      return `${p.podium === 1 ? "The member" : `The ${p.podium} members`} who donated the most cards over the season.`;
    case "rookie_podium":
      return `${p.podium === 1 ? "The rookie" : `The ${p.podium} rookies`} with the most war points in their first season here.`;
    case "leaders_pick":
      return `Granted by hand by the ${p.granted_by === "elders" ? "leaders and elders" : "leaders"}, with a note.`;
    default:
      return k?.rule ?? "";
  }
}

// ---- seasons from the record ------------------------------------------------

/**
 * The war seasons the record shows, oldest first, each with its weeks
 * (indices into participation.war_weeks) and whether it is closed and
 * complete.
 */
export function seasonsFrom(participation, now) {
  const nowMs = now.getTime();
  const byId = new Map();
  participation.war_weeks.forEach((w, i) => {
    const s = byId.get(w.season_id) ?? {
      season_id: w.season_id,
      weeks: [],
    };
    s.weeks.push({
      i,
      section_index: w.section_index,
      is_colosseum: Boolean(w.is_colosseum),
      started: w.started_observed_at ? Date.parse(w.started_observed_at) : null,
      finished: w.finished_observed_at
        ? Date.parse(w.finished_observed_at)
        : null,
      // Days asked for: after an early finish the rest is optional
      // (Jamie 2026-09-24); Colosseum has no finish line.
      required:
        !w.is_colosseum && Number.isInteger(w.finish_war_day)
          ? Math.min(4, Math.max(1, w.finish_war_day))
          : 4,
    });
    byId.set(w.season_id, s);
  });
  const seasons = [...byId.values()].sort((a, b) => a.season_id - b.season_id);
  seasons.forEach((s, idx) => {
    s.weeks.sort((a, b) => a.section_index - b.section_index);
    const allFinished = s.weeks.every(
      (w) => w.finished !== null && w.finished <= nowMs,
    );
    const last = s.weeks[s.weeks.length - 1];
    const laterSeason = idx < seasons.length - 1;
    s.closed = allFinished && (last.is_colosseum || laterSeason);
    s.closed_at = s.closed
      ? new Date(Math.max(...s.weeks.map((w) => w.finished))).toISOString()
      : null;
    s.complete = s.weeks[0].section_index === 0;
    s.started_at = s.weeks[0].started
      ? new Date(s.weeks[0].started).toISOString()
      : null;
  });
  return seasons;
}

/** The ISO week (index) a war week's start falls in, or null. */
function isoWeekOf(participation, startedMs) {
  if (startedMs === null) return null;
  const j = participation.weeks.findIndex(
    (w) => Date.parse(w.from) <= startedMs && startedMs < Date.parse(w.to),
  );
  return j === -1 ? null : j;
}

// ---- ranks, elixir-bot's _assign_ranks --------------------------------------

/** Competition ranks over a sorted list: rank ties on the value, official
 *  rank follows the sort (the tiebreak), tied says whether the value is shared. */
function assignRanks(rows, key) {
  const counts = new Map();
  for (const r of rows) counts.set(r[key], (counts.get(r[key]) ?? 0) + 1);
  let rank = 0;
  let previous;
  rows.forEach((r, idx) => {
    if (r[key] !== previous) rank = idx + 1;
    r.official_rank = idx + 1;
    r.rank = rank;
    r.tied = counts.get(r[key]) > 1;
    previous = r[key];
  });
  return rows;
}

// ---- the kinds --------------------------------------------------------------

function seasonPoints(m, season) {
  let points = 0;
  let weeksPlayed = 0;
  for (const w of season.weeks) {
    const p = m.war_points?.[w.i];
    if (p) {
      points += p;
      weeksPlayed += 1;
    }
  }
  return { points, weeksPlayed };
}

function seasonDonations(participation, m, season) {
  let total = 0;
  let known = 0;
  for (const w of season.weeks) {
    const j = isoWeekOf(participation, w.started);
    const d = j === null ? null : m.donations?.[j];
    if (d !== null && d !== undefined) {
      total += d;
      known += 1;
    }
  }
  return { total, known_weeks: known, weeks: season.weeks.length };
}

function pointsPodium(participation, members, season, params, filter) {
  const donationsByTag = new Map(
    members.map((m) => [
      m.player_tag,
      seasonDonations(participation, m, season).total,
    ]),
  );
  const rows = members
    .filter(filter)
    .map((m) => {
      const { points, weeksPlayed } = seasonPoints(m, season);
      return {
        player_tag: m.player_tag,
        name: m.name,
        points,
        weeks_played: weeksPlayed,
        donations: donationsByTag.get(m.player_tag) ?? 0,
      };
    })
    .filter((r) => r.points > 0)
    .sort((a, b) =>
      b.points !== a.points
        ? b.points - a.points
        : params.tiebreak === "donations" && b.donations !== a.donations
          ? b.donations - a.donations
          : a.player_tag < b.player_tag
            ? -1
            : 1,
    );
  assignRanks(rows, "points");
  // With no tiebreak a tie at the podium's edge keeps every tied member.
  const podium = rows.filter((r) =>
    params.tiebreak === "none"
      ? r.rank <= params.podium
      : r.official_rank <= params.podium,
  );
  return { rows, podium };
}

function attendance(m, season, params) {
  // Decks, not days (Jamie 2026-09-24): each week asks decks_per_day for
  // every war day up to the boat's finish; the race's own weekly count
  // says whether it was met, with no day attributed. Decks after the
  // finish count toward what was played and are never asked for.
  let short = 0;
  let asked = 0;
  let unknownWeeks = 0;
  const weeks = [];
  for (const w of season.weeks) {
    const d = m.war_decks?.[w.i];
    const want = params.decks_per_day * w.required;
    if (!Number.isInteger(d)) {
      unknownWeeks += 1;
      weeks.push({
        section_index: w.section_index,
        decks: null,
        decks_asked: want,
      });
      continue;
    }
    asked += want;
    short += Math.max(0, want - d);
    weeks.push({ section_index: w.section_index, decks: d, decks_asked: want });
  }
  return {
    player_tag: m.player_tag,
    name: m.name,
    decks_short: short,
    decks_asked: asked,
    unknown_weeks: unknownWeeks,
    fidelity: unknownWeeks ? "unknown" : "weekly",
    on_track:
      unknownWeeks === 0 &&
      short <= params.allowed_misses * params.decks_per_day,
    weeks,
  };
}

function rookieFilter(participation, seasons, season) {
  const idx = seasons.indexOf(season);
  const previous = idx > 0 ? seasons[idx - 1] : null;
  const seasonStart = season.weeks[0].started;
  const viewStart = participation.war_weeks.length
    ? Math.min(
        ...participation.war_weeks
          .map((w) =>
            w.started_observed_at ? Date.parse(w.started_observed_at) : null,
          )
          .filter((t) => t !== null),
      )
    : null;
  return (m) => {
    if (!m.tenure_known || !m.joined_observed_at) return false;
    const joined = Date.parse(m.joined_observed_at);
    if (seasonStart !== null && joined >= seasonStart) return true;
    if (!previous || viewStart === null || joined < viewStart) return false;
    // Joined during the previous season without a war day played in it.
    const playedBefore = previous.weeks.some(
      (w) => (m.war_points?.[w.i] ?? 0) > 0,
    );
    return joined >= previous.weeks[0].started && !playedBefore;
  };
}

// ---- the evaluation ---------------------------------------------------------

/**
 * @param {object} args
 * @param {object} args.participation the clans_participation answer (weeks: 8)
 * @param {object} args.config a validated awards document
 * @param {Date} args.now
 * @param {Array} args.grants the ledger's grants for this clan
 * @param {number|string} [args.config_version]
 */
export function evaluateAwards({
  participation,
  config,
  now,
  grants = [],
  config_version = 0,
}) {
  const seasons = seasonsFrom(participation, now);
  const members = participation.members;
  const granted = new Set(grants.map((g) => `${g.season_id}|${g.award_id}`));
  const grantsDue = [];
  const out = seasons.map((season) => {
    const awards = config.awards.map((award) => {
      const kind = AWARD_KINDS[award.kind];
      const base = {
        award_id: award.id,
        kind: award.kind,
        name: award.name,
        description: award.description,
        rule: describeAward(award),
        computed: kind.computed,
      };
      if (!award.enabled) return { ...base, state: "off", rows: [] };
      if (!kind.computed)
        return {
          ...base,
          state: "manual",
          rows: grants
            .filter(
              (g) =>
                g.season_id === season.season_id && g.award_id === award.id,
            )
            .map((g) => ({
              player_tag: g.player_tag,
              name: g.player_name,
              note: g.note ?? null,
              granted_at: g.granted_at,
              granted_by: g.granted_by ?? null,
            })),
        };
      if (!season.complete)
        return {
          ...base,
          state: "held",
          note: "The record does not cover this whole season, so it is not judged.",
          rows: [],
        };
      const state = season.closed ? "closed" : "live";
      let rows = [];
      let due = [];
      if (
        award.kind === "season_points_podium" ||
        award.kind === "rookie_podium"
      ) {
        const filter =
          award.kind === "rookie_podium"
            ? rookieFilter(participation, seasons, season)
            : () => true;
        const { rows: all, podium } = pointsPodium(
          participation,
          members,
          season,
          { ...award.params, tiebreak: award.params.tiebreak ?? "donations" },
          filter,
        );
        rows = all
          .slice(0, 10)
          .map((r) => ({ ...r, on_podium: podium.includes(r) }));
        due = podium.map((r) => ({
          player_tag: r.player_tag,
          player_name: r.name,
          rank: r.official_rank,
          metric_value: r.points,
          metric_unit: "points",
          metadata: {
            weeks_played: r.weeks_played,
            donations_tiebreak: r.donations,
            tied: r.tied,
            points_rank: r.rank,
          },
        }));
      } else if (award.kind === "donations_podium") {
        const all = members
          .map((m) => ({
            player_tag: m.player_tag,
            name: m.name,
            ...seasonDonations(participation, m, season),
          }))
          .filter((r) => r.total > 0)
          .sort((a, b) =>
            b.total !== a.total
              ? b.total - a.total
              : a.player_tag < b.player_tag
                ? -1
                : 1,
          );
        assignRanks(all, "total");
        const podium = all.filter(
          (r) => r.official_rank <= award.params.podium,
        );
        rows = all
          .slice(0, 10)
          .map((r) => ({ ...r, on_podium: podium.includes(r) }));
        due = podium.map((r) => ({
          player_tag: r.player_tag,
          player_name: r.name,
          rank: r.official_rank,
          metric_value: r.total,
          metric_unit: "donations",
          metadata: {
            known_weeks: r.known_weeks,
            weeks: r.weeks,
            tied: r.tied,
          },
        }));
      } else if (award.kind === "perfect_attendance") {
        const all = members.map((m) => attendance(m, season, award.params));
        const onTrack = all.filter((r) => r.on_track);
        const unknown = all.filter((r) => r.unknown_weeks > 0);
        rows = onTrack.map((r) => ({
          player_tag: r.player_tag,
          name: r.name,
          decks_short: r.decks_short,
          decks_asked: r.decks_asked,
          fidelity: r.fidelity,
        }));
        // Fail closed: a week the record cannot see for anyone holds the
        // award for that season rather than crowning the visible.
        if (season.closed && unknown.length === all.length && all.length > 0)
          return {
            ...base,
            state: "held",
            note: "The record has no war days for this season, so nobody is judged.",
            rows: [],
          };
        due = onTrack.map((r) => ({
          player_tag: r.player_tag,
          player_name: r.name,
          rank: 1,
          metric_value: r.decks_asked,
          metric_unit: "war_decks",
          metadata: { decks_short: r.decks_short, fidelity: r.fidelity },
        }));
      }
      if (season.closed && !granted.has(`${season.season_id}|${award.id}`))
        for (const g of due)
          grantsDue.push({
            season_id: season.season_id,
            award_id: award.id,
            kind: award.kind,
            name: award.name,
            config_version,
            manual: false,
            ...g,
          });
      return { ...base, state, rows };
    });
    return {
      season_id: season.season_id,
      started_at: season.started_at,
      closed: season.closed,
      closed_at: season.closed_at,
      complete: season.complete,
      weeks: season.weeks.length,
      awards,
    };
  });
  return {
    evaluated_at: now.toISOString(),
    as_of: participation.meta?.as_of ?? null,
    freshness_seconds: participation.meta?.freshness_seconds ?? null,
    config_version,
    // The roster as the record has it, for a leaders' pick's picker.
    members: members.map((m) => ({
      player_tag: m.player_tag,
      name: m.name ?? null,
      role: m.role ?? "member",
    })),
    seasons: out.reverse(),
    grants_due: grantsDue,
  };
}
