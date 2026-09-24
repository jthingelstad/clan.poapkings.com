import { useEffect, useRef, useState } from "react";
import { manageApi } from "../api.js";
import { trackEvent } from "../analytics.js";

/**
 * Scout an applicant: paste the tag from the game, read it live on your
 * own live lane, and see the policy answer (would they clear
 * Consideration today; their inactivity clock) beside the performance.
 */
export function Scout({ clan }) {
  const [tag, setTag] = useState("");
  const [state, setState] = useState({});
  const timer = useRef(null);
  // A read that stays pending is asked again a few times, not forever:
  // a clan tag pasted here queued a player read that never arrived and
  // the page polled all night (overnight walk 2026-09-24).
  const MAX_TRIES = 6;

  const read = async (t, tries = 1) => {
    setState((s) => ({ ...s, loading: true, error: "" }));
    const r = await manageApi.scout(clan.clan_tag, t);
    if (!r.ok)
      return setState({
        error:
          r.data?.code === "invalid_tag"
            ? "That is not a player tag. Tags look like #20JJJ2CCRU."
            : (r.data?.error ?? "Elixir did not answer."),
      });
    setState({ result: r.data });
    trackEvent("clan.scout", r.data.pending ? "pending" : "answered");
    if (r.data.pending?.retry_after_s) {
      if (tries >= MAX_TRIES)
        return setState({
          error:
            "Elixir has not been able to read that player yet. Check it is a player tag (from the player's profile, not the clan's) and try again in a few minutes.",
        });
      timer.current = window.setTimeout(
        () => read(t, tries + 1),
        Math.min(60, r.data.pending.retry_after_s) * 1000,
      );
    }
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const r = state.result;
  const p = r?.profile;
  const a = r?.policy_answer;
  return (
    <div style={{ display: "grid", gap: "16px", maxWidth: "720px" }}>
      <form
        style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}
        onSubmit={(e) => {
          e.preventDefault();
          window.clearTimeout(timer.current);
          if (tag.trim()) read(tag.trim());
        }}
      >
        <input
          className="input"
          placeholder="#TAG from the game"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          style={{ flex: "1 1 220px" }}
          autoCapitalize="characters"
        />
        <button
          type="submit"
          className="btn btn--primary"
          disabled={state.loading}
        >
          {state.loading ? "Reading…" : "Scout"}
        </button>
      </form>
      <p className="page-head__note" style={{ margin: 0 }}>
        Two live reads from the game on your own live lane. If Elixir has
        nothing in hand it queues the read and this page asks again by itself.
      </p>
      {state.error ? (
        <div className="callout callout--warn" role="alert">
          <span>{state.error}</span>
        </div>
      ) : null}
      {r?.pending ? (
        <div className="notice">
          Elixir is fetching {r.player_tag} from the game · asking again in{" "}
          {r.pending.retry_after_s} s
        </div>
      ) : null}
      {p ? (
        <div className="panel">
          <div className="panel__head">
            {p.name ?? r.player_tag} <span className="tag">{r.player_tag}</span>
            {p.clan ? (
              <span className="page-head__note">
                in {p.clan.name} as {p.clan.role}
              </span>
            ) : (
              <span className="page-head__note">no clan</span>
            )}
          </div>
          <div className="panel__body fields" style={{ rowGap: "8px" }}>
            <span className="label">Trophies</span>
            <span>
              {p.trophies?.toLocaleString() ?? "—"} (best{" "}
              {p.best_trophies?.toLocaleString() ?? "—"})
            </span>
            <span className="label">Path of Legends</span>
            <span>
              {p.path_of_legend?.current
                ? `league ${p.path_of_legend.current.leagueNumber}, ${p.path_of_legend.current.trophies ?? 0} · best league ${p.path_of_legend.best?.leagueNumber ?? "—"}`
                : "—"}
            </span>
            <span className="label">War day wins</span>
            <span>{p.clan_war_wins ?? "—"}</span>
            <span className="label">Lifetime donations</span>
            <span>
              {p.clan_donations?.toLocaleString() ?? "—"} · this week{" "}
              {p.donations_this_week ?? "—"}
            </span>
            <span className="label">Battles</span>
            <span>
              {p.battle_count?.toLocaleString() ?? "—"} ({p.wins ?? "—"} W /{" "}
              {p.losses ?? "—"} L)
            </span>
            <span className="label">Years played</span>
            <span>{p.years_played ?? "—"}</span>
            <span className="label">Last seen</span>
            <span>{p.last_seen_in_game ?? "—"}</span>
            <span className="label">As of</span>
            <span>
              {p.as_of}
              {p.freshness_seconds != null
                ? ` (${p.freshness_seconds} s old)`
                : ""}
            </span>
          </div>
        </div>
      ) : null}
      {r && !r.pending ? (
        <div className="panel">
          <div className="panel__head">Policy answer, today</div>
          <div className="panel__body" style={{ display: "grid", gap: "8px" }}>
            <div>
              <span
                className={`chip ${a.floor.passes ? "chip--ok" : "chip--warn"}`}
              >
                {a.floor.passes
                  ? "clears the competitive floor"
                  : "does not clear the floor"}
              </span>{" "}
              <span className="page-head__note">
                {a.floor.war.days} war days (needs {a.floor.war.needed}) or{" "}
                {a.floor.ranked.battles} ranked battles (needs{" "}
                {a.floor.ranked.needed}) in the last {a.floor.window_weeks}{" "}
                weeks
                {a.floor.bounded_by_log
                  ? "; the log covers less than the window, so this is a lower bound"
                  : ""}
              </span>
            </div>
            {a.inactivity ? (
              <div>
                <span
                  className={`chip ${a.inactivity.state === "active" ? "chip--ok" : a.inactivity.state === "watch" ? "chip--info" : "chip--warn"}`}
                >
                  {a.inactivity.state.replaceAll("_", " ")}
                </span>{" "}
                <span className="page-head__note">
                  {a.inactivity.days_idle} days since the last recorded battle
                </span>
              </div>
            ) : (
              <div className="page-head__note">No battle in the log yet.</div>
            )}
            <div className="page-head__note">
              Last {r.log.battles} battles: {r.log.wins} W / {r.log.losses} L
              {r.log.win_rate != null
                ? ` (${Math.round(r.log.win_rate * 100)}%)`
                : ""}
              {r.log.oldest ? ` since ${r.log.oldest.slice(0, 10)}` : ""}
            </div>
            <div className="page-head__note">{a.tenure_note}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
