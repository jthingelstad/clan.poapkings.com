/**
 * "Actions waiting for you" (door 2, 2026-09-25; Jamie): after the morning
 * evaluation, one email to each person who can act on an open action,
 * sent through Elixir, which holds the address, the switch (on to start)
 * and the unsubscribe. Only people who can act on an action are sent it
 * (Jamie). A person is emailed only when something became theirs since
 * their last email, so an action left open is not mailed every morning;
 * the email lists everything waiting, newest first, the new ones marked.
 *
 * Plain words, as the Actions page says them: an action's label and the
 * member it is about. Nothing a person could not already see signed in.
 * Pure: actions, people and the last send in; one email per person out.
 */

import { ACTION_TYPES, canAct } from "./actions.mjs";

export const ACTIONS_MAIL_KIND = "clan_actions_waiting";
/** Lines in one email before the rest are counted. */
export const MAIL_MAX_LINES = 10;

const labelOf = (c) => ACTION_TYPES[c.type]?.label ?? c.type;
const lineOf = (c) =>
  c.player_name && ACTION_TYPES[c.type]?.audience !== "member"
    ? `${labelOf(c)}: ${c.player_name}`
    : labelOf(c);

/**
 * @param {object} p
 * @param {string} p.clanTag
 * @param {string|null} p.clanName
 * @param {Array} p.cards the clan's actions (any status; open ones count)
 * @param {Array<{player_tag:string,name?:string,role:string}>} p.people
 *   everyone in the clan today, with their in-game role
 * @param {Record<string,string>} [p.lastMailed] tag -> instant of their
 *   last actions email for this clan
 * @param {string} p.appUrl Elixir Clan's origin
 * @returns {Array<{player_tag, subject, lines, link, card_ids, new_card_ids}>}
 */
export function actionsWaitingMail({
  clanTag,
  clanName,
  cards,
  people,
  lastMailed = {},
  appUrl,
}) {
  const clan = clanName ?? clanTag;
  const open = cards
    .filter((c) => c.status === "proposed")
    .sort((a, b) => (a.raised_at < b.raised_at ? 1 : -1));
  const link = `${appUrl.replace(/\/$/, "")}/clan/${clanTag.slice(1)}/actions`;
  const out = [];
  for (const who of people) {
    const mine = open.filter((c) => canAct(c, who));
    if (!mine.length) continue;
    const since = lastMailed[who.player_tag] ?? null;
    const fresh = new Set(
      mine.filter((c) => !since || c.raised_at > since).map((c) => c.card_id),
    );
    if (!fresh.size) continue;
    const lines = mine
      .slice(0, MAIL_MAX_LINES)
      .map((c) => `${lineOf(c)}${fresh.has(c.card_id) ? " (new)" : ""}`);
    if (mine.length > MAIL_MAX_LINES)
      lines.push(`And ${mine.length - MAIL_MAX_LINES} more.`);
    const subject =
      mine.length === 1
        ? `${lineOf(mine[0])} (${clan})`
        : `${mine.length} actions waiting for you in ${clan}`;
    out.push({
      player_tag: who.player_tag,
      subject: subject.slice(0, 120),
      lines,
      link,
      card_ids: mine.map((c) => c.card_id),
      new_card_ids: [...fresh],
    });
  }
  return out;
}
