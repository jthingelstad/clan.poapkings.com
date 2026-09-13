/**
 * The recruiting service: the clan's pitch (a leader's words, versioned
 * like policy), the facts the copy uses (one live read of the clan through
 * Elixir's live_fetch, cached for hours because every member's page open
 * must not spend a live read; the recorded roster fills in while a fresh
 * read is pending), and the five channels' copy from the engine.
 */

import {
  PITCH_FIELDS,
  defaultPitch,
  factsFromClan,
  factsFromRoster,
  recruitCopy,
  validateCopy,
  validatePitch,
} from "@elixir-clan/engine";
import { ManageError, fetchRoster } from "./service.mjs";

export const FACTS_TTL_MS = 6 * 3600_000;
/** A leader's refresh is floored: live reads are quota. */
export const REFRESH_FLOOR_MS = 10 * 60_000;
const LEADERS = new Set(["leader", "coLeader"]);

export function createRecruitService({ ledger, mcp, now = () => Date.now() }) {
  const isLeader = (who) => LEADERS.has(who.role);

  async function pitchFor(clanTag) {
    const current = await ledger.currentPitch(clanTag);
    if (current)
      return {
        values: current.values,
        version: current.version,
        saved_at: current.saved_at,
        saved_by: current.saved_by,
      };
    return {
      values: defaultPitch(),
      version: 0,
      saved_at: null,
      saved_by: null,
    };
  }

  /**
   * Facts, fresh enough: the cached live read inside its TTL; else one
   * live_fetch of /clans/{tag} (fresh if Elixir has it in hand, otherwise
   * queued and answered live_pending, passed through so the page asks
   * again) with the recorded roster standing in meanwhile.
   */
  async function factsFor(clanTag, token, { refresh = false } = {}) {
    const t = now();
    const cached = await ledger.recruitFacts(clanTag);
    const age = cached ? t - Date.parse(cached.read_at) : Infinity;
    if (cached && age < FACTS_TTL_MS && !(refresh && age >= REFRESH_FLOOR_MS))
      return {
        facts: cached.facts,
        read_at: cached.read_at,
        pending: null,
        cached: true,
      };
    const live = await mcp.callTool(token, "live_fetch", {
      path: `/clans/${encodeURIComponent(clanTag)}`,
    });
    if (live.ok && live.body?.data) {
      const facts = factsFromClan(live.body.data);
      const read_at = new Date(t).toISOString();
      await ledger.saveRecruitFacts(clanTag, { facts, read_at });
      return { facts, read_at, pending: null, cached: false };
    }
    if (!live.ok && live.status === 401)
      throw new ManageError(401, "session_expired");
    const pending =
      !live.ok && live.code === "live_pending"
        ? {
            retry_after_s: live.body?.error?.retry_after_s ?? 30,
            hint: live.hint ?? null,
          }
        : null;
    // Stale is better than nothing; the recorded roster better than stale.
    if (cached)
      return {
        facts: cached.facts,
        read_at: cached.read_at,
        pending,
        cached: true,
      };
    const roster = await fetchRoster(mcp, token, clanTag);
    return {
      facts: factsFromRoster(roster),
      read_at: roster?.meta?.as_of ?? null,
      pending:
        pending ??
        (live.ok ? null : { retry_after_s: 60, hint: live.error ?? null }),
      cached: false,
    };
  }

  return {
    pitchFor,

    /** The page: pitch, facts, the five channels, and the editor's fields. */
    async view(clanTag, who, token, { refresh = false } = {}) {
      const pitch = await pitchFor(clanTag);
      const { facts, read_at, pending, cached } = await factsFor(
        clanTag,
        token,
        {
          refresh: refresh && isLeader(who),
        },
      );
      const copy = recruitCopy(pitch.values, facts);
      const versions = await ledger.pitchVersions(clanTag);
      return {
        clan_tag: clanTag,
        can_edit: isLeader(who),
        pitch: pitch.values,
        pitch_version: pitch.version,
        fields: PITCH_FIELDS,
        facts,
        facts_read_at: read_at,
        facts_cached: cached,
        pending,
        copy,
        problems: validateCopy(copy, facts?.required_trophies ?? null),
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

    async savePitch(clanTag, who, input, note) {
      if (!isLeader(who)) throw new ManageError(403, "leaders_only");
      const checked = validatePitch(input);
      if (!checked.ok)
        throw Object.assign(new ManageError(400, "invalid_pitch"), {
          errors: checked.errors,
        });
      return ledger.savePitch(clanTag, {
        values: checked.values,
        by: who.player_tag,
        note,
      });
    },
  };
}
