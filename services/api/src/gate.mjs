/**
 * The gate, in order. Each step has one refusal and the first refusal
 * wins, so a person is told one thing to do, not four:
 *
 *   1. the principal is a PERSON (`kind: "person"`); an agent's or an
 *      integration's grant is refused
 *   2. a primary player exists on the account
 *   3. that claim is verified (`claim_status: "verified"`)
 *   4. the player is currently in a clan
 *
 * Reads only: `initialize` and `elixir_my_players`. The roster is not part
 * of the gate; it is the page.
 */

import { roleLabel } from "./roles.mjs";

export const REFUSALS = {
  not_a_person: "not_a_person",
  no_primary_player: "no_primary_player",
  unverified: "unverified",
  no_clan: "no_clan",
};

/**
 * @returns {Promise<{ok:true, principal, player, clan} | {ok:false, reason, principal?, player?} | {ok:false, error, status?}>}
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
  const primary = players.find((p) => p.is_primary === true);
  const base = {
    principal: { kind, subject: principal.subject ?? null },
  };
  if (!primary)
    return { ok: false, reason: REFUSALS.no_primary_player, ...base };

  const player = {
    player_tag: primary.player_tag,
    name: primary.name ?? null,
    claim_status: primary.claim_status ?? null,
    clan_tag: primary.clan_tag ?? null,
    role: primary.clan_role ?? null,
    role_label: primary.clan_role ? roleLabel(primary.clan_role) : null,
  };
  if (primary.claim_status !== "verified")
    return { ok: false, reason: REFUSALS.unverified, ...base, player };

  if (!primary.clan_tag || !primary.clan_role)
    return { ok: false, reason: REFUSALS.no_clan, ...base, player };

  return {
    ok: true,
    ...base,
    player,
    clan: {
      clan_tag: primary.clan_tag,
      // The clan's name rides the principal block when it is the person's
      // recorded clan; the roster read fills it in otherwise.
      name:
        principal.clan?.tag === primary.clan_tag
          ? (principal.clan.name ?? null)
          : null,
    },
    as_of: mine.body?.meta?.as_of ?? null,
  };
}
