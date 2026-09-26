/**
 * Award standings to Elixir (2026-09-25; Jamie: "Do the mid season
 * standings"). Each morning the clan's awards are evaluated on Elixir
 * Clan's integration key; where each member stands in a race still running
 * goes to Elixir as an `award_standing` fact (JSON API 2.6.0), the app's
 * own word, so the clan's Discord agent can say who leads, in the clan's
 * own terms, and notice when the lead changes hands.
 *
 * Quiet by design: one fact per member per award, written only when that
 * member's place in it changes (a member reaching the podium, moving on it,
 * or getting on track for an attendance award), taken back when they leave
 * it. Every member's timeline shows these facts, so a daily rewrite of
 * values that moved by a few points would be noise. The fact's `value` and
 * `as_of` are those of the morning its place changed.
 *
 * Pure: the evaluation in, what to write and remove out; the service does
 * the I/O and keeps what was shared (ledger `standings#<clan>`).
 */

const UNIT = {
  season_points_podium: "points",
  rookie_podium: "points",
  donations_podium: "donations",
  perfect_attendance: "war_decks",
};

/** The standings as facts, keyed by ref: the running season's, and the
 *  latest closed season's final places, which stay up until the next
 *  season closes (a grant reaches Elixir only when a leader announces it,
 *  and that action starts off, so without them the season's result
 *  vanished from the clan's agent the morning it closed). */
export function standingsFrom(result) {
  const out = new Map();
  const complete = (result?.seasons ?? []).filter((s) => s.complete);
  const running = complete.find((s) => !s.closed);
  const closed = complete
    .filter((s) => s.closed)
    .sort((a, z) => z.season_id - a.season_id)[0];
  const seasons = [running, closed].filter(Boolean);
  if (!seasons.length) return { season_id: null, season_ids: [], facts: out };
  const asOf = result.as_of ?? result.evaluated_at;
  for (const season of seasons)
    for (const award of season.awards) {
      const want = season.closed ? "closed" : "live";
      if (award.state !== want || !award.computed || !UNIT[award.kind])
        continue;
      // Everyone on track holds an attendance award's one place, however
      // many, once a week has finished (before that nothing has been asked
      // and everyone is trivially on track); a podium's places are the
      // engine's (a tie shares one).
      const rows =
        award.kind === "perfect_attendance"
          ? award.rows
              .filter((r) => r.decks_asked > 0)
              .map((r) => ({ ...r, place: 1, value: r.decks_asked }))
          : award.rows
              .filter((r) => r.on_podium)
              .map((r) => ({
                ...r,
                place: r.place ?? r.official_rank,
                value: award.kind === "donations_podium" ? r.total : r.points,
              }));
      for (const r of rows) {
        if (!r.player_tag || !Number.isInteger(r.place)) continue;
        const ref = `standing:${season.season_id}:${award.award_id}:${r.player_tag}`;
        out.set(ref, {
          type: "award_standing",
          ref,
          player_tag: r.player_tag,
          occurred_at: asOf,
          detail: {
            award: String(award.name ?? award.award_id).slice(0, 60),
            award_id: String(award.award_id).slice(0, 40),
            season_id: season.season_id,
            place: Math.min(10, Math.max(1, r.place)),
            value: Math.max(0, Math.round(Number(r.value) || 0)),
            unit: UNIT[award.kind],
            as_of: asOf,
          },
        });
      }
    }
  return {
    season_id: running?.season_id ?? closed.season_id,
    season_ids: seasons.map((s) => s.season_id),
    facts: out,
  };
}

/**
 * What to write and remove against what was shared last time (`prev`,
 * { refs: { ref: { place, player_tag, award_id } } } or null): a fact
 * whose place is new or moved is written; a ref no longer standing is
 * removed. A first place that changed hands names who held it before.
 */
export function planStandings(prev, current) {
  const before = prev?.refs ?? {};
  // A podium's first place changes hands when one member held it and one
  // other member holds it now, in the same season and award. A tie for
  // first has no single leader, and an attendance award has none at all
  // (everyone on track is first), so neither ever names one.
  const leaders = (entries) => {
    const firsts = new Map();
    for (const s of entries)
      if (s.place === 1 && s.unit !== "war_decks") {
        const k = `${s.season_id}|${s.award_id}`;
        firsts.set(k, [...(firsts.get(k) ?? []), s.player_tag]);
      }
    return new Map(
      [...firsts]
        .filter(([, tags]) => tags.length === 1)
        .map(([k, [t]]) => [k, t]),
    );
  };
  const refs = {};
  for (const [ref, fact] of current.facts) {
    const d = fact.detail;
    refs[ref] = {
      place: d.place,
      player_tag: fact.player_tag,
      award_id: d.award_id,
      award: d.award,
      season_id: d.season_id,
      unit: d.unit,
    };
  }
  const leaderBefore = leaders(Object.values(before));
  const leaderNow = leaders(Object.values(refs));
  const writes = [];
  for (const [ref, fact] of current.facts) {
    const d = fact.detail;
    const was = before[ref];
    // Unchanged: the same place, and the award still named as it was (a
    // renamed award rewrites its standings so Elixir says the new name).
    if (
      was &&
      was.place === d.place &&
      (was.award === undefined || was.award === d.award)
    )
      continue;
    const k = `${d.season_id}|${d.award_id}`;
    const previous = leaderBefore.get(k);
    writes.push(
      d.place === 1 &&
        leaderNow.get(k) === fact.player_tag &&
        previous &&
        previous !== fact.player_tag
        ? { ...fact, detail: { ...d, previous_player_tag: previous } }
        : fact,
    );
  }
  const removes = Object.keys(before).filter((ref) => !(ref in refs));
  return {
    writes,
    removes,
    next: {
      season_id: current.season_id,
      season_ids: current.season_ids,
      refs,
    },
  };
}
