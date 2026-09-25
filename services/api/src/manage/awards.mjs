/**
 * The awards service: the clan's awards document (versioned like policy),
 * the live races and closed seasons from the record, grants written on
 * the first evaluation after a season closes, grants by hand for a
 * leaders' pick, and the trophy case every member sees.
 *
 * Pure engine in (evaluateAwards), ledger and Elixir out. Evaluation is on
 * demand with the signed-in person's token and cached five minutes per
 * clan, like the management evaluation; any member opening the trophy
 * case runs it, so grants do not wait on a leader visiting Manage. Like
 * every management function, nothing here runs until the clan has a
 * policy, nor while it is below MIN_MEMBERS (10), and a clan starts with
 * no awards.
 */

import {
  AWARD_KINDS,
  defaultAwards,
  describeAward,
  evaluateAwards,
  validateAwards,
} from "@elixir-clan/engine";
import {
  ManageError,
  EVALUATION_TTL_MS,
  noteClanSize,
  tooFewMembers,
} from "./service.mjs";
import { MIN_MEMBERS, leaderMessage } from "@elixir-clan/engine";
import { createActionStore } from "./actions.mjs";
import { newId } from "./ledger.mjs";

const LEADERS = new Set(["leader", "coLeader"]);
const ELDER_PLUS = new Set(["leader", "coLeader", "elder"]);

export function createAwardsService({
  ledger,
  participationFor,
  now = () => Date.now(),
}) {
  const isLeader = (who) => LEADERS.has(who.role);
  const { raiseAction } = createActionStore({ ledger, now });

  /**
   * When the policy asks for it, a season whose computed grants were just
   * written raises "announce the season's awards" for leaders, with a Clan
   * Leader Message naming the winners. One per season.
   */
  async function announceSeason(clanTag, grantsDue) {
    const policy = await ledger.currentPolicy(clanTag);
    if (!policy?.values?.announce_awards_enabled) return;
    const bySeason = new Map();
    for (const g of grantsDue) {
      const list = bySeason.get(g.season_id) ?? [];
      list.push(g);
      bySeason.set(g.season_id, list);
    }
    const cards = await ledger.cards(clanTag);
    for (const [season_id, grants] of bySeason) {
      if (
        cards.some(
          (c) =>
            c.type === "awards_announcement" &&
            c.evidence?.season_id === season_id,
        )
      )
        continue;
      const byAward = new Map();
      for (const g of [...grants].sort(
        (a, b) => (a.rank ?? 1) - (b.rank ?? 1),
      )) {
        const list = byAward.get(g.name) ?? [];
        list.push(g.player_name ?? g.player_tag);
        byAward.set(g.name, list);
      }
      const awards = [...byAward].map(([name, winners]) => ({
        name,
        winners,
      }));
      const message = leaderMessage("awards", { season_id, awards });
      await raiseAction(
        clanTag,
        {
          card_id: newId(),
          clan_tag: clanTag,
          player_tag: null,
          player_name: null,
          role_at_raise: null,
          type: "awards_announcement",
          status: "proposed",
          raised_at: new Date(now()).toISOString(),
          policy_version: policy.version,
          evidence: { season_id, awards, message },
        },
        cards,
        {
          text: `Season ${season_id} closed: ${grants.length} award${grants.length === 1 ? "" : "s"} granted.`,
          detail: { clauses: ["announce_awards_enabled"] },
        },
      );
    }
  }

  /** Nothing in clan management runs before a policy is saved, nor while
   *  the clan is below MIN_MEMBERS. An evaluation passes `size: false`
   *  and decides from its own participation read. */
  async function requirePolicy(clanTag, { size = true } = {}) {
    if (!(await ledger.currentPolicy(clanTag)))
      throw new ManageError(409, "no_policy");
    if (size) {
      const known = await ledger.clanSize(clanTag);
      if (known && known.members < MIN_MEMBERS)
        throw tooFewMembers(known.members);
    }
  }

  async function configFor(clanTag) {
    const current = await ledger.currentAwards(clanTag);
    if (current)
      return {
        values: current.values,
        version: current.version,
        saved_at: current.saved_at,
        saved_by: current.saved_by,
        saved_by_name: current.saved_by_name ?? null,
      };
    return {
      values: defaultAwards(),
      version: 0,
      saved_at: null,
      saved_by: null,
      saved_by_name: null,
    };
  }

  /** Evaluate the record (or reuse a fresh snapshot) and write grants due. */
  async function evaluateClan({ clanTag, token, force = false }) {
    const t = now();
    const config = await configFor(clanTag);
    const cached = await ledger.latestAwardsSnapshot(clanTag);
    // A clan last seen below the minimum is re-read, never served a cache.
    const known = await ledger.clanSize(clanTag);
    const small = known !== null && known.members < MIN_MEMBERS;
    if (
      !force &&
      !small &&
      cached &&
      cached.config_version === config.version &&
      t - Date.parse(cached.evaluated_at) < EVALUATION_TTL_MS
    )
      return { result: cached, config, cached: true };
    const participation = await participationFor(token, clanTag);
    // Too small for awards: remember the size and grant nothing.
    await noteClanSize(ledger, clanTag, participation.members.length, t);
    if (participation.members.length < MIN_MEMBERS)
      throw tooFewMembers(participation.members.length);
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
    if (result.grants_due.length)
      await announceSeason(clanTag, result.grants_due);
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
    granted_by_name: g.granted_by_name ?? null,
  });

  return {
    configFor,
    evaluateClan,

    /** Manage ▸ Awards: races, seasons, grants, and the document. */
    async manageView(clanTag, who, token, { refresh = false } = {}) {
      if (!ELDER_PLUS.has(who.role)) throw new ManageError(403, "elders_only");
      await requirePolicy(clanTag, { size: false });
      const { result, config, cached } = await evaluateClan({
        clanTag,
        token,
        force: refresh,
      });
      // Who granted, by name: rows since 2026-09-20 carry it; older ones
      // are named from the evaluation's members and the grants themselves.
      const names = new Map();
      for (const m of result.members ?? [])
        if (m.name) names.set(m.player_tag, m.name);
      for (const g of await ledger.grants(clanTag))
        if (g.player_name && !names.has(g.player_tag))
          names.set(g.player_tag, g.player_name);
      const grants = (await ledger.grants(clanTag)).map((g) => {
        const row = shape(g);
        return {
          ...row,
          granted_by_name:
            row.granted_by_name ?? names.get(row.granted_by) ?? null,
        };
      });
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
                    granted_by_name: g.granted_by_name,
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
            saved_by_name: v.saved_by_name ?? names.get(v.saved_by) ?? null,
            note: v.note,
          }))
          .reverse(),
      };
    },

    async saveConfig(clanTag, who, input, note) {
      if (!isLeader(who)) throw new ManageError(403, "leaders_only");
      await requirePolicy(clanTag);
      const checked = validateAwards(input);
      if (!checked.ok)
        throw Object.assign(new ManageError(400, "invalid_awards"), {
          errors: checked.errors,
        });
      return ledger.saveAwards(clanTag, {
        values: checked.values,
        by: who.player_tag,
        by_name: who.name ?? null,
        note,
      });
    },

    /** A leaders' pick, by hand. */
    async grant(
      clanTag,
      who,
      { award_id, player_tag, player_name, season_id, note },
    ) {
      await requirePolicy(clanTag);
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
          granted_by_name: who.name ?? null,
        }),
      );
    },

    /** Only a manual grant can be taken back; a computed one is the record's. */
    async revoke(clanTag, who, { season_id, award_id, player_tag }) {
      if (!isLeader(who)) throw new ManageError(403, "leaders_only");
      await requirePolicy(clanTag);
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
      await requirePolicy(clanTag);
      return (await ledger.grants(clanTag))
        .filter((g) => g.player_tag === playerTag)
        .map(shape)
        .sort((a, b) => b.season_id - a.season_id || a.rank - b.rank);
    },

    /**
     * The clan's trophy case, for every member: the awards it runs (name,
     * description, rule), every grant season by season, newest first, and
     * the viewer's own. Opening it evaluates, so a closed season's grants
     * are written by whoever looks first.
     */
    async trophyCase(clanTag, who, token) {
      await requirePolicy(clanTag, { size: false });
      const { config } = await evaluateClan({ clanTag, token });
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
        clan_tag: clanTag,
        awards: config.values.awards
          .filter((a) => a.enabled)
          .map((a) => ({
            id: a.id,
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
        yours: grants
          .filter((g) => g.player_tag === who.player_tag)
          .sort((a, b) => b.season_id - a.season_id || a.rank - b.rank),
      };
    },
  };
}
