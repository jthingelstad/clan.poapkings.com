import { useCallback, useEffect, useState } from "react";
import { manageApi } from "../api.js";
import { trackEvent } from "../analytics.js";

/**
 * One member, for an elder or a leader: notes (elders read and write elder
 * notes; leaders write leader notes and read both) and, for leaders, the
 * hold. Context beside the clock: a note is what a leader knows, a hold is
 * the clock paused.
 */
export function MemberSheet({ clanTag, member, role, onChange }) {
  const isLeader = role === "leader" || role === "coLeader";
  const [notes, setNotes] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [holdUntil, setHoldUntil] = useState(
    member.hold?.until ? member.hold.until.slice(0, 10) : "",
  );
  const [holdNote, setHoldNote] = useState(member.hold?.note ?? "");

  const [awards, setAwards] = useState(null);

  const load = useCallback(async () => {
    const r = await manageApi.notes(clanTag, member.player_tag);
    setNotes(r.ok ? r.data.notes : []);
    const a = await manageApi.memberAwards(clanTag, member.player_tag);
    setAwards(a.ok ? a.data.grants : []);
  }, [clanTag, member.player_tag]);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn) => {
    setBusy(true);
    setError("");
    const r = await fn();
    setBusy(false);
    if (!r.ok) setError(r.data?.error ?? "That did not work.");
    return r;
  };

  return (
    <div className="panel" style={{ marginTop: "12px" }}>
      <div className="panel__head">
        <span className="yours">{member.name ?? member.player_tag}</span>
        <span className="tag">{member.player_tag}</span>
        <span className="chip">{member.role}</span>
      </div>
      <div className="panel__body" style={{ display: "grid", gap: "14px" }}>
        {awards && awards.length > 0 ? (
          <div>
            <div className="label" style={{ marginBottom: "6px" }}>
              Awards
            </div>
            <ul
              style={{
                margin: 0,
                paddingLeft: "18px",
                display: "grid",
                gap: "4px",
              }}
            >
              {awards.map((g) => (
                <li key={`${g.season_id}-${g.award_id}`}>
                  <strong>{g.name}</strong>
                  {g.rank > 1 ? ` #${g.rank}` : ""} · season {g.season_id}
                  {g.note ? ` — ${g.note}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div>
          <div className="label" style={{ marginBottom: "6px" }}>
            Notes
          </div>
          {notes === null ? (
            <p className="page__lede">Loading…</p>
          ) : notes.length === 0 ? (
            <p className="page__lede">No notes yet.</p>
          ) : (
            <ul
              style={{
                margin: 0,
                paddingLeft: "18px",
                display: "grid",
                gap: "6px",
              }}
            >
              {notes.map((n) => (
                <li key={n.note_id}>
                  <span className={`kind-chip`} style={{ marginRight: "6px" }}>
                    {n.tier}
                  </span>
                  {n.text}{" "}
                  <span className="page-head__note">
                    · {n.author_name ?? n.author_tag} ·{" "}
                    {n.created_at.slice(0, 10)}
                  </span>{" "}
                  <button
                    type="button"
                    className="btn--text"
                    onClick={async () => {
                      await run(() => manageApi.removeNote(clanTag, n.note_id));
                      load();
                    }}
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            style={{
              display: "flex",
              gap: "8px",
              marginTop: "10px",
              flexWrap: "wrap",
            }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (!text.trim()) return;
              const r = await run(() =>
                manageApi.addNote(clanTag, member.player_tag, text),
              );
              if (r.ok) {
                trackEvent("clan.note_added", isLeader ? "leader" : "elder");
                setText("");
                load();
              }
            }}
          >
            <input
              className="input"
              style={{ flex: "1 1 240px" }}
              placeholder={
                isLeader
                  ? "A leader note (leaders see these)"
                  : "An elder note (elders and leaders see these)"
              }
              value={text}
              maxLength={2000}
              onChange={(e) => setText(e.target.value)}
            />
            <button
              type="submit"
              className="btn"
              disabled={busy || !text.trim()}
            >
              Add note
            </button>
          </form>
        </div>
        {isLeader ? (
          <div>
            <div className="label" style={{ marginBottom: "6px" }}>
              Hold
            </div>
            {member.hold ? (
              <p className="page__lede" style={{ margin: "0 0 8px" }}>
                On hold{" "}
                {member.hold.until
                  ? `until ${member.hold.until.slice(0, 10)}`
                  : "until cleared"}
                {member.hold.note ? ` · ${member.hold.note}` : ""}. The removal
                clock is paused.
              </p>
            ) : (
              <p className="page__lede" style={{ margin: "0 0 8px" }}>
                Not on hold. A hold pauses the removal clock for a member who
                told you they will be away; silence is not a hold.
              </p>
            )}
            <form
              style={{
                display: "flex",
                gap: "8px",
                flexWrap: "wrap",
                alignItems: "center",
              }}
              onSubmit={async (e) => {
                e.preventDefault();
                const r = await run(() =>
                  manageApi.setHold(clanTag, member.player_tag, {
                    until: holdUntil ? `${holdUntil}T23:59:59Z` : null,
                    note: holdNote || null,
                  }),
                );
                if (r.ok) {
                  trackEvent("clan.hold_set", holdUntil ? "until" : "open");
                  onChange?.();
                }
              }}
            >
              <input
                className="input"
                type="date"
                value={holdUntil}
                onChange={(e) => setHoldUntil(e.target.value)}
              />
              <input
                className="input"
                placeholder="why (optional)"
                value={holdNote}
                onChange={(e) => setHoldNote(e.target.value)}
                style={{ flex: "1 1 160px" }}
              />
              <button type="submit" className="btn" disabled={busy}>
                {member.hold ? "Update hold" : "Set hold"}
              </button>
              {member.hold ? (
                <button
                  type="button"
                  className="btn btn--quiet"
                  disabled={busy}
                  onClick={async () => {
                    const r = await run(() =>
                      manageApi.clearHold(clanTag, member.player_tag),
                    );
                    if (r.ok) onChange?.();
                  }}
                >
                  Clear hold
                </button>
              ) : null}
            </form>
          </div>
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
