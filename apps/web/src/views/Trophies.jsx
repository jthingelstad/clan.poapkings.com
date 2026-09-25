import { useTrophies } from "../lib/queries.js";

const place = (rank) =>
  rank === 1 ? "1st" : rank === 2 ? "2nd" : rank === 3 ? "3rd" : `${rank}th`;

/**
 * The trophy case, for every member of a clan with a policy: the awards
 * the clan runs, who has won them season by season, and your own. Leaders
 * set the awards up in Manage ▸ Awards; nothing here is published outside
 * the app.
 */
export function Trophies({ clan, who }) {
  const { state } = useTrophies(clan.clan_tag);
  const head = (
    <div className="page-head items-center">
      <h1 className="page__title">Trophies</h1>
      <span className="page-head__note">{clan.name ?? clan.clan_tag}</span>
    </div>
  );
  if (state.error === "no_policy")
    return (
      <>
        {head}
        <div className="empty">
          <div className="empty__title">No policy yet</div>
          <p className="empty__body">
            This clan&rsquo;s leaders have not set up how the clan runs here.
          </p>
        </div>
      </>
    );
  if (state.error)
    return (
      <>
        {head}
        <div className="callout callout--warn" role="alert">
          <span>Elixir did not answer. Try again in a minute.</span>
        </div>
      </>
    );
  if (!state.data)
    return (
      <>
        {head}
        <p className="page__lede">Reading the trophy case…</p>
      </>
    );
  const d = state.data;
  const names = new Map(d.awards.map((a) => [a.id, a.name]));
  if (!d.awards.length && !d.seasons.length)
    return (
      <>
        {head}
        <div className="empty">
          <div className="empty__title">No awards yet</div>
          <p className="empty__body">
            This clan does not run any awards here yet.
          </p>
        </div>
      </>
    );
  return (
    <>
      {head}
      {d.yours.length ? (
        <section className="panel mb-[18px]">
          <div className="panel__head">
            <span className="yours">★</span> Yours
          </div>
          <ul className="panel__body m-0 grid gap-1 pl-[34px]">
            {d.yours.map((g) => (
              <li key={`${g.season_id}-${g.award_id}`}>
                {g.name}
                {g.rank > 1 || !g.manual ? ` · ${place(g.rank)}` : ""} · season{" "}
                {g.season_id}
                {g.note ? ` · ${g.note}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {d.awards.length ? (
        <section className="mb-[18px]">
          <div className="label mb-2">What this clan awards</div>
          <div className="grid gap-2">
            {d.awards.map((a) => (
              <div key={a.id} className="panel">
                <div className="panel__head">{a.name}</div>
                <div className="panel__body grid gap-1">
                  {a.description ? <div>{a.description}</div> : null}
                  <div className="page-head__note">{a.rule}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {d.seasons.map((s) => (
        <section key={s.season_id} className="mb-[18px]">
          <div className="label mb-2">Season {s.season_id}</div>
          <div className="table__scroll">
            <table className="table">
              <tbody>
                {s.grants.map((g) => (
                  <tr
                    key={`${g.award_id}-${g.player_tag}`}
                    data-you={
                      g.player_tag === who?.player_tag ? "true" : undefined
                    }
                  >
                    <td>{names.get(g.award_id) ?? g.name}</td>
                    <td>{g.manual ? "" : place(g.rank)}</td>
                    <td>
                      {g.player_tag === who?.player_tag ? (
                        <span className="yours">★ </span>
                      ) : null}
                      {g.player_name ?? g.player_tag}{" "}
                      <span className="tag">{g.player_tag}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
