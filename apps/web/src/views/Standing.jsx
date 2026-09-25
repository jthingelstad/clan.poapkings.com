import { Fresh } from "elixir-mcp/packages/ui/src/index.ts";
import { useStanding } from "../lib/queries.js";
import { TooFew } from "../components/TooFew.jsx";

const STATUS = {
  holding: ["Holding Elder", "chip--ok"],
  slipping: ["Slipping", "chip--warn"],
  rising: ["Rising", "chip--info"],
  participating: ["Participating", ""],
  quiet: ["Quiet", ""],
};

/** Standing, for everyone in a clan with a policy: how the clan runs, in
 *  a member's words and straight from its policy; your own line; and, when
 *  Elder is ranked and the policy shares it, who holds Elder, who is rising
 *  and who is slipping, each with their own evidence in a player's terms.
 *  Never a score, a rank, or the slot count. */
export function Standing({ clan, who }) {
  const standing = useStanding(clan.clan_tag);
  const env = standing.data;
  const state = !env
    ? standing.isError
      ? { error: true }
      : { loading: true }
    : env.status === 409 && env.data?.error === "too_few_members"
      ? { tooFew: env.data }
      : env.status === 409
        ? { noPolicy: true }
        : !env.ok
          ? { error: true }
          : { data: env.data };
  const head = (
    <div className="page-head" style={{ alignItems: "center" }}>
      <h1 className="page__title">Standing</h1>
      <span className="page-head__note">{clan.name ?? clan.clan_tag}</span>
      {state.data?.as_of ? (
        <Fresh
          label="as of"
          seconds={state.data.freshness_seconds}
          ts={state.data.as_of}
        />
      ) : null}
    </div>
  );
  if (state.loading)
    return (
      <>
        {head}
        <p className="page__lede">Reading the record…</p>
      </>
    );
  if (state.tooFew)
    return (
      <>
        {head}
        <TooFew members={state.tooFew.members} min={state.tooFew.min_members} />
      </>
    );
  if (state.noPolicy)
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
  const d = state.data;
  const groups = ["holding", "slipping", "rising", "participating", "quiet"]
    .map((s) => [s, (d.rows ?? []).filter((r) => r.status === s)])
    .filter(([, rows]) => rows.length);
  return (
    <>
      {head}
      <section className="panel mb-[18px]">
        <div className="panel__head">How it works here</div>
        <div className="panel__body grid gap-3">
          {d.how.map((section) => (
            <div key={section.key}>
              <div className="label mb-1">{section.title}</div>
              {section.lines.map((line) => (
                <p key={line} className="mt-0 mb-1">
                  {line}
                </p>
              ))}
            </div>
          ))}
        </div>
      </section>
      {d.you ? (
        <div className="panel" style={{ marginBottom: "18px" }}>
          <div className="panel__head">
            <span className="yours">★</span> You
            {d.you.status ? (
              <span className={`chip ${STATUS[d.you.status]?.[1] ?? ""}`}>
                {STATUS[d.you.status]?.[0]}
              </span>
            ) : null}
          </div>
          <div className="panel__body" style={{ display: "grid", gap: "6px" }}>
            <div>{d.you.evidence || "Nothing recorded yet."}</div>
            {d.you.next.map((n) => (
              <div key={n} className="page-head__note">
                → {n}
              </div>
            ))}
            {d.you.inactivity ? (
              <div className="callout callout--warn">
                <span>
                  You have not played in {Math.floor(d.you.days_idle)} days.
                </span>
              </div>
            ) : null}
            {d.you.hold ? (
              <div className="notice">
                A leader has you on hold
                {d.you.hold.until
                  ? ` until ${d.you.hold.until.slice(0, 10)}`
                  : ""}
                .
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {groups.map(([status, rows]) => (
        <section key={status} style={{ marginBottom: "18px" }}>
          <div className="label" style={{ marginBottom: "8px" }}>
            {STATUS[status][0]} · {rows.length}
          </div>
          <div className="table__scroll">
            <table className="table">
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.player_tag}
                    data-you={
                      r.player_tag === who?.player_tag ? "true" : undefined
                    }
                  >
                    <td>
                      {r.player_tag === who?.player_tag ? (
                        <span className="yours">★ </span>
                      ) : null}
                      {r.name} <span className="tag">{r.player_tag}</span>
                    </td>
                    <td style={{ whiteSpace: "normal" }}>
                      {r.evidence || (
                        <span className="nil">nothing recorded</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {groups.length ? (
        <p className="page-head__note">
          Standing is participation in what this clan counts, compared across
          its members and Elders over the windows above.
        </p>
      ) : null}
    </>
  );
}
