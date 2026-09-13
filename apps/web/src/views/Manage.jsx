import { Fresh, Icon, ago } from "elixir-mcp/packages/ui/src/index.ts";
import { useState } from "react";
import { manageApi } from "../api.js";
import { useHistory, useManage } from "../lib/queries.js";
import { MemberSheet } from "../components/MemberSheet.jsx";
import { RoleChip } from "../components/RoleChip.jsx";
import { Policy } from "./Policy.jsx";
import { Scout } from "./Scout.jsx";
import { Awards } from "./Awards.jsx";
import { trackEvent } from "../analytics.js";

const TITLES = {
  inbox: "Inbox",
  board: "Board",
  history: "History",
  policy: "Policy",
  awards: "Awards",
  scout: "Scout",
};

const TYPE_LABEL = {
  promotion: "Promote to Elder",
  demotion: "Demote to Member",
  removal: "Remove from the clan",
  departure: "Departure: kicked, left, or ignore?",
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
  // The judged board, read for every tab but the three that read their
  // own thing.
  const { state, load } = useManage(
    clan.clan_tag,
    tab !== "policy" && tab !== "scout" && tab !== "awards",
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
  void navigate;
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
        : " with no closed war week on record yet"}
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
        <History clan={clan} />
      </>
    );
  if (tab === "board")
    return (
      <>
        {head}
        {tabs}
        {evidenceLine}
        <BandLine band={d.band} />
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
                      <th>Elder</th>
                      <th>Removal</th>
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
                              setOpen(
                                open === m.player_tag ? null : m.player_tag,
                              )
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
                        <td>{elderCell(m)}</td>
                        <td>{removalCell(m)}</td>
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
  // Inbox
  const groups = ["departure", "removal", "promotion", "demotion"]
    .map((t) => [t, d.inbox.filter((c) => c.type === t)])
    .filter(([, cs]) => cs.length);
  return (
    <>
      {head}
      {tabs}
      {evidenceLine}
      {groups.length === 0 ? (
        <div className="empty">
          <div className="empty__title">Nothing to decide</div>
          <p className="empty__body">
            No card is open. The board shows what is building; a card appears
            here when the policy's clock or weekly reviews say so.
          </p>
        </div>
      ) : (
        groups.map(([type, cards]) => (
          <section key={type} style={{ marginBottom: "22px" }}>
            <div className="label" style={{ marginBottom: "8px" }}>
              {TYPE_LABEL[type]} · {cards.length}
            </div>
            <div style={{ display: "grid", gap: "12px" }}>
              {cards.map((c) => (
                <Card
                  key={c.card_id}
                  card={c}
                  clan={clan}
                  reasons={d.decline_reasons}
                  onDecided={() => load(true)}
                  who={who}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}

function BandLine({ band }) {
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

function Card({ card, clan, reasons, onDecided, who }) {
  const [reason, setReason] = useState("not_now");
  const [note, setNote] = useState("");
  const [declining, setDeclining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState(false);
  const decide = async (status, classification = null) => {
    setBusy(true);
    setError("");
    const r = await manageApi.decide(clan.clan_tag, card.card_id, {
      status,
      reason: status === "declined" ? reason : null,
      note: note || null,
      ...(classification ? { classification } : {}),
    });
    setBusy(false);
    if (!r.ok)
      return setError(
        r.data?.error === "card_closed"
          ? "This card was already decided or withdrawn."
          : "That did not work.",
      );
    trackEvent("clan.card_decided", `${card.type}:${classification ?? status}`);
    onDecided();
  };
  const ev = card.evidence ?? {};
  return (
    <div className="panel" data-card={card.card_id}>
      <div className="panel__head">
        <span>{card.player_name ?? card.player_tag}</span>
        <span className="tag">{card.player_tag}</span>
        <RoleChip role={card.role_at_raise} label={card.role_at_raise} />
        <span style={{ marginLeft: "auto" }}>
          <Fresh
            label="evidence as of"
            seconds={ev.freshness_seconds}
            ts={ev.as_of}
          />
        </span>
      </div>
      <div className="panel__body" style={{ display: "grid", gap: "10px" }}>
        <div style={{ fontWeight: 600 }}>{TYPE_LABEL[card.type]}</div>
        {card.type === "departure" ? (
          <div>
            Left the clan {ago(ev.left_at)} ({ev.left_at?.slice(0, 10)})
            {ev.removal_state && ev.removal_state !== "none"
              ? ` · was ${ev.removal_state.replaceAll("_", " ")} on the clock`
              : ""}
            {ev.days_idle !== null && ev.days_idle !== undefined
              ? ` · ${Math.round(ev.days_idle)} days since their last battle`
              : ""}
            {ev.tenure_days !== null && ev.tenure_days !== undefined
              ? ` · ${ev.tenure_days} days in the clan`
              : ""}
            . A leave and a kick look the same in the record; say which so the
            ledger knows.
          </div>
        ) : (
          <div>{ev.rationale?.headline}</div>
        )}
        {card.copy ? <CopyLine text={card.copy} /> : null}
        <ul
          style={{
            margin: 0,
            paddingLeft: "18px",
            color: "var(--ink-body)",
            fontSize: "13.5px",
          }}
        >
          {(ev.facts ?? []).map((f) => (
            <li key={f.key}>
              <span className="label" style={{ marginRight: "6px" }}>
                {f.label}
              </span>
              {f.value}{" "}
              <span className="page-head__note">
                ({f.window}
                {f.fidelity !== "daily" ? `, ${f.fidelity}` : ""})
              </span>
            </li>
          ))}
        </ul>
        <div className="page-head__note">
          Policy v{card.policy_version}:{" "}
          {(ev.rationale?.clauses ?? []).map((c) => (
            <a
              key={c}
              href={`/clan/${clan.clan_tag.slice(1)}/manage/policy#${c}`}
              style={{ marginRight: "8px" }}
            >
              {c}
            </a>
          ))}
          · raised {ago(card.raised_at)}
        </div>
        {card.type === "departure" ? (
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn--danger"
              disabled={busy}
              onClick={() => decide("done", "kick")}
            >
              Kicked
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => decide("done", "leave")}
            >
              Left
            </button>
            <button
              type="button"
              className="btn btn--quiet"
              disabled={busy}
              onClick={() => decide("done", "ignore")}
            >
              Ignore
            </button>
          </div>
        ) : !declining ? (
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={() => decide("done")}
            >
              Done
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => setDeclining(true)}
            >
              Decline
            </button>
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => setSheet((v) => !v)}
            >
              Notes & hold
            </button>
          </div>
        ) : (
          <form
            style={{
              display: "flex",
              gap: "8px",
              flexWrap: "wrap",
              alignItems: "center",
            }}
            onSubmit={(e) => {
              e.preventDefault();
              decide("declined");
            }}
          >
            <select
              className="select"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              {reasons.map((r) => (
                <option key={r} value={r}>
                  {r.replaceAll("_", " ")}
                </option>
              ))}
            </select>
            <input
              className="input"
              placeholder="note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ flex: "1 1 160px" }}
            />
            <button type="submit" className="btn btn--danger" disabled={busy}>
              Decline
            </button>
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => setDeclining(false)}
            >
              Back
            </button>
          </form>
        )}
        {sheet ? (
          <MemberSheet
            clanTag={clan.clan_tag}
            member={{
              player_tag: card.player_tag,
              name: card.player_name,
              role: card.role_at_raise,
              hold: null,
            }}
            role={who.role}
            onChange={onDecided}
          />
        ) : null}
        {error ? (
          <div className="callout callout--warn" role="alert">
            <span>{error}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Paste-ready in-game copy: the bot's relay without the bot. */
function CopyLine({ text }) {
  const [done, setDone] = useState(false);
  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        alignItems: "flex-start",
        background: "var(--ground-sunken)",
        border: "1px solid var(--line-soft)",
        borderRadius: "8px",
        padding: "8px 10px",
        fontSize: "13px",
      }}
    >
      <span style={{ flex: "1 1 auto" }}>{text}</span>
      <button
        type="button"
        className="btn btn--sm"
        title="Copy for clan chat"
        aria-label="Copy for clan chat"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            trackEvent("clan.copy_in_game");
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          } catch {
            // The line is on screen to select by hand.
          }
        }}
      >
        <Icon name={done ? "check" : "copy"} size={14} />
      </button>
    </div>
  );
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

function History({ clan }) {
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
                        unanswered (Inbox)
                      </span>
                    )}
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
        Cards
      </div>
      <div className="table__scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Raised</th>
              <th>Member</th>
              <th>Card</th>
              <th>Outcome</th>
              <th>Decided by</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {data.cards.length === 0 ? (
              <tr>
                <td colSpan={6} className="nil">
                  No decided card yet.
                </td>
              </tr>
            ) : (
              data.cards.map((c) => (
                <tr key={c.card_id}>
                  <td>{c.raised_at.slice(0, 10)}</td>
                  <td>
                    {c.player_name ?? c.player_tag}{" "}
                    <span className="tag">{c.player_tag}</span>
                  </td>
                  <td>{TYPE_LABEL[c.type]}</td>
                  <td>
                    <span
                      className={`chip ${c.status === "done" ? "chip--ok" : c.status === "declined" ? "chip--warn" : ""}`}
                    >
                      {c.status}
                    </span>
                    {c.outcome?.verified_at ? (
                      <span
                        className="chip chip--ok"
                        style={{ marginLeft: "6px" }}
                      >
                        verified {c.outcome.delay_hours} h after Done
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
                    {c.decided_by ?? <span className="nil">—</span>}
                    {c.decided_at ? ` · ${c.decided_at.slice(0, 10)}` : ""}
                  </td>
                  <td style={{ whiteSpace: "normal" }}>
                    {c.decline_reason
                      ? c.decline_reason.replaceAll("_", " ")
                      : ""}
                    {c.decision_note ? ` · ${c.decision_note}` : ""}
                    {c.withdraw_reason ?? ""}
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
                <span className="tag">{h.player_tag}</span>{" "}
                {h.kind === "away" ? "away " : ""}
                {h.until ? `until ${h.until.slice(0, 10)}` : "open-ended"} · set
                by {h.by} on {h.set_at.slice(0, 10)}
                {h.note ? ` · ${h.note}` : ""}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
