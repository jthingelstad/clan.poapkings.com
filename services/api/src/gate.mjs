/**
 * The gate, in order. Each step has one refusal and the first refusal
 * wins, so a person is told one thing to do, not four:
 *
 *   1. the principal is a PERSON (`kind: "person"`); an agent's or an
 *      integration's grant is refused
 *   2. at least one player is on the account
 *   3. at least one claim is VERIFIED (`claim_status: "verified"`; only a
 *      primary or an alt can be proven)
 *   4. at least one verified claim is currently in a clan
 *
 * What comes out is the identity set (every claim, so the chooser can say
 * why a clan is missing) and the clan set: the distinct clans of the
 * verified claims, each with the tag the person acts as there. Two
 * verified tags in one clan are one clan, acting as the higher role.
 * Nothing unverified ever selects a clan; nothing stored here decides a
 * role. Reads only: `initialize` and `elixir_my_players`.
 */

import { roleLabel, roleRank } from "./roles.mjs";

export const REFUSALS = {
  not_a_person: "not_a_person",
  no_primary_player: "no_primary_player",
  unverified: "unverified",
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

/** The clan set from the identity set. Exported for the tests. */
export function clansOf(identities, principal) {
  const byClan = new Map();
  for (const id of identities) {
    // Only "you" and your alts can be proven, and only they act here.
    if (id.claim_status !== "verified" || !id.clan_tag || !id.role) continue;
    if (id.relationship && !SELF.has(id.relationship)) continue;
    const current = byClan.get(id.clan_tag);
    if (!current || roleRank(id.role) < roleRank(current.role)) {
      byClan.set(id.clan_tag, {
        clan_tag: id.clan_tag,
        name:
          id.clan_name ??
          (principal?.clan?.tag === id.clan_tag
            ? (principal.clan.name ?? null)
            : null) ??
          current?.name ??
          null,
        acting_as: id.player_tag,
        acting_as_name: id.name,
        role: id.role,
        role_label: roleLabel(id.role),
        your_tags: [...(current?.your_tags ?? []), id.player_tag],
      });
    } else {
      current.your_tags.push(id.player_tag);
    }
  }
  // Primary's clan first, then by role held, then by name.
  const primaryClan = identities.find((i) => i.is_primary)?.clan_tag;
  return [...byClan.values()].sort(
    (a, b) =>
      (b.clan_tag === primaryClan) - (a.clan_tag === primaryClan) ||
      roleRank(a.role) - roleRank(b.role) ||
      String(a.name ?? a.clan_tag).localeCompare(String(b.name ?? b.clan_tag)),
  );
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

  const mine = await mcp.callTool(token, "elixir_my_players", {});
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
  if (identities.length === 0)
    return { ok: false, reason: REFUSALS.no_primary_player, ...base };
  const verified = identities.filter((i) => i.claim_status === "verified");
  if (verified.length === 0)
    return { ok: false, reason: REFUSALS.unverified, ...base };
  const clans = clansOf(identities, principal);
  if (clans.length === 0)
    return { ok: false, reason: REFUSALS.no_clan, ...base };

  const primary = identities.find((i) => i.is_primary) ?? verified[0];
  return {
    ok: true,
    ...base,
    clans,
    primary: { player_tag: primary.player_tag, name: primary.name },
    as_of: mine.body?.meta?.as_of ?? null,
  };
}
