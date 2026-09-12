/**
 * The awards service: the clan's awards document (versioned like policy),
 * the live races and closed seasons from the record, grants written on
 * the first evaluation after a season closes, grants by hand for a
 * leaders' pick, and the public document other sites read.
 *
 * Pure engine in (evaluateAwards), ledger and Elixir out. Evaluation is on
 * demand with the signed-in person's token and cached five minutes per
 * clan, like the management evaluation.
 */

import {
  AWARD_KINDS,
  defaultAwards,
  describeAward,
  evaluateAwards,
  validateAwards,
} from "@elixir-clan/engine";
import { ManageError, EVALUATION_TTL_MS } from "./service.mjs";

const LEADERS = new Set(["leader", "coLeader"]);
const ELDER_PLUS = new Set(["leader", "coLeader", "elder"]);

export function createAwardsService({
  ledger,
  participationFor,
  now = () => Date.now(),
}) {
  const isLeader = (who) => LEADERS.has(who.role);

  async function configFor(clanTag) {
    const current = await ledger.currentAwards(clanTag);
    if (current)
      return {
        values: current.values,
        version: current.version,
        saved_at: current.saved_at,
        saved_by: current.saved_by,
      };
    return {
      values: defaultAwards(),
      version: 0,
      saved_at: null,
      saved_by: null,
    };
  }

  /** Evaluate the record (or reuse a fresh snapshot) and write grants due. */
  async function evaluateClan({ clanTag, token, force = false }) {
    const t = now();
    const config = await configFor(clanTag);
    const cached = await ledger.latestAwardsSnapshot(clanTag);
    if (
      !force &&
      cached &&
      cached.config_version === config.version &&
      t - Date.parse(cached.evaluated_at) < EVALUATION_TTL_MS
    )
      return { result: cached, config, cached: true };
    const participation = await participationFor(token, clanTag);
    const grants = await ledger.grants(clanTag);
    const result = evaluateAwards({
      participation,
      config: config.values,
      now: new Date(t),
      grants,
      config_version: config.version,
    });
    const granted_at = new Date(t).toISOString();
    for (const g of result.grants_due)
      await ledger.putGrant(clanTag, { ...g, granted_at });
    // The snapshot the pages read; grants_due is consumed, not kept.
    const snapshot = { ...result, grants_due: [] };
    await ledger.saveAwardsSnapshot(clanTag, snapshot);
    return {
      result: snapshot,
      config,
      cached: false,
      granted: result.grants_due.length,
    };
  }

  const shape = (g) => ({
    season_id: g.season_id,
    award_id: g.award_id,
    kind: g.kind,
    name: g.name,
    rank: g.rank ?? 1,
    player_tag: g.player_tag,
    player_name: g.player_name ?? null,
    metric_value: g.metric_value ?? null,
    metric_unit: g.metric_unit ?? null,
    note: g.note ?? null,
    manual: g.manual === true,
    granted_at: g.granted_at,
    granted_by: g.granted_by ?? null,
  });

  return {
    configFor,
    evaluateClan,

    /** Manage ▸ Awards: races, seasons, grants, and the document. */
    async manageView(clanTag, who, token, { refresh = false } = {}) {
      if (!ELDER_PLUS.has(who.role)) throw new ManageError(403, "elders_only");
      const { result, config, cached } = await evaluateClan({
        clanTag,
        token,
        force: refresh,
      });
      const grants = (await ledger.grants(clanTag)).map(shape);
      const versions = await ledger.awardsVersions(clanTag);
      // Manual rows come from the ledger as it is now, not from the
      // snapshot: a pick granted a moment ago shows without a re-read.
      const seasons = result.seasons.map((s) => ({
        ...s,
        awards: s.awards.map((a) =>
          a.state !== "manual"
            ? a
            : {
                ...a,
                rows: grants
                  .filter(
                    (g) =>
                      g.season_id === s.season_id && g.award_id === a.award_id,
                  )
                  .map((g) => ({
                    player_tag: g.player_tag,
                    name: g.player_name,
                    note: g.note,
                    granted_at: g.granted_at,
                    granted_by: g.granted_by,
                  })),
              },
        ),
      }));
      return {
        clan_tag: clanTag,
        can_edit: isLeader(who),
        can_grant: config.values.awards
          .filter(
            (a) =>
              a.enabled &&
              a.kind === "leaders_pick" &&
              (isLeader(who) || a.params.granted_by === "elders"),
          )
          .map((a) => a.id),
        evaluated_at: result.evaluated_at,
        cached,
        as_of: result.as_of,
        freshness_seconds: result.freshness_seconds,
        members: result.members ?? [],
        seasons,
        grants,
        config: config.values,
        config_version: config.version,
        kinds: AWARD_KINDS,
        versions: versions
          .map((v) => ({
            version: v.version,
            saved_at: v.saved_at,
            saved_by: v.saved_by,
            note: v.note,
          }))
          .reverse(),
      };
    },

    async saveConfig(clanTag, who, input, note) {
      if (!isLeader(who)) throw new ManageError(403, "leaders_only");
      const checked = validateAwards(input);
      if (!checked.ok)
        throw Object.assign(new ManageError(400, "invalid_awards"), {
          errors: checked.errors,
        });
      return ledger.saveAwards(clanTag, {
        values: checked.values,
        by: who.player_tag,
        note,
      });
    },

    /** A leaders' pick, by hand. */
    async grant(
      clanTag,
      who,
      { award_id, player_tag, player_name, season_id, note },
    ) {
      const config = await configFor(clanTag);
      const award = config.values.awards.find((a) => a.id === award_id);
      if (!award || !award.enabled) throw new ManageError(404, "no_award");
      if (award.kind !== "leaders_pick")
        throw new ManageError(400, "not_manual");
      const allowed =
        isLeader(who) ||
        (award.params.granted_by === "elders" && ELDER_PLUS.has(who.role));
      if (!allowed) throw new ManageError(403, "leaders_only");
      const season = Number(season_id);
      if (!Number.isInteger(season) || season < 1 || season > 9999)
        throw new ManageError(400, "bad_season");
      const text = String(note ?? "").trim();
      if (text.length > 500) throw new ManageError(400, "bad_note");
      return shape(
        await ledger.putGrant(clanTag, {
          season_id: season,
          award_id: award.id,
          kind: award.kind,
          name: award.name,
          rank: 1,
          player_tag,
          player_name: player_name ?? null,
          note: text || null,
          manual: true,
          config_version: config.version,
          granted_at: new Date(now()).toISOString(),
          granted_by: who.player_tag,
        }),
      );
    },

    /** Only a manual grant can be taken back; a computed one is the record's. */
    async revoke(clanTag, who, { season_id, award_id, player_tag }) {
      if (!isLeader(who)) throw new ManageError(403, "leaders_only");
      const all = await ledger.grants(clanTag);
      const g = all.find(
        (x) =>
          x.season_id === Number(season_id) &&
          x.award_id === award_id &&
          x.player_tag === player_tag,
      );
      if (!g) throw new ManageError(404, "no_grant");
      if (g.manual !== true) throw new ManageError(400, "not_manual");
      await ledger.removeGrant(clanTag, g);
    },

    /** One member's trophy case, for the member sheet and the roster. */
    async forMember(clanTag, playerTag) {
      return (await ledger.grants(clanTag))
        .filter((g) => g.player_tag === playerTag)
        .map(shape)
        .sort((a, b) => b.season_id - a.season_id || a.rank - b.rank);
    },

    /**
     * The public document, no session: the clan's awards and every grant,
     * season by season, newest first. Only when the clan publishes.
     */
    async publicDocument(clanTag) {
      const config = await configFor(clanTag);
      if (!config.values.publish) return null;
      const grants = (await ledger.grants(clanTag)).map(shape);
      const seasons = new Map();
      for (const g of grants) {
        const s = seasons.get(g.season_id) ?? {
          season_id: g.season_id,
          grants: [],
        };
        s.grants.push(g);
        seasons.set(g.season_id, s);
      }
      return {
        contract: "1.0.0",
        clan_tag: clanTag,
        generated_at: new Date(now()).toISOString(),
        config_version: config.version,
        awards: config.values.awards
          .filter((a) => a.enabled)
          .map((a) => ({
            id: a.id,
            kind: a.kind,
            name: a.name,
            description: a.description,
            rule: describeAward(a),
            manual: a.kind === "leaders_pick",
          })),
        seasons: [...seasons.values()]
          .sort((a, b) => b.season_id - a.season_id)
          .map((s) => ({
            season_id: s.season_id,
            grants: s.grants.sort(
              (a, b) => a.award_id.localeCompare(b.award_id) || a.rank - b.rank,
            ),
          })),
        notes: [
          "Grants are written when a war season closes, from Elixir's record of the clan; manual grants are a leader's and say so (manual: true).",
          "Names are as Elixir recorded them at grant time; tags are the durable key.",
          "Seasons are Clash Royale war seasons; a season the record did not cover in full has no computed grants.",
        ],
      };
    },
  };
}
