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

/** The running season's standings as facts, keyed by ref. */
export function standingsFrom(result) {
  const out = new Map();
  const season = (result?.seasons ?? []).find((s) => !s.closed && s.complete);
  if (!season) return { season_id: null, facts: out };
  const asOf = result.as_of ?? result.evaluated_at;
  for (const award of season.awards) {
    if (award.state !== "live" || !award.computed || !UNIT[award.kind])
      continue;
    const rows =
      award.kind === "perfect_attendance"
        ? award.rows
            .slice(0, 10)
            .map((r) => ({ ...r, place: 1, value: r.decks_asked }))
        : award.rows
            .filter((r) => r.on_podium)
            .map((r) => ({
              ...r,
              place: r.official_rank,
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
  return { season_id: season.season_id, facts: out };
}

/**
 * What to write and remove against what was shared last time (`prev`,
 * { refs: { ref: { place, player_tag, award_id } } } or null): a fact
 * whose place is new or moved is written; a ref no longer standing is
 * removed. A first place that changed hands names who held it before.
 */
export function planStandings(prev, current) {
  const before = prev?.refs ?? {};
  const leaderBefore = new Map();
  // A podium's first place changes hands; an attendance award has no
  // leader (everyone on track is first), so it never names one.
  for (const [, s] of Object.entries(before))
    if (s.place === 1 && s.unit !== "war_decks")
      leaderBefore.set(s.award_id, s.player_tag);
  const writes = [];
  const refs = {};
  for (const [ref, fact] of current.facts) {
    const d = fact.detail;
    refs[ref] = {
      place: d.place,
      player_tag: fact.player_tag,
      award_id: d.award_id,
      unit: d.unit,
    };
    const was = before[ref];
    if (was && was.place === d.place) continue;
    const previous = leaderBefore.get(d.award_id);
    writes.push(
      d.place === 1 &&
        d.unit !== "war_decks" &&
        previous &&
        previous !== fact.player_tag
        ? { ...fact, detail: { ...d, previous_player_tag: previous } }
        : fact,
    );
  }
  const removes = Object.keys(before).filter((ref) => !(ref in refs));
  return { writes, removes, next: { season_id: current.season_id, refs } };
}
