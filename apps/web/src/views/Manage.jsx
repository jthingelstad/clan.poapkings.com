import { Fresh, ago } from "elixir-mcp/packages/ui/src/index.ts";
import { useState } from "react";
import { useHistory, useManage } from "../lib/queries.js";
import { MemberSheet } from "../components/MemberSheet.jsx";
import { ActionLog, CopyLine } from "../components/ActionCard.jsx";
import { RoleChip } from "../components/RoleChip.jsx";
import { Policy } from "./Policy.jsx";
import { Scout } from "./Scout.jsx";
import { Awards } from "./Awards.jsx";
import { Settings } from "./Settings.jsx";
import { TooFew } from "../components/TooFew.jsx";

const TITLES = {
  board: "Board",
  history: "History",
  policy: "Policy",
  awards: "Awards",
  scout: "Scout",
  settings: "Clan settings",
  model: "Clan settings",
};

const BUCKET_LABEL = {
  actionable: "Actionable",
  building: "Building",
  held: "Held",
  clear: "Clear",
};

/** Manage: leader and co-leader only (the API refuses everyone else). */
export function Manage({ clan, tab, navigate, who }) {
  const [open, setOpen] = useState(null); // member sheet
  // The judged board, read for every tab but the ones that read their
  // own thing.
  const { state, load, query } = useManage(
    clan.clan_tag,
    !["policy", "scout", "awards", "settings", "model"].includes(tab),
  );

  if (state.signedOut) {
    window.location.assign("/?error=session_expired");
    return null;
  }
  const head = (
    <div className="page-head" style={{ alignItems: "center" }}>
      <h1 className="page__title">{TITLES[tab] ?? "Manage"}</h1>
      <span className="chip">
        <span className="yours">★</span> {clan.acting_as_name ?? clan.acting_as}
        <span style={{ color: "var(--ink-faint)" }}>·</span>
        <RoleChip role={clan.role} label={clan.role_label} />
        <span style={{ color: "var(--ink-faint)" }}>·</span>
        {clan.name ?? clan.clan_tag}
      </span>
      {state.data ? (
        <Fresh
          label="as of"
          seconds={state.data.freshness_seconds}
          ts={state.data.as_of}
        />
      ) : null}
    </div>
  );
  // The rail carries the sections now (2026-09-12); nothing to repeat here.
  const tabs = null;
  if (tab === "policy")
    return (
      <>
        {head}
        {tabs}
        <Policy clan={clan} />
      </>
    );
  if (tab === "scout")
    return (
      <>
        {head}
        {tabs}
        <Scout clan={clan} />
      </>
    );
  // The clan's model moved into clan settings; its old address lands there.
  if (tab === "settings" || tab === "model")
    return (
      <>
        {head}
        <Settings clan={clan} />
      </>
    );
  if (tab === "awards")
    return (
      <>
        {head}
        {tabs}
        <Awards clan={clan} />
      </>
    );
  if (state.forbidden)
    return (
      <>
        {head}
        <div className="callout callout--warn" role="alert">
          <span>Manage is for the leader and co-leaders.</span>
        </div>
      </>
    );
  if (state.error === "too_few_members") {
    const d = query.data?.data ?? {};
    return (
      <>
        {head}
        <TooFew members={d.members} min={d.min_members} />
      </>
    );
  }
  if (state.error === "no_policy")
    return (
      <>
        {head}
        <div className="empty">
          <div className="empty__title">No policy yet</div>
          <p className="empty__body">
            Nothing in clan management runs until a leader or co-leader sets
            this clan&rsquo;s policy.{" "}
            <a
              href={`/clan/${clan.clan_tag.slice(1)}/manage/policy`}
              onClick={(e) => {
                e.preventDefault();
                navigate(`/clan/${clan.clan_tag.slice(1)}/manage/policy`);
              }}
            >
              Set up the policy
            </a>
          </p>
        </div>
      </>
    );
  if (state.error)
    return (
      <>
        {head}
        {tabs}
        <div className="callout callout--warn" role="alert">
          <span>
            {state.error === "clan_not_recorded"
              ? "Elixir is not recording this clan yet, so there is nothing to judge."
              : "Elixir did not answer. Try again in a minute."}
          </span>
        </div>
      </>
    );
  if (!state.data)
    return (
      <>
        {head}
        {tabs}
        <p className="page__lede">Reading the record and judging the roster…</p>
      </>
    );
  const d = state.data;
  const evidenceLine = (
    <p className="page-head__note" style={{ margin: "0 0 14px" }}>
      Judged {ago(d.evaluated_at)} under policy v{d.policy_version}
      {d.boundaries.length
        ? ` over ${d.boundaries.length} weekly reviews (last ${d.boundaries.at(-1).slice(0, 10)})`
        : " with no closed weekly review on record yet"}
      {d.recording_active_since
        ? ` · recording since ${d.recording_active_since.slice(0, 10)}`
        : ""}
      {" · "}
      <button
        type="button"
        className="btn--text"
        onClick={() => load(true)}
        disabled={state.loading}
      >
        {state.loading ? "reading…" : "re-judge now"}
      </button>
    </p>
  );
  const sheet = (m) =>
    open === m.player_tag ? (
      <MemberSheet
        clanTag={clan.clan_tag}
        member={m}
        role={who.role}
        onChange={() => load(true)}
      />
    ) : null;

  if (tab === "history")
    return (
      <>
        {head}
        {tabs}
        <History clan={clan} navigate={navigate} />
      </>
    );
  return (
    <>
      {head}
      {tabs}
      {evidenceLine}
      <BandLine band={d.band} roster={d.roster} />
      {["actionable", "building", "held", "clear"].map((bucket) => {
        const rows = d.board.filter((m) => m.bucket === bucket);
        if (!rows.length) return null;
        return (
          <section key={bucket} style={{ marginBottom: "22px" }}>
            <div className="label" style={{ marginBottom: "8px" }}>
              {BUCKET_LABEL[bucket]} · {rows.length}
            </div>
            <div className="table__scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Role</th>
                    {d.policy?.ranks_elder ? <th>Elder</th> : null}
                    {d.policy?.removal ? <th>Removal</th> : null}
                    <th>Evidence</th>
                    <th>Judgment</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr
                      key={m.player_tag}
                      data-you={
                        m.player_tag === who.player_tag ? "true" : undefined
                      }
                    >
                      <td>
                        <button
                          type="button"
                          className="btn--text"
                          onClick={() =>
                            setOpen(open === m.player_tag ? null : m.player_tag)
                          }
                        >
                          {m.name ?? m.player_tag}
                        </button>{" "}
                        <span className="tag">{m.player_tag}</span>
                        {m.hold?.active !== false && m.hold ? (
                          <span
                            className="chip chip--info"
                            style={{ marginLeft: "6px" }}
                            title={m.hold.note ?? undefined}
                          >
                            {m.hold.kind === "away" ? "away" : "hold"}
                            {m.hold.until
                              ? ` · ${m.hold.until.slice(0, 10)}`
                              : ""}
                          </span>
                        ) : null}
                        {sheet(m)}
                      </td>
                      <td>
                        <RoleChip role={m.role} label={m.role} />
                      </td>
                      {d.policy?.ranks_elder ? <td>{elderCell(m)}</td> : null}
                      {d.policy?.removal ? <td>{removalCell(m)}</td> : null}
                      <td style={{ whiteSpace: "normal", maxWidth: "320px" }}>
                        {m.phrase || <span className="nil">—</span>}
                      </td>
                      <td className="max-w-[280px] min-w-[180px] whitespace-normal">
                        {judgmentCell(m)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}

function BandLine({ band, roster }) {
  if (!band)
    return roster ? (
      <p className="page-head__note mt-0 mb-4">
        Roster {roster.size} ({roster.open_slots} open) · Elders are chosen by
        the leaders
      </p>
    ) : null;
  return (
    <p className="page-head__note" style={{ margin: "0 0 16px" }}>
      Roster {band.roster_size} ({band.open_slots} open) · Elders{" "}
      {band.current_elders} of a {band.floor}–{band.ceil} band, target{" "}
      {band.target} · {band.ranked_population} ranked
    </p>
  );
}

function elderCell(m) {
  if (
    m.judgment.promotion === "not_applicable" &&
    m.judgment.demotion === "not_applicable"
  )
    return <span className="nil">—</span>;
  if (m.role === "elder") {
    if (m.demotion.state !== "none")
      return (
        <span className="chip chip--warn">
          {m.demotion.reason ?? "slipping"} · {m.demotion.weeks} wk
        </span>
      );
    return <span className="chip chip--ok">holding</span>;
  }
  if (m.promotion.state === "eligible")
    return <span className="chip chip--ok">eligible</span>;
  if (m.promotion.state === "building")
    return (
      <span className="chip chip--info">building · {m.promotion.weeks} wk</span>
    );
  return <span className="nil">—</span>;
}

function removalCell(m) {
  const r = m.removal;
  if (r.days_idle === null) return <span className="nil">unknown</span>;
  const tone =
    r.state === "recommended"
      ? "chip--bad"
      : r.state === "at_risk"
        ? "chip--warn"
        : r.state === "watch"
          ? "chip--info"
          : "";
  return (
    <span className={`chip ${tone}`}>
      {r.state === "none" ? "active" : r.state.replace("_", " ")} ·{" "}
      {Math.floor(r.days_idle)}d{r.shielded ? ` · ${r.shielded}` : ""}
    </span>
  );
}

function judgmentCell(m) {
  if (m.judgment_reasons?.length)
    return (
      <span className="text-ink-faint">{m.judgment_reasons.join(" ")}</span>
    );
  const js = [
    m.judgment.promotion,
    m.judgment.demotion,
    m.judgment.removal,
  ].filter((j) => j !== "not_applicable" && j !== "off");
  if (js.includes("unknown"))
    return <span className="caveat">tenure unknown</span>;
  if (js.includes("held")) return <span className="caveat">held</span>;
  return <span className="chip chip--ok">ready</span>;
}

const EVENT_LABEL = {
  member_joined: "joined",
  member_left: "left",
  role_changed: "role changed",
};
const CLASS_LABEL = {
  member_kicked: "kicked",
  member_left: "left",
  ignored: "ignored",
};

function History({ clan, navigate }) {
  const { data } = useHistory(clan.clan_tag);
  if (!data) return <p className="page__lede">Loading…</p>;
  const timeline = data.timeline ?? [];
  return (
    <>
      <div className="label" style={{ margin: "0 0 8px" }}>
        Membership
        {data.timeline_since
          ? ` · as the record saw it since ${data.timeline_since.slice(0, 10)}`
          : ""}
      </div>
      {timeline.length === 0 ? (
        <p className="page__lede" style={{ margin: "0 0 18px" }}>
          No join, leave or role change on record yet.
        </p>
      ) : (
        <div className="table__scroll" style={{ marginBottom: "22px" }}>
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Member</th>
                <th>What</th>
                <th>Says the ledger</th>
                <th>In-game</th>
              </tr>
            </thead>
            <tbody>
              {timeline.map((e) => (
                <tr key={`${e.type}-${e.player_tag}-${e.at}`}>
                  <td>{e.at.slice(0, 10)}</td>
                  <td>
                    {e.name ?? e.player_tag}{" "}
                    <span className="tag">{e.player_tag}</span>
                  </td>
                  <td>
                    {EVENT_LABEL[e.type] ?? e.type}
                    {e.type === "role_changed" && e.role_after
                      ? `: ${e.role_before ?? "?"} → ${e.role_after}`
                      : ""}
                  </td>
                  <td>
                    {e.type !== "member_left" ? (
                      <span className="nil">—</span>
                    ) : e.classification ? (
                      <span
                        className={`chip ${e.classification === "member_kicked" ? "chip--warn" : "chip--ok"}`}
                      >
                        {CLASS_LABEL[e.classification]}
                      </span>
                    ) : (
                      <span className="chip chip--info">
                        unanswered (Actions)
                      </span>
                    )}
                    {e.note ? (
                      <div className="page-head__note mt-1 whitespace-normal">
                        {e.note}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ whiteSpace: "normal", minWidth: "260px" }}>
                    {e.copy ? (
                      <CopyLine text={e.copy} />
                    ) : (
                      <span className="nil">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="label" style={{ margin: "0 0 8px" }}>
        Actions
      </div>
      <div className="table__scroll">
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Raised</th>
              <th>Member</th>
              <th>Action</th>
              <th>Outcome</th>
              <th>Decided by</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {data.cards.length === 0 ? (
              <tr>
                <td colSpan={7} className="nil">
                  No action taken yet.
                </td>
              </tr>
            ) : (
              data.cards.map((c) => (
                <tr key={c.card_id}>
                  <td className="mono">
                    {Number.isInteger(c.number) &&
                    c.audience?.kind !== "member" ? (
                      <a
                        href={`/clan/${clan.clan_tag.slice(1)}/actions/${c.number}`}
                        onClick={(e) => {
                          if (!navigate) return;
                          e.preventDefault();
                          navigate(
                            `/clan/${clan.clan_tag.slice(1)}/actions/${c.number}`,
                          );
                        }}
                      >
                        #{c.number}
                      </a>
                    ) : Number.isInteger(c.number) ? (
                      `#${c.number}`
                    ) : null}
                  </td>
                  <td>{c.raised_at.slice(0, 10)}</td>
                  <td>
                    {c.player_name ?? c.player_tag}{" "}
                    <span className="tag">{c.player_tag}</span>
                  </td>
                  <td>{c.label}</td>
                  <td>
                    <span
                      className={`chip ${c.status === "done" ? "chip--ok" : c.status === "declined" ? "chip--warn" : ""}`}
                    >
                      {c.status === "done" ? "completed" : c.status}
                    </span>
                    {c.outcome?.verified_at ? (
                      <span
                        className="chip chip--ok"
                        style={{ marginLeft: "6px" }}
                      >
                        {c.outcome.delay_hours != null
                          ? `confirmed ${Math.round(c.outcome.delay_hours)} h after completion`
                          : "verified"}
                      </span>
                    ) : null}
                    {c.outcome?.flagged_at ? (
                      <span
                        className="chip chip--bad"
                        style={{ marginLeft: "6px" }}
                      >
                        no change seen
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {c.decided_by ? (
                      <>
                        {c.decided_by_name ?? ""}{" "}
                        <span className="tag">{c.decided_by}</span>
                      </>
                    ) : (
                      <span className="nil">—</span>
                    )}
                    {c.decided_at ? ` · ${c.decided_at.slice(0, 10)}` : ""}
                  </td>
                  <td style={{ whiteSpace: "normal" }}>
                    {c.decline_reason
                      ? c.decline_reason.replaceAll("_", " ")
                      : ""}
                    {c.decision_note ? ` · ${c.decision_note}` : ""}
                    {c.withdraw_reason ?? ""}
                    <details className="mt-1">
                      <summary className="page-head__note cursor-pointer">
                        Log · {(c.log ?? []).length}
                      </summary>
                      <div className="mt-2 min-w-[320px]">
                        <ActionLog action={c} clan={clan} />
                      </div>
                    </details>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {data.holds.length ? (
        <>
          <div className="label" style={{ margin: "18px 0 8px" }}>
            Holds
          </div>
          <ul style={{ margin: 0, paddingLeft: "18px" }}>
            {data.holds.map((h) => (
              <li key={h.player_tag}>
                {h.player_name ?? ""}{" "}
                <span className="tag">{h.player_tag}</span>{" "}
                {h.kind === "away" ? "away " : ""}
                {h.until ? `until ${h.until.slice(0, 10)}` : "open-ended"} · set
                by {h.by_name ?? h.by} on {h.set_at.slice(0, 10)}
                {h.note ? ` · ${h.note}` : ""}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
