import { useCallback, useEffect, useState } from "react";
import { manageApi } from "../api.js";
import { trackEvent } from "../analytics.js";

/**
 * Away: a member tells the clan they will be gone, on their own page.
 * elixir-bot took this in chat as a leader's `Hold:` memory; here the
 * member says it themselves (Jamie, 2026-09-12: "they could go there and
 * indicate they are away"). The clock pauses like a leader's hold, up to
 * the policy's cap; leaders see it on the board with the member's note
 * and can clear it; a leader's own hold is not the member's to move.
 */
export function Away({ me }) {
  const clan = me?.selected ?? null;
  const [state, setState] = useState(null);
  const [until, setUntil] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [today] = useState(() => Date.now());
  const load = useCallback(async () => {
    if (!clan) return;
    const r = await manageApi.myAway(clan.clan_tag);
    if (r.ok) setState(r.data);
  }, [clan]);
  useEffect(() => {
    load();
  }, [load]);

  if (!clan)
    return (
      <p className="page__lede">Choose a clan first; away is said per clan.</p>
    );
  if (!state) return <p className="page__lede">Loading…</p>;
  const hold = state.hold;
  const maxDate = new Date(today + state.max_days * 86400_000)
    .toISOString()
    .slice(0, 10);
  const ERRORS = {
    too_long: `At most ${state.max_days} days from today.`,
    bad_until: "Pick a date after today.",
    held_by_leader: "A leader has set a hold on you; ask them to change it.",
    away_off: "This clan does not take away notices here.",
  };
  return (
    <div style={{ maxWidth: "640px" }}>
      <div className="page-head">
        <h1 className="page__title">Away</h1>
        <span className="page-head__note">
          {clan.name ?? clan.clan_tag} · as{" "}
          {clan.player_name ?? clan.player_tag}
        </span>
      </div>
      <p className="page__lede" style={{ margin: "0 0 16px" }}>
        Going to be gone for a bit? Say so here and the inactivity clock pauses
        until the day you name. Leaders see it beside your name.
        {state.allowed
          ? ` Up to ${state.max_days} days at a time.`
          : " This clan has turned this off; tell a leader instead."}
      </p>
      {hold ? (
        <div className="panel">
          <div className="panel__head">
            <span>
              {hold.kind === "away"
                ? "You are marked away"
                : "A leader has you on hold"}
            </span>
          </div>
          <div className="panel__body" style={{ display: "grid", gap: "8px" }}>
            <div>
              {hold.until ? `Until ${hold.until.slice(0, 10)}` : "Open-ended"}
              {hold.note ? ` · ${hold.note}` : ""}
              {hold.kind !== "away" ? ` · set by ${hold.by}` : ""}
            </div>
            {hold.kind === "away" ? (
              <button
                type="button"
                className="btn"
                style={{ width: "fit-content" }}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await manageApi.clearAway(clan.clan_tag);
                  trackEvent("clan.away_cleared");
                  setBusy(false);
                  load();
                }}
              >
                I&rsquo;m back
              </button>
            ) : null}
          </div>
        </div>
      ) : state.allowed ? (
        <form
          className="panel"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const r = await manageApi.setAway(clan.clan_tag, {
              until: new Date(`${until}T23:59:59Z`).toISOString(),
              note,
            });
            setBusy(false);
            if (!r.ok)
              return setError(ERRORS[r.data?.error] ?? "That did not work.");
            trackEvent("clan.away_set");
            setUntil("");
            setNote("");
            load();
          }}
        >
          <div className="panel__head">
            <span>Mark yourself away</span>
          </div>
          <div className="panel__body" style={{ display: "grid", gap: "10px" }}>
            <label className="field-label" htmlFor="away-until">
              Back on
            </label>
            <input
              id="away-until"
              className="input"
              type="date"
              required
              min={new Date(today + 86400_000).toISOString().slice(0, 10)}
              max={maxDate}
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              style={{ width: "auto" }}
            />
            <label className="field-label" htmlFor="away-note">
              A word for the leaders{" "}
              <span className="page-head__note">(optional)</span>
            </label>
            <input
              id="away-note"
              className="input"
              maxLength={200}
              placeholder="Holiday, exams, a new baby…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {error ? <p className="field-error">{error}</p> : null}
            <button
              type="submit"
              className="btn btn--primary"
              style={{ width: "fit-content" }}
              disabled={busy || !until}
            >
              Mark me away
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
