/**
 * What the rail offers depends on who is looking and on the clan's policy:
 * until a leader saves one, and while the clan has fewer than 10 members,
 * only the roster, Recruit, Scout and the policy editor exist (nothing in
 * clan management runs). Manage for leaders and
 * co-leaders, Awards and Scout also for elders, Away when the policy lets
 * members mark it, Maintain for the product's maintainer. Two items the
 * reader can see at once never share a label.
 * The rail itself is Elixir's (the kit's Rail); this is only what goes
 * on it and which item a path is on.
 */
const LEADERS = new Set(["leader", "coLeader"]);
const ELDER_PLUS = new Set(["leader", "coLeader", "elder"]);

export function railItems(me) {
  const clan = me?.selected ?? null;
  const base = clan ? `/clan/${clan.clan_tag.slice(1)}` : null;
  const items = [];
  if (me?.ok && me.clans?.length > 1)
    items.push({ key: "clans", label: "Clans", icon: "layers", to: "/clans" });
  const policy = me?.policy ?? null;
  // Active: a saved policy on a clan of at least 10 (an older /api/me
  // without the flag reads as its `set`).
  const set = policy?.active ?? policy?.set === true;
  if (clan) {
    items.push({ key: "clan", label: "Clan", icon: "users", to: base });
    if (set)
      items.push({
        key: "standing",
        label: "Standing",
        icon: "chart-column",
        to: `${base}/standing`,
      });
    if (set)
      items.push({
        key: "trophies",
        label: "Trophies",
        icon: "award",
        to: `${base}/trophies`,
      });
    items.push({
      key: "recruit",
      label: "Recruit",
      icon: "megaphone",
      to: `${base}/recruit`,
    });
    const leader = LEADERS.has(clan.role);
    const elder = ELDER_PLUS.has(clan.role);
    if (leader) {
      if (set) {
        items.push({
          group: "Manage",
          key: "inbox",
          label: "Inbox",
          icon: "inbox",
          to: `${base}/manage/inbox`,
          meta: me.open_cards ? String(me.open_cards) : undefined,
        });
        items.push({
          key: "board",
          label: "Board",
          icon: "layout-dashboard",
          to: `${base}/manage/board`,
        });
        items.push({
          key: "history",
          label: "History",
          icon: "history",
          to: `${base}/manage/history`,
        });
      }
      items.push({
        ...(set ? {} : { group: "Manage" }),
        key: "policy",
        label: "Policy",
        icon: "file-text",
        to: `${base}/manage/policy`,
      });
    }
    if (elder) {
      if (set)
        items.push({
          ...(leader ? {} : { group: "Manage" }),
          key: "awards",
          label: "Awards",
          icon: "award",
          to: `${base}/manage/awards`,
        });
      items.push({
        ...(leader || set ? {} : { group: "Manage" }),
        key: "scout",
        label: "Scout",
        icon: "search",
        to: `${base}/manage/scout`,
      });
    }
  }
  items.push({
    group: "You",
    key: "you",
    label: "Players",
    icon: "user-round",
    to: "/you",
  });
  if (clan && policy?.away)
    items.push({ key: "away", label: "Away", icon: "plane", to: "/you/away" });
  items.push({
    key: "feedback",
    label: "Feedback",
    icon: "message-square",
    to: "/feedback",
    dot: me?.feedback_unseen
      ? {
          tone: "unread",
          title: `${me.feedback_unseen} new repl${me.feedback_unseen === 1 ? "y" : "ies"}`,
        }
      : null,
  });
  if (me?.maintainer)
    items.push({
      group: "Maintain",
      key: "maintain",
      label: "Feedback queue",
      icon: "inbox",
      to: "/maintain/feedback",
    });
  return items;
}

/** Which rail item a path is on. */
export function railKey(path) {
  if (path === "/clans") return "clans";
  if (path === "/you") return "you";
  if (path.startsWith("/you/away")) return "away";
  if (path.startsWith("/feedback")) return "feedback";
  if (path.startsWith("/maintain")) return "maintain";
  const m =
    /^\/clan\/[0-9A-Za-z]+(?:\/(standing|trophies|recruit|manage)(?:\/([a-z-]+))?)?\/?$/.exec(
      path,
    );
  if (!m) return null;
  if (!m[1]) return "clan";
  if (m[1] === "standing" || m[1] === "trophies" || m[1] === "recruit")
    return m[1];
  return m[2] ?? "inbox";
}
