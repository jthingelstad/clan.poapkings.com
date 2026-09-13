import { useState } from "react";
import { Icon } from "./Icon.jsx";
import { RoleChip } from "./RoleChip.jsx";

/**
 * The left rail, Elixir's console structure carried over (Jamie,
 * 2026-09-12: "that is where we are going"): groups of items, a count or
 * a dot where there is one, the identity block at the foot with the way
 * out. At narrow widths it is a disclosure above the page that names
 * where you are, never a drawer over it. The rail's CSS is Elixir's own
 * (packages/design/styles.css); nothing here restyles it.
 *
 * What the rail offers depends on who is looking: Manage for leaders and
 * co-leaders, Awards and Scout also for elders, Maintain for the product's
 * maintainer. Two items the reader can see at once never share a label.
 */
const LEADERS = new Set(["leader", "coLeader"]);
const ELDER_PLUS = new Set(["leader", "coLeader", "elder"]);

export function railItems(me) {
  const clan = me?.selected ?? null;
  const base = clan ? `/clan/${clan.clan_tag.slice(1)}` : null;
  const items = [];
  if (me?.ok && me.clans?.length > 1)
    items.push({ key: "clans", label: "Clans", icon: "layers", to: "/clans" });
  if (clan) {
    items.push({ key: "clan", label: "Clan", icon: "users", to: base });
    items.push({
      key: "standing",
      label: "Standing",
      icon: "chart-column",
      to: `${base}/standing`,
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
      items.push({
        key: "policy",
        label: "Policy",
        icon: "file-text",
        to: `${base}/manage/policy`,
      });
    }
    if (elder) {
      items.push({
        ...(leader ? {} : { group: "Manage" }),
        key: "awards",
        label: "Awards",
        icon: "award",
        to: `${base}/manage/awards`,
      });
      items.push({
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
  if (clan)
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
    /^\/clan\/[0-9A-Za-z]+(?:\/(standing|recruit|manage)(?:\/([a-z-]+))?)?\/?$/.exec(
      path,
    );
  if (!m) return null;
  if (!m[1]) return "clan";
  if (m[1] === "standing" || m[1] === "recruit") return m[1];
  return m[2] ?? "inbox";
}

export function Rail({ me, path, navigate, narrow }) {
  const [open, setOpen] = useState(false);
  const items = railItems(me);
  const here = railKey(path);
  const current = items.find((r) => r.key === here);
  const go = (to) => (e) => {
    e.preventDefault();
    setOpen(false);
    navigate(to);
  };
  const clan = me?.selected ?? null;

  const list = (
    <nav
      aria-label="Sections"
      style={{ display: "flex", flexDirection: "column", gap: "2px" }}
    >
      {items.map((row) => {
        const on = row.key === here;
        return (
          <div key={row.key}>
            {row.group ? <div className="rail__group">{row.group}</div> : null}
            <a
              className={`rail__item${on ? " rail__item--on" : ""}`}
              href={row.to}
              aria-current={on ? "page" : undefined}
              onClick={go(row.to)}
            >
              <Icon name={row.icon} />
              {row.label}
              {row.meta !== undefined || row.dot ? (
                <span className="rail__meta">
                  {row.dot ? (
                    <span
                      className={`rail__dot rail__dot--${row.dot.tone}`}
                      title={row.dot.title}
                      role="img"
                      aria-label={row.dot.title}
                    />
                  ) : null}
                  {row.meta}
                </span>
              ) : null}
            </a>
          </div>
        );
      })}
    </nav>
  );

  return (
    <aside className="rail">
      {narrow ? (
        <button
          type="button"
          className="rail__toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span style={{ fontSize: "13.5px", fontWeight: 600 }}>
            {current?.label ?? "Elixir Clan"}
          </span>
          <span
            style={{
              fontSize: "13px",
              color: "var(--ink-faint)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {clan?.name ?? ""}
          </span>
          <span style={{ marginLeft: "auto", display: "flex" }}>
            <Icon name={open ? "chevron-up" : "chevron-down"} size={17} />
          </span>
        </button>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "9px",
            height: "40px",
            padding: "0 11px",
            marginBottom: "6px",
            borderBottom: "1px solid var(--line-soft)",
          }}
        >
          <span
            style={{
              fontSize: "13.5px",
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={clan?.name ?? undefined}
          >
            {clan?.name ?? "Elixir Clan"}
          </span>
          {clan ? (
            <span
              className="mono"
              style={{ marginLeft: "auto", color: "var(--ink-faint)" }}
            >
              {clan.clan_tag}
            </span>
          ) : null}
        </div>
      )}

      {!narrow || open ? list : null}

      {!narrow || open ? (
        <div style={{ marginTop: "auto", paddingTop: "16px" }}>
          <a
            className="rail__identity"
            href="/you"
            onClick={go("/you")}
            style={{ color: "inherit" }}
          >
            <span
              style={{
                width: "34px",
                height: "34px",
                borderRadius: "10px",
                background: "var(--line-soft)",
                border: "1px solid var(--line-strong)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--ink-body)",
                flex: "0 0 auto",
              }}
            >
              <Icon name="user-round" size={17} />
            </span>
            <span style={{ minWidth: 0, flex: "1 1 auto" }}>
              <span
                style={{
                  display: "block",
                  fontSize: "13px",
                  color: "var(--ink)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                <span className="yours">★</span>{" "}
                {clan?.player_name ?? me?.primary?.name ?? "Signed in"}
              </span>
              <span
                style={{
                  display: "block",
                  fontSize: "12px",
                  color: "var(--ink-faint)",
                }}
              >
                {clan ? (
                  <RoleChip role={clan.role} label={clan.role_label} />
                ) : (
                  "with Elixir"
                )}
              </span>
            </span>
            {/* Signing out is a form post, as it always was here: an action
                with no destination of its own. */}
            <form
              method="post"
              action="/auth/logout"
              style={{ flex: "0 0 auto" }}
            >
              <button
                type="submit"
                aria-label="Sign out"
                title="Sign out"
                className="btn btn--sm"
                onClick={(e) => e.stopPropagation()}
              >
                <Icon name="log-out" size={16} />
              </button>
            </form>
          </a>
        </div>
      ) : null}
    </aside>
  );
}
