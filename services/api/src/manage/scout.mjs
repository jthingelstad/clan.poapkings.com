/**
 * Scout an applicant: a tag pasted from the game, read live with the
 * leader's own live lane, judged against this clan's policy today.
 *
 * Two live reads: players_profile (trophies, Path of Legends, years played,
 * war-day wins, donations) and battles_query (the last log). Both are
 * asynchronous on Elixir: fresh if in hand, else queued and answered
 * `live_pending` with retry_after_s, which is passed through so the page
 * asks again. Facts from Elixir; the policy answer is this app's.
 */

import { normalizeTag } from "../gate.mjs";

const DAY_MS = 86400_000;

/** A badge's lifetime progress (ClanWarWins, ClanDonations), or null. */
function badge(profile, name) {
  const b = Array.isArray(profile.badges)
    ? profile.badges.find((x) => x.name === name)
    : null;
  return b ? (b.progress ?? null) : null;
}

export function createScout({ mcp, now = () => Date.now() }) {
  return async function scout({
    token,
    tagInput,
    policy,
    clanMedianDonations = null,
  }) {
    const tag = normalizeTag(tagInput);
    if (!tag) return { ok: false, code: "invalid_tag" };
    const profile = await mcp.callTool(token, "players_profile", {
      player_tag: tag,
      live: true,
    });
    if (!profile.ok && profile.code !== "live_pending")
      return {
        ok: false,
        code: profile.code ?? "elixir_unavailable",
        error: profile.error,
        hint: profile.hint,
        status: profile.status,
      };
    const log = await mcp.callTool(token, "battles_query", {
      player_tag: tag,
      live: true,
      limit: 25,
      verbosity: "compact",
    });
    const pendingFrom = (r) => {
      if (r.ok) {
        const ls = r.body?.live_status;
        return ls?.state === "pending" ? (ls.retry_after_s ?? 30) : null;
      }
      // error.retry_after_s is a field since Elixir 3.14.0; the hint's
      // English is the fallback for an older door.
      if (r.code === "live_pending")
        return (
          r.body?.error?.retry_after_s ??
          (r.body?.error?.hint?.match(/(\d+)/)?.[1]
            ? Number(r.body.error.hint.match(/(\d+)/)[1])
            : 30)
        );
      return null;
    };
    const pending = pendingFrom(profile) ?? pendingFrom(log);
    const t = now();
    const p = profile.ok ? profile.body : null;
    const battles =
      log.ok && Array.isArray(log.body?.battles) ? log.body.battles : [];
    // Windows over the last log: the floor window and the removal clock.
    const floorFrom = t - policy.floor_window_weeks * 7 * DAY_MS;
    const inFloor = battles.filter(
      (b) => Date.parse(b.battle_time) >= floorFrom,
    );
    // Elixir's own grouping (packages/contracts modes): pathOfLegend is
    // ranked; riverRacePvP, riverRaceDuel(Colosseum) and boatBattle are war.
    const isRanked = (b) => b.type === "pathOfLegend";
    const isWar = (b) => /^(riverRace|boatBattle)/.test(b.type ?? "");
    const rankedInFloor = inFloor.filter(isRanked).length;
    const warDays = new Set(
      inFloor.filter(isWar).map((b) => b.battle_time.slice(0, 10)),
    );
    const last =
      battles.map((b) => Date.parse(b.battle_time)).sort((a, b) => b - a)[0] ??
      null;
    const daysIdle = last ? Number(((t - last) / DAY_MS).toFixed(2)) : null;
    const wins = battles.filter((b) => b.me?.outcome === "win").length;
    const losses = battles.filter((b) => b.me?.outcome === "loss").length;
    const passesWar =
      policy.floor_war_days > 0 && warDays.size >= policy.floor_war_days;
    const passesRanked =
      policy.floor_ranked_battles > 0 &&
      rankedInFloor >= policy.floor_ranked_battles;
    const oldest =
      battles.map((b) => Date.parse(b.battle_time)).sort((a, b) => a - b)[0] ??
      null;
    const logCoversFloor = oldest !== null && oldest <= floorFrom;
    return {
      ok: true,
      player_tag: tag,
      pending: pending ? { retry_after_s: pending } : null,
      profile: p
        ? {
            name: p.name ?? null,
            clan: p.clan ?? null,
            last_seen_in_game: p.last_seen_in_game ?? null,
            trophies: p.snapshot?.trophies ?? null,
            best_trophies: p.attributes?.best_trophies ?? null,
            path_of_legend: p.snapshot?.path_of_legend ?? null,
            years_played: p.attributes?.years_played ?? null,
            account_age_days: p.attributes?.account_age_days ?? null,
            clan_war_wins: badge(p, "ClanWarWins"),
            clan_donations: badge(p, "ClanDonations"),
            donations_this_week: p.snapshot?.donations_this_week ?? null,
            battle_count: p.snapshot?.lifetime?.battleCount ?? null,
            wins: p.snapshot?.lifetime?.wins ?? null,
            losses: p.snapshot?.lifetime?.losses ?? null,
            collection_level: p.snapshot?.lifetime?.collectionLevel ?? null,
            snapshot_date: p.snapshot?.date ?? null,
            as_of: p.meta?.as_of ?? null,
            freshness_seconds: p.meta?.freshness_seconds ?? null,
            live_status: p.live_status ?? null,
          }
        : null,
      log: {
        battles: battles.length,
        oldest: oldest ? new Date(oldest).toISOString() : null,
        newest: last ? new Date(last).toISOString() : null,
        wins,
        losses,
        win_rate:
          wins + losses ? Number((wins / (wins + losses)).toFixed(3)) : null,
        ranked_in_window: rankedInFloor,
        war_days_in_window: warDays.size,
        covers_window: logCoversFloor,
        as_of: log.ok ? (log.body?.meta?.as_of ?? null) : null,
      },
      policy_answer: {
        floor: {
          passes: passesWar || passesRanked,
          war: {
            days: warDays.size,
            needed: policy.floor_war_days,
            passes: passesWar,
          },
          ranked: {
            battles: rankedInFloor,
            needed: policy.floor_ranked_battles,
            passes: passesRanked,
          },
          window_weeks: policy.floor_window_weeks,
          bounded_by_log: !logCoversFloor,
        },
        inactivity:
          daysIdle === null
            ? null
            : {
                days_idle: daysIdle,
                state:
                  daysIdle >= policy.at_risk_days + policy.confirm_days
                    ? "would_be_recommended"
                    : daysIdle >= policy.at_risk_days
                      ? "at_risk"
                      : daysIdle >= policy.watch_days
                        ? "watch"
                        : "active",
              },
        donations:
          p && clanMedianDonations !== null
            ? {
                this_week: p.snapshot?.donations_this_week ?? null,
                clan_median_weekly: clanMedianDonations,
              }
            : null,
        tenure_note: `Elder consideration needs ${policy.tenure_min_days} days in the clan; a new member starts at zero.`,
      },
    };
  };
}
