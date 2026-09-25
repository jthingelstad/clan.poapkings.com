/**
 * Scout an applicant: a tag pasted from the game, read live, and, once the
 * clan has a policy, checked against the minimums and the inactivity clock
 * it sets. Before a policy exists Scout still shows the applicant's
 * statistics; it just has nothing of the clan's to check them against.
 *
 * Two live reads: players_profile (trophies, Path of Legends, years played,
 * war-day wins, donations) and battles_query (the last log). Both are
 * asynchronous on Elixir: fresh if in hand, else queued and answered
 * `live_pending` with retry_after_s, which is passed through so the page
 * asks again. Facts from Elixir; the policy answer is this app's.
 */

import { ranksElder, setMinimums } from "@elixir-clan/engine";
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
  return async function scout({ token, tagInput, policy = null }) {
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
    // Windows over the last log: the minimums window and the removal clock.
    const windowWeeks = policy?.minimums_window_weeks ?? 2;
    const floorFrom = t - windowWeeks * 7 * DAY_MS;
    const inFloor = battles.filter(
      (b) => Date.parse(b.battle_time) >= floorFrom,
    );
    // Elixir's own grouping rides every row as mode_group since 3.15.0
    // (packages/contracts modes); the type fold stays for an older door.
    const isRanked = (b) =>
      b.mode_group ? b.mode_group === "ranked" : b.type === "pathOfLegend";
    const isWar = (b) =>
      b.mode_group
        ? b.mode_group === "war"
        : /^(riverRace|boatBattle)/.test(b.type ?? "");
    const rankedInFloor = inFloor.filter(isRanked).length;
    // Decks, not days (Jamie 2026-09-24): a 1v1 or boat battle is one
    // deck, a duel one per round played.
    const deckCount = (b) =>
      /Duel/.test(b.type ?? "")
        ? (b.rounds_played ?? b.rounds?.length ?? 2)
        : 1;
    const warDecks = inFloor
      .filter(isWar)
      .reduce((n, b) => n + deckCount(b), 0);
    const last =
      battles.map((b) => Date.parse(b.battle_time)).sort((a, b) => b - a)[0] ??
      null;
    const daysIdle = last ? Number(((t - last) / DAY_MS).toFixed(2)) : null;
    const wins = battles.filter((b) => b.me?.outcome === "win").length;
    const losses = battles.filter((b) => b.me?.outcome === "loss").length;
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
            // The lifetime block's one shape (Elixir 4.0.0): the snake_case
            // keys clans_roster and players_timeline speak.
            battle_count: p.snapshot?.lifetime?.battle_count ?? null,
            wins: p.snapshot?.lifetime?.wins ?? null,
            losses: p.snapshot?.lifetime?.losses ?? null,
            collection_level: p.snapshot?.lifetime?.collection_level ?? null,
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
        war_decks_in_window: warDecks,
        covers_window: logCoversFloor,
        as_of: log.ok ? (log.body?.meta?.as_of ?? null) : null,
      },
      policy_answer: policy
        ? policyAnswer({
            policy,
            profile: p,
            warDecks,
            rankedInFloor,
            daysIdle,
            boundedByLog: !logCoversFloor,
          })
        : null,
    };
  };
}

/** The applicant against this clan's policy: each minimum it sets, the
 *  inactivity clock when it tracks one, and the tenure Elder needs. */
function policyAnswer({
  policy,
  profile,
  warDecks,
  rankedInFloor,
  daysIdle,
  boundedByLog,
}) {
  const set = setMinimums(policy);
  const check = (value, needed) => ({
    value,
    needed,
    passes: value === null || value === undefined ? null : value >= needed,
  });
  const results = {};
  if (set.war !== undefined) results.war = check(warDecks, set.war);
  if (set.ranked !== undefined)
    results.ranked = check(rankedInFloor, set.ranked);
  if (set.donations !== undefined)
    results.donations = {
      ...check(profile?.snapshot?.donations_this_week ?? null, set.donations),
      note: "this week so far",
    };
  if (set.trophies !== undefined)
    results.trophies = check(profile?.snapshot?.trophies ?? null, set.trophies);
  const verdicts = Object.values(results).map((r) => r.passes);
  const passes =
    verdicts.length === 0
      ? null
      : policy.minimums_rule === "all"
        ? verdicts.every((v) => v === true)
        : verdicts.some((v) => v === true);
  return {
    minimums: verdicts.length
      ? {
          rule: policy.minimums_rule,
          window_weeks: policy.minimums_window_weeks,
          results,
          passes,
          bounded_by_log: boundedByLog,
        }
      : null,
    inactivity:
      policy.removal_enabled && daysIdle !== null
        ? {
            days_idle: daysIdle,
            state:
              daysIdle >= policy.at_risk_days + policy.confirm_days
                ? "would_be_recommended"
                : daysIdle >= policy.at_risk_days
                  ? "at_risk"
                  : daysIdle >= policy.watch_days
                    ? "watch"
                    : "active",
          }
        : null,
    tenure_note: ranksElder(policy)
      ? `Elder consideration needs ${policy.tenure_min_days} days in the clan; a new member starts at zero.`
      : null,
  };
}
