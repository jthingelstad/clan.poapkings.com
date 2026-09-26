/**
 * Social (Jamie, 2026-09-26): the clan's own section, starting with the
 * clan map. A member says where they play from (a country, its region and,
 * if they like, a city, picked from the lists: never an address, never the
 * device's location) and sees where the rest of the clan is, with each
 * one's local time.
 *
 * The rules, as decided:
 * - Only verified members of that clan, signed in, see its map; leaders
 *   see exactly what members see, names beside pins.
 * - Off until a member adds themselves; they can remove it any time;
 *   nobody places or edits anyone else, leaders included.
 * - One place per person: written under each of their verified tags, so it
 *   shows in every clan they are in. Someone no longer on a clan's roster
 *   is gone from its map at once (the map is drawn from today's roster).
 * - Social features are the clan's alone: nothing here goes to Elixir as a
 *   fact, and the clan's agent never sees it.
 * - Every clan has it, with or without a policy and at any size; a leader
 *   or co-leader can turn the clan's social features off.
 */

import { ManageError } from "./service.mjs";

const LEADERS = new Set(["leader", "coLeader"]);

export function createSocialService({ ledger, geo, now = () => Date.now() }) {
  async function setting(clanTag) {
    const s = await ledger.socialSetting(clanTag);
    return {
      enabled: s?.enabled !== false,
      set_by_name: s?.set_by_name ?? null,
      set_at: s?.set_at ?? null,
    };
  }

  /** The newest place among a person's tags (they are written together;
   *  a tag verified later has none until the next save). */
  async function placeOf(tags) {
    const rows = await ledger.places(tags);
    if (!rows.length) return null;
    const row = rows.sort((a, b) =>
      String(b.set_at).localeCompare(String(a.set_at)),
    )[0];
    const resolved = await geo.resolve(row);
    return resolved.error ? null : { ...resolved, set_at: row.set_at };
  }

  return {
    setting,
    enabled: async (clanTag) => (await setting(clanTag)).enabled,

    /** A leader or co-leader turns the clan's social features on or off. */
    async setEnabled(clanTag, who, enabled) {
      if (!LEADERS.has(who.role)) throw new ManageError(403, "leaders_only");
      if (typeof enabled !== "boolean")
        throw new ManageError(400, "bad_request", "enabled is true or false");
      await ledger.saveSocialSetting(clanTag, {
        enabled,
        set_by: who.player_tag,
        set_by_name: who.name ?? null,
        set_at: new Date(now()).toISOString(),
      });
      return setting(clanTag);
    },

    /** The person's own place (any of their verified tags), or null. */
    myPlace: (person) => placeOf(person.tags),

    async setMyPlace(person, input) {
      const place = await geo.resolve(input);
      if (place.error)
        throw new ManageError(400, "bad_place", place.error, {
          field: place.field,
          message: place.error,
        });
      await ledger.savePlace(person.tags, {
        country: place.country,
        region: place.region,
        city: place.city,
        set_at: new Date(now()).toISOString(),
      });
      return place;
    },

    async clearMyPlace(person) {
      await ledger.removePlaces(person.tags);
      return { cleared: true };
    },

    /**
     * The clan's map: today's roster members who have added a place, each
     * with their pin and time zone, and yours. `members` is the roster as
     * the clan page reads it.
     */
    async map(clanTag, members, you) {
      if (!(await setting(clanTag)).enabled)
        throw new ManageError(409, "social_off");
      const rows = await ledger.places(members.map((m) => m.player_tag));
      const byTag = new Map(rows.map((r) => [r.player_tag, r]));
      const entries = [];
      for (const m of members) {
        const row = byTag.get(m.player_tag);
        if (!row) continue;
        const place = await geo.resolve(row);
        if (place.error) continue;
        entries.push({
          player_tag: m.player_tag,
          name: m.name ?? null,
          role: m.role ?? null,
          role_label: m.role_label ?? null,
          you: you.tags.includes(m.player_tag),
          place,
        });
      }
      return {
        clan_tag: clanTag,
        members: members.length,
        on_map: entries.length,
        entries,
        yours: await placeOf(you.tags),
        attribution:
          "Places from GeoNames (geonames.org, CC BY 4.0). Map © OpenStreetMap contributors.",
      };
    },
  };
}
