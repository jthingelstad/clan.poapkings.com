import { Fresh, ago } from "elixir-mcp/packages/ui/src/index.ts";
import { useState } from "react";
import { useRoster } from "../lib/queries.js";
import { RoleChip } from "../components/RoleChip.jsx";
import { ELIXIR_LINKS } from "../lib/links.js";

const ROLE_ORDER = ["leader", "coLeader", "elder", "member"];
const GROUP = {
  leader: "Leader",
  coLeader: "Co-leaders",
  elder: "Elders",
  member: "Members",
};

const num = (v) => (v == null ? "—" : Number(v).toLocaleString());

/** The roster, grouped by role, your row marked. Every column is what the
 *  tool answered; a null is shown as a dash, never as zero. */
export function RosterTable({ members, now }) {
  // Captured once per mount; a clock read during render is unstable.
  const [mounted] = useState(() => Date.now());
  const at = now ?? mounted;
  const groups = [...ROLE_ORDER, ...new Set(members.map((m) => m.role))]
    .filter((r, i, a) => a.indexOf(r) === i)
    .map((role) => [role, members.filter((m) => m.role === role)])
    .filter(([, rows]) => rows.length > 0);
  return (
    <div className="table__scroll">
      <table className="table">
        <thead>
          <tr>
            <th>Member</th>
            <th>Role</th>
            <th style={{ textAlign: "right" }}>Trophies</th>
            <th style={{ textAlign: "right" }}>Donations</th>
            <th>Last seen in game</th>
            <th>Last recorded battle</th>
          </tr>
        </thead>
        {groups.map(([role, rows]) => (
          <tbody key={role}>
            <tr>
              <td colSpan={6} className="label" style={{ paddingTop: "16px" }}>
                {GROUP[role] ?? role} · {rows.length}
              </td>
            </tr>
            {rows.map((m) => (
              <tr key={m.player_tag} data-you={m.you ? "true" : undefined}>
                <td>
                  {m.you ? (
                    <span
                      className="yours"
                      title="You"
                      style={{ marginRight: "6px" }}
                    >
                      ★
                    </span>
                  ) : null}
                  <span style={{ fontWeight: m.you ? 600 : 400 }}>
                    {m.name ?? m.player_tag}
                  </span>{" "}
                  <span className="tag">{m.player_tag}</span>
                </td>
                <td>
                  <RoleChip role={m.role} label={m.role_label} />
                </td>
                <td
                  className="td--num"
                  style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}
                >
                  {num(m.trophies)}
                </td>
                <td
                  className="td--num"
                  style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}
                >
                  {num(m.donations_this_week)}
                </td>
                <td title={m.last_seen_in_game ?? undefined}>
                  {m.last_seen_in_game ? (
                    ago(m.last_seen_in_game, at)
                  ) : (
                    <span className="nil">—</span>
                  )}
                </td>
                <td title={m.last_recorded_battle ?? undefined}>
                  {m.last_recorded_battle ? (
                    ago(m.last_recorded_battle, at)
                  ) : (
                    <span className="nil">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

export function ClanHeader({ clan, roster, others = [], navigate }) {
  const clanName = roster?.name ?? clan.name ?? clan.clan_tag;
  const [open, setOpen] = useState(false);
  const chip = (
    <>
      <span className="yours">★</span> {clan.acting_as_name ?? clan.acting_as}
      <span style={{ color: "var(--ink-faint)" }}>·</span>
      <RoleChip role={clan.role} label={clan.role_label} />
      <span style={{ color: "var(--ink-faint)" }}>·</span>
      {clanName}
    </>
  );
  return (
    <div className="page-head" style={{ alignItems: "center" }}>
      <h1 className="page__title">{clanName}</h1>
      {others.length > 0 ? (
        <span style={{ position: "relative" }}>
          {/* .chip sets no background, so a BUTTON wearing it kept the
              browser's grey buttonface under light ink (axe: contrast). */}
          <button
            type="button"
            className="chip cursor-pointer border-0 bg-transparent text-inherit"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            style={{ font: "inherit" }}
          >
            {chip} <span aria-hidden="true">▾</span>
          </button>
          {open ? (
            <div
              role="menu"
              className="panel"
              style={{
                position: "absolute",
                top: "110%",
                left: 0,
                zIndex: 20,
                minWidth: "260px",
              }}
            >
              {others.map((c) => (
                <a
                  key={c.clan_tag}
                  role="menuitem"
                  href={`/clan/${c.clan_tag.slice(1)}`}
                  onClick={(e) => {
                    e.preventDefault();
                    setOpen(false);
                    navigate(`/clan/${c.clan_tag.slice(1)}`);
                  }}
                  style={{
                    display: "flex",
                    gap: "8px",
                    alignItems: "center",
                    padding: "10px 14px",
                    color: "inherit",
                  }}
                >
                  <span>{c.name ?? c.clan_tag}</span>
                  <RoleChip role={c.role} label={c.role_label} />
                </a>
              ))}
              <a
                role="menuitem"
                href="/clans"
                onClick={(e) => {
                  e.preventDefault();
                  setOpen(false);
                  navigate("/clans");
                }}
                style={{
                  display: "block",
                  padding: "10px 14px",
                  borderTop: "1px solid var(--line-soft)",
                  fontSize: "13px",
                }}
              >
                All your clans ›
              </a>
            </div>
          ) : null}
        </span>
      ) : (
        <span className="chip">{chip}</span>
      )}
      {roster?.meta ? (
        <Fresh
          label="as of"
          seconds={roster.meta.freshness_seconds}
          ts={roster.meta.as_of}
        />
      ) : null}
    </div>
  );
}

/** The one page. Reads /api/roster once per mount; the API caches it per
 *  session for a few minutes, and "Check again" is rate-limited there. */
export function Clan({ me, clan, navigate }) {
  const others = (me.clans ?? []).filter((c) => c.clan_tag !== clan.clan_tag);

  const tag = clan.clan_tag;
  const gated = useRoster(tag);
  const state = { ...gated.state, roster: gated.state.data };
  const load = gated.load;

  if (state.signedOut) {
    window.location.assign("/?error=session_expired");
    return null;
  }

  return (
    <>
      <ClanHeader
        clan={clan}
        roster={state.roster}
        others={others}
        navigate={navigate}
      />
      {state.loading && !state.roster ? (
        <p className="page__lede">Reading the roster from Elixir…</p>
      ) : state.error ? (
        <div className="callout callout--warn" role="alert">
          <span>
            Elixir did not answer the roster read. Nothing is stored here to
            fall back on; try again in a minute.
          </span>
        </div>
      ) : state.roster?.not_recorded ? (
        <div className="empty">
          <div className="empty__title">
            Elixir is not recording {state.roster.clan_tag} yet
          </div>
          <p className="empty__body">
            Your player is verified and in this clan, but the clan itself is not
            on Elixir&rsquo;s record, so there is no roster to read. Add it
            under Elixir → Tracking (clans), and the roster arrives with the
            first poll.
          </p>
          <a className="btn btn--primary" href={ELIXIR_LINKS.tracking}>
            Elixir → Tracking ›
          </a>
        </div>
      ) : state.roster ? (
        <>
          {state.roster.members.length === 0 ? (
            <div className="empty">
              <div className="empty__title">No members on the record</div>
              <p className="empty__body">
                Elixir knows the clan but has not carried a member for it yet.
                That resolves on its next roster poll.
              </p>
            </div>
          ) : (
            <RosterTable members={state.roster.members} />
          )}
          <div className="pager">
            <span>
              {state.roster.member_count} members
              {state.roster.meta?.as_of
                ? ` · Elixir as of ${state.roster.meta.as_of}`
                : ""}
              {state.roster.cached_at
                ? ` · read ${ago(state.roster.cached_at)}`
                : ""}
            </span>
            <button
              type="button"
              className="btn btn--sm btn--quiet"
              onClick={() => load(true)}
              disabled={state.loading}
              style={{ marginLeft: "auto" }}
            >
              {state.loading ? "Reading…" : "Check again"}
            </button>
          </div>
          {state.roster.notes?.length ? (
            <ul
              style={{
                margin: "14px 0 0",
                paddingLeft: "18px",
                color: "var(--ink-faint)",
                fontSize: "12.5px",
              }}
            >
              {state.roster.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </>
  );
}
