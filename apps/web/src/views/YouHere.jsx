import { Fresh } from "elixir-mcp/packages/ui/src/index.ts";
import { useMemberView } from "../lib/queries.js";
import { RoleChip } from "../components/RoleChip.jsx";

const STATUS = {
  holding: ["Holding Elder", "chip--ok"],
  slipping: ["Slipping", "chip--warn"],
  rising: ["Rising", "chip--info"],
  participating: ["Participating", ""],
  quiet: ["Quiet", ""],
};
const MINIMUM = {
  war: "war decks",
  ranked: "ranked battles",
  donations: "donations a week",
  trophies: "trophies",
};
const n = (x) => (x === null || x === undefined ? "—" : x.toLocaleString());
const day = (ts) => (ts ? ts.slice(0, 10) : "");

/**
 * "You here": one member's own page in this clan (round 4, 2026-09-25).
 * Your numbers this week and week by week work for any clan; what the
 * clan's policy makes of them (what it counts, your minimums, what would
 * move you, your clock) shows once the policy is active. Only you.
 */
export function YouHere({ clan, navigate }) {
  const { state } = useMemberView(clan.clan_tag);
  const d = state.data;
  const head = (
    <div className="page-head items-center">
      <h1 className="page__title">You here</h1>
      {d ? (
        <>
          <span className="page-head__note">
            {d.you.name ?? d.you.player_tag} ·{" "}
            {d.clan_name ?? clan.name ?? clan.clan_tag}
          </span>
          <RoleChip role={d.you.role} label={d.you.role} />
          {d.as_of ? (
            <Fresh label="as of" seconds={d.freshness_seconds} ts={d.as_of} />
          ) : null}
        </>
      ) : null}
    </div>
  );
  if (state.signedOut) {
    window.location.assign("/?error=session_expired");
    return null;
  }
  if (state.error)
    return (
      <>
        {head}
        <div className="callout callout--warn" role="alert">
          <span>
            {state.error === "clan_not_recorded"
              ? "Elixir is not recording this clan yet."
              : state.error === "not_on_roster"
                ? "Elixir's record does not show you on this clan's roster yet."
                : "Elixir did not answer. Try again in a minute."}
          </span>
        </div>
      </>
    );
  if (!d)
    return (
      <>
        {head}
        <p className="page__lede">Reading your record…</p>
      </>
    );
  const y = d.you;
  const c = d.clan;
  const counts = new Set(c?.counted ?? []);
  const go = (path) => (e) => {
    e.preventDefault();
    navigate?.(path);
  };
  const base = `/clan/${clan.clan_tag.slice(1)}`;
  return (
    <>
      {head}

      <section className="panel mb-[18px]">
        <div className="panel__head flex-wrap gap-2">
          <span>How you are doing here</span>
          {c?.status ? (
            <span className={`chip ${STATUS[c.status]?.[1] ?? ""}`}>
              {STATUS[c.status]?.[0]}
            </span>
          ) : null}
        </div>
        <div className="panel__body grid gap-2">
          {c ? (
            <>
              <div>
                {c.evidence || "Nothing recorded yet in what the clan counts."}
              </div>
              {c.next.map((line) => (
                <div key={line} className="page-head__note">
                  → {line}
                </div>
              ))}
              {Object.keys(c.minimums.set).length ? (
                <div className="grid gap-1">
                  <div className="label">
                    Minimums (
                    {c.minimums.rule === "all" ? "all of" : "any one of"}, over{" "}
                    {c.minimums.window_weeks} weeks)
                  </div>
                  {Object.entries(c.minimums.set).map(([k, need]) => (
                    <div key={k}>
                      {c.minimums.met[k] === true
                        ? "✓"
                        : c.minimums.met[k] === false
                          ? "✗"
                          : "?"}{" "}
                      {n(need)} {MINIMUM[k]}
                    </div>
                  ))}
                </div>
              ) : null}
              {c.tenure_min_days != null && y.time_here.tenure_known ? (
                <div className="page-head__note">
                  {y.time_here.days >= c.tenure_min_days
                    ? `${y.time_here.days} days in the clan: past the ${c.tenure_min_days} days Elder asks for.`
                    : `${y.time_here.days} of the ${c.tenure_min_days} days in the clan Elder asks for.`}
                </div>
              ) : null}
              {c.inactivity && c.inactivity.state !== "none" ? (
                <div className="callout callout--warn">
                  <span>
                    You have not played in {Math.floor(c.inactivity.days_idle)}{" "}
                    days; this clan counts a member at risk from{" "}
                    {c.inactivity.at_risk_days}.
                  </span>
                </div>
              ) : null}
            </>
          ) : d.policy.set ? (
            <div className="page-head__note">
              Clan management starts at {d.min_members} members; this clan has{" "}
              {d.members}. Your numbers are below.
            </div>
          ) : (
            <div className="page-head__note">
              This clan&rsquo;s leaders have not set up how the clan runs here
              yet. Your numbers are below.
            </div>
          )}
          {d.open_actions ? (
            <div>
              <a href={`${base}/actions`} onClick={go(`${base}/actions`)}>
                {d.open_actions} action{d.open_actions === 1 ? "" : "s"} waiting
                for you
              </a>
            </div>
          ) : null}
          {d.hold ? (
            <div className="notice">
              {d.hold.kind === "away"
                ? "You are marked away"
                : "A leader has you on hold"}
              {d.hold.until ? ` until ${day(d.hold.until)}` : ""}.
            </div>
          ) : null}
        </div>
      </section>

      <section className="mb-[18px]">
        <div className="label mb-2">This week so far</div>
        <div className="panel">
          <div className="panel__body fields">
            {y.this_war_week ? (
              <>
                <span
                  className={`label ${counts.has("war") ? "" : "opacity-70"}`}
                >
                  War decks
                </span>
                <span>
                  {n(y.this_war_week.decks)} this war week (four a war day)
                </span>
              </>
            ) : null}
            <span
              className={`label ${counts.has("ranked") ? "" : "opacity-70"}`}
            >
              Ranked battles
            </span>
            <span>{n(y.this_week?.ranked_battles)}</span>
            <span
              className={`label ${counts.has("donations") ? "" : "opacity-70"}`}
            >
              Donations
            </span>
            <span>{n(y.this_week?.donations)}</span>
            <span className="label">Battles</span>
            <span>{n(y.this_week?.battles)}</span>
            <span
              className={`label ${counts.has("trophies") ? "" : "opacity-70"}`}
            >
              Trophies
            </span>
            <span>{n(y.trophies)}</span>
          </div>
        </div>
      </section>

      <section className="mb-[18px]">
        <div className="label mb-2">Week by week</div>
        <div className="table__scroll mb-3">
          <table className="table">
            <thead>
              <tr>
                <th>Week of</th>
                <th>Battles</th>
                <th>Ranked</th>
                <th>Donations</th>
              </tr>
            </thead>
            <tbody>
              {[...y.weeks].reverse().map((w) => (
                <tr key={w.from}>
                  <td>
                    {day(w.from)}
                    {w.complete ? "" : " (so far)"}
                  </td>
                  <td>{n(w.battles)}</td>
                  <td>{n(w.ranked_battles)}</td>
                  <td>{n(w.donations)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {y.war_weeks.length ? (
          <div className="table__scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>War week</th>
                  <th>Decks played</th>
                  <th>Points</th>
                </tr>
              </thead>
              <tbody>
                {[...y.war_weeks].reverse().map((w) => (
                  <tr key={`${w.season_id}-${w.section_index}`}>
                    <td>
                      Season {w.season_id} · week {w.section_index + 1}
                      {w.is_colosseum ? " (Colosseum)" : ""}
                      {w.open ? " (so far)" : ""}
                    </td>
                    <td>
                      {n(w.decks)}
                      {w.decks_asked != null ? ` of ${w.decks_asked}` : ""}
                    </td>
                    <td>{n(w.points)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {d.trophies.length ? (
        <section className="mb-[18px]">
          <div className="label mb-2">Your trophies here</div>
          <ul className="m-0 pl-[18px]">
            {d.trophies.map((g) => (
              <li key={`${g.season_id}-${g.award_id}`}>
                {g.name}
                {g.manual
                  ? ""
                  : ` · ${g.rank === 1 ? "1st" : g.rank === 2 ? "2nd" : g.rank === 3 ? "3rd" : `${g.rank}th`}`}{" "}
                · season {g.season_id}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mb-[18px]">
        <div className="label mb-2">Your time here</div>
        <div className="grid gap-1">
          <div>
            {y.time_here.tenure_known && y.time_here.joined_observed_at
              ? `Joined ${day(y.time_here.joined_observed_at)}: ${y.time_here.days} days.`
              : `Here since before the record began (${day(y.time_here.recording_since)}): at least ${y.time_here.days ?? "?"} days.`}
          </div>
          {y.time_here.events
            .filter((e) => e.type === "role_changed")
            .map((e) => (
              <div key={e.at} className="page-head__note">
                {day(e.at)}: {e.role_before ?? "?"} → {e.role_after ?? "?"}
              </div>
            ))}
        </div>
      </section>
    </>
  );
}
