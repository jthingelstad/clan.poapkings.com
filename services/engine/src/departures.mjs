/**
 * Departures: which member_left events the record shows that this ledger
 * has not yet explained, for a clan whose policy asks about departures. A
 * leave and a kick look identical in the roster diff, and the ledger is
 * the only place the difference can be recorded, so a leader is asked:
 * Kicked, Left, or Ignore.
 *
 * A departure already explained by a removal card marked Done before it
 * (the card's outcome verification records member_kicked) raises nothing.
 * One card per (tag, observed leave); a rejoin and a second leave is a
 * second card. A leave the member has already undone (they rejoined, or
 * they are on the current roster) raises nothing.
 */

const DAY_MS = 86400_000;

/**
 * @param {Array<{type:string, at:string, detail:object}>} events the roster's recent_events
 * @param {Array} cards the ledger's cards
 * @param {Map<string, object>} [lastKnown] tag → the last verdict line seen for the member
 */
export function departuresFrom(
  events,
  cards,
  lastKnown = new Map(),
  currentTags = null,
) {
  // A member who came back is not a departure to classify (overnight walk
  // 2026-09-24: alex left and rejoined the same evening and the inbox
  // still asked Kicked / Left / Ignore; Kicked would write a false kick).
  const rejoined = (tag, atMs) =>
    (currentTags && currentTags.has(tag)) ||
    (events ?? []).some(
      (e) =>
        e.type === "member_joined" &&
        e.detail?.player_tag === tag &&
        Date.parse(e.at) > atMs,
    );
  const explained = (tag, atMs) =>
    cards.some(
      (c) =>
        c.player_tag === tag &&
        ((c.type === "departure" &&
          c.evidence?.left_at &&
          Math.abs(Date.parse(c.evidence.left_at) - atMs) < DAY_MS) ||
          (c.type === "removal" &&
            c.status === "done" &&
            c.decided_at &&
            Date.parse(c.decided_at) <= atMs + DAY_MS)),
    );
  return (events ?? [])
    .filter((e) => e.type === "member_left" && e.detail?.player_tag)
    .map((e) => ({
      player_tag: e.detail.player_tag,
      player_name: e.detail.name ?? null,
      left_at: e.at,
      // Elixir's roster event stamps the departing role as
      // role_at_departure; `role` is the feed's spelling.
      role_before: e.detail.role_at_departure ?? e.detail.role ?? null,
      last: lastKnown.get(e.detail.player_tag) ?? null,
    }))
    .filter((d) => !explained(d.player_tag, Date.parse(d.left_at)))
    .filter((d) => !rejoined(d.player_tag, Date.parse(d.left_at)));
}

export const DEPARTURE_CLASSIFICATIONS = ["kick", "leave", "ignore"];
