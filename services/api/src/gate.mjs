/**
 * The gate, in order. Each step has one refusal and the first refusal
 * wins, so a person is told one thing to do, not four:
 *
 *   1. the principal is a PERSON (`kind: "person"`); an agent's or an
 *      integration's grant is refused
 *   2. at least one of their own players (a primary or an alt) is on the
 *      account
 *   3. at least one of those players is currently in a clan
 *
 * What comes out is the identity set (every claim, so the chooser can say
 * what each is) and the clan set: the distinct clans of the person's own
 * claims, each with the tag the person acts as there. Two tags in one
 * clan are one clan, acting as the higher role.
 *
 * A claim need not be VERIFIED to make someone a member (Jamie,
 * 2026-09-26): an unverified player is taken at its word, and Elixir lets
 * several accounts claim one tag that way, so it acts here as a member
 * whatever its in-game role. What an Elder, Co-leader or Leader does here
 * waits for Elixir → Verify; `unlock` names the unverified player that
 * would bring more, so the app can say so. Nothing stored here decides a
 * role. Reads only: `initialize` (`GET /api/v1/me`, which carries the
 * players too), and `elixir_my_players` only from a door that does not.
 */

import { roleLabel, roleRank } from "./roles.mjs";

export const REFUSALS = {
  not_a_person: "not_a_person",
  no_primary_player: "no_primary_player",
  no_clan: "no_clan",
};

export function normalizeTag(value) {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/^#/, "")
    .replace(/O/g, "0");
  return /^[0289PYLQGRJCUV]{3,12}$/.test(raw) ? `#${raw}` : null;
}

const SELF = new Set(["primary", "alt"]);

/** A claim of the person's own: their primary or an alt, never a friend
 *  or a watched player. A row with no relationship is the person's. */
const isSelf = (id) => !id.relationship || SELF.has(id.relationship);

/** The role a claim acts as here: its in-game role once verified, a
 *  member's until then. */
export const actingRole = (id) =>
  id.claim_status === "verified" ? id.role : "member";

/** The clan set from the identity set. Exported for the tests. */
export function clansOf(identities, principal) {
  const byClan = new Map();
  for (const id of identities) {
    // Only "you" and your alts act here; friends and watching never do.
    if (!id.clan_tag || !id.role || !isSelf(id)) continue;
    byClan.set(id.clan_tag, [...(byClan.get(id.clan_tag) ?? []), id]);
  }
  const clans = [];
  for (const [clanTag, ids] of byClan) {
    // The tag to act as: the highest acting role, a verified tag before an
    // unverified one, then the higher in-game role.
    const acting = [...ids].sort(
      (a, b) =>
        roleRank(actingRole(a)) - roleRank(actingRole(b)) ||
        (b.claim_status === "verified") - (a.claim_status === "verified") ||
        roleRank(a.role) - roleRank(b.role),
    )[0];
    const role = actingRole(acting);
    // An unverified player whose in-game role would bring more than the
    // acting one: the thing to verify.
    const locked = ids
      .filter(
        (i) =>
          i.claim_status !== "verified" && roleRank(i.role) < roleRank(role),
      )
      .sort((a, b) => roleRank(a.role) - roleRank(b.role))[0];
    clans.push({
      clan_tag: clanTag,
      name:
        ids.find((i) => i.clan_name)?.clan_name ??
        (principal?.clan?.tag === clanTag
          ? (principal.clan.name ?? null)
          : null) ??
        null,
      acting_as: acting.player_tag,
      acting_as_name: acting.name,
      role,
      role_label: roleLabel(role),
      verified: acting.claim_status === "verified",
      unlock: locked
        ? {
            player_tag: locked.player_tag,
            name: locked.name ?? null,
            role: locked.role,
            role_label: roleLabel(locked.role),
          }
        : null,
      your_tags: ids.map((i) => i.player_tag),
    });
  }
  // Primary's clan first, then by role held, then by name.
  const primaryClan = identities.find((i) => i.is_primary)?.clan_tag;
  return clans.sort(
    (a, b) =>
      (b.clan_tag === primaryClan) - (a.clan_tag === primaryClan) ||
      roleRank(a.role) - roleRank(b.role) ||
      String(a.name ?? a.clan_tag).localeCompare(String(b.name ?? b.clan_tag)),
  );
}

/**
 * The clans where verifying would bring an Elder's, Co-leader's or
 * Leader's tools, for the notice after sign-in; `key` changes when that
 * list does, so a new one is shown again.
 */
export function verifyNotice(gate) {
  const clans = (gate?.clans ?? [])
    .filter((c) => c.unlock)
    .map((c) => ({
      clan_tag: c.clan_tag,
      clan_name: c.name,
      player_tag: c.unlock.player_tag,
      player_name: c.unlock.name,
      role: c.unlock.role,
      role_label: c.unlock.role_label,
    }));
  if (!clans.length) return null;
  const key = clans
    .map((c) => `${c.clan_tag}:${c.player_tag}:${c.role}`)
    .sort()
    .join(",");
  return { key, clans };
}

/**
 * @returns {Promise<
 *   | {ok:true, principal, identities, clans, primary}
 *   | {ok:false, reason, principal?, identities?}
 *   | {ok:false, error, status?}>}
 */
export async function runGate({ mcp, token }) {
  const init = await mcp.initialize(token);
  if (!init.ok) return { ok: false, error: init.error, status: init.status };

  const principal = init.principal;
  const kind = principal?.kind;
  if (kind !== "person") {
    return {
      ok: false,
      reason: REFUSALS.not_a_person,
      principal: principal
        ? { kind, subject: principal.subject ?? null }
        : null,
    };
  }

  // `/me` already carries the players: one request, not two. A door
  // that answers without them is asked for them.
  const mine = Array.isArray(init.body?.players)
    ? { ok: true, body: { players: init.body.players } }
    : await mcp.callTool(token, "elixir_my_players", {});
  if (!mine.ok) return { ok: false, error: mine.error, status: mine.status };

  const players = Array.isArray(mine.body?.players) ? mine.body.players : [];
  const identities = players.map((p) => ({
    player_tag: p.player_tag,
    name: p.name ?? null,
    relationship: p.relationship ?? null,
    is_primary: p.is_primary === true,
    claim_status: p.claim_status ?? null,
    clan_tag: p.clan_tag ?? null,
    clan_name: p.clan_name ?? null,
    role: p.clan_role ?? null,
    role_label: p.clan_role ? roleLabel(p.clan_role) : null,
  }));
  const base = {
    principal: { kind, subject: principal.subject ?? null },
    identities,
  };
  const own = identities.filter(isSelf);
  if (own.length === 0)
    return { ok: false, reason: REFUSALS.no_primary_player, ...base };
  const clans = clansOf(identities, principal);
  if (clans.length === 0)
    return { ok: false, reason: REFUSALS.no_clan, ...base };

  const primary =
    identities.find((i) => i.is_primary) ??
    own.find((i) => i.claim_status === "verified") ??
    own[0];
  return {
    ok: true,
    ...base,
    clans,
    primary: { player_tag: primary.player_tag, name: primary.name },
    as_of: mine.body?.meta?.as_of ?? null,
  };
}
