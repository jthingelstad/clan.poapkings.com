import { Fresh } from "elixir-mcp/packages/ui/src/index.ts";
import { keys, useActions, useInvalidate } from "../lib/queries.js";
import { ActionCard } from "../components/ActionCard.jsx";
import { TooFew } from "../components/TooFew.jsx";

const ORDER = [
  "departure",
  "removal",
  "promotion",
  "demotion",
  "welcome",
  "away",
];

/**
 * Actions, for everyone in a clan with a policy: what is waiting for you
 * (assigned to you, or open to your role), and what closed in the last 30
 * days, each with its log. Opening the page evaluates the clan, so
 * actions are raised by whoever looks first.
 */
export function Actions({ clan, who, navigate }) {
  const { state, load, query } = useActions(clan.clan_tag);
  const invalidate = useInvalidate();
  const changed = () => {
    load(true);
    invalidate(keys.me);
  };
  if (state.signedOut) {
    window.location.assign("/?error=session_expired");
    return null;
  }
  const d = state.data;
  const head = (
    <div className="page-head items-center">
      <h1 className="page__title">Actions</h1>
      <span className="page-head__note">{clan.name ?? clan.clan_tag}</span>
      {d?.as_of ? (
        <Fresh label="as of" seconds={d.freshness_seconds} ts={d.as_of} />
      ) : null}
    </div>
  );
  if (state.error === "too_few_members") {
    const e = query.data?.data ?? {};
    return (
      <>
        {head}
        <TooFew members={e.members} min={e.min_members} />
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
            Actions start when this clan&rsquo;s leaders set up how the clan
            runs here.
          </p>
        </div>
      </>
    );
  if (state.error)
    return (
      <>
        {head}
        <div className="callout callout--warn" role="alert">
          <span>
            {state.error === "clan_not_recorded"
              ? "Elixir is not recording this clan yet."
              : "Elixir did not answer. Try again in a minute."}
          </span>
        </div>
      </>
    );
  if (!d)
    return (
      <>
        {head}
        <p className="page__lede">Reading the record…</p>
      </>
    );
  const groups = ORDER.map((t) => [
    t,
    d.open.filter((a) => a.type === t),
  ]).filter(([, list]) => list.length);
  const card = (a) => (
    <ActionCard
      key={a.card_id}
      action={a}
      clan={clan}
      who={who}
      reasons={d.decline_reasons}
      onChanged={changed}
      navigate={navigate}
    />
  );
  return (
    <>
      {head}
      {groups.length === 0 ? (
        <div className="empty mb-6">
          <div className="empty__title">Nothing waiting for you</div>
          <p className="empty__body">
            An action appears here when the clan&rsquo;s policy suggests
            something you can do: for you alone, or for anyone in your role.
          </p>
        </div>
      ) : (
        groups.map(([type, list]) => (
          <section key={type} className="mb-6">
            <div className="label mb-2">
              {list[0].label} · {list.length}
            </div>
            <div className="grid gap-3">{list.map(card)}</div>
          </section>
        ))
      )}
      {d.recent.length ? (
        <section className="mb-6">
          <div className="label mb-2">Closed in the last 30 days</div>
          <div className="grid gap-3">{d.recent.map(card)}</div>
        </section>
      ) : null}
    </>
  );
}
