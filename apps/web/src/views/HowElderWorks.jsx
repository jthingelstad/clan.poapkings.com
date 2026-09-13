import { useHowElderWorks } from "../lib/queries.js";

/** The public page, rendered from the clan's current policy at request
 *  time in the voice of POLICY.md: what a player can act on, never internal
 *  scores. Replaces hand-copied prose on the clan site. */
export function HowElderWorks({ tag }) {
  const { data } = useHowElderWorks(tag);
  if (!data) return <p className="page__lede">Loading…</p>;
  if (data.missing)
    return (
      <div className="empty">
        <div className="empty__title">No such clan here</div>
      </div>
    );
  const v = data.values;
  const pct = (x) => `${Math.round(x * 100)}%`;
  return (
    <div className="wrap--prose" style={{ maxWidth: "72ch" }}>
      <p className="eyebrow">HOW ELDER WORKS HERE</p>
      <h1 className="page__title" style={{ marginBottom: "12px" }}>
        {data.clan_tag}
      </h1>
      <p className="lede">
        Elder is participation, and every input is in the player's control: war
        decks played, ranked battles played, cards donated. Nothing about
        account power counts.
      </p>
      {!v.elder_management_enabled ? (
        <p>This clan does not run Elder on participation.</p>
      ) : (
        <>
          <h2 className="panel-title">Who is considered</h2>
          <p>
            At least {v.tenure_min_days} days in the clan, and the competitive
            floor: at least {v.floor_war_days} war day
            {v.floor_war_days === 1 ? "" : "s"} with a deck played, or at least{" "}
            {v.floor_ranked_battles} ranked battles, in the last{" "}
            {v.floor_window_weeks} weeks. War and ranked count equally. An Elder
            who fails both halves has abandoned the duty.
          </p>
          <h2 className="panel-title">How standing is measured</h2>
          <p>
            Everyone is compared with the others on three things: war decks over
            the last {v.war_rate_window_weeks} war weeks (finishing a day counts
            for more than the deck count suggests), ranked battles over{" "}
            {v.ranked_window_weeks} weeks, and the {v.donation_window_weeks}
            -week donation average. War is the primary path; ranked fills part
            of the gap war leaves; donations are the lighter half.
          </p>
          <h2 className="panel-title">How many Elders</h2>
          <p>
            Between {pct(v.band_floor_share)} and {pct(v.band_ceiling_share)} of
            the roster. The ceiling is hard; the floor is a drift limit, not a
            quota; the target is the middle. Nobody is promoted just to hit a
            number.
          </p>
          <h2 className="panel-title">Promotion</h2>
          <p>
            Sustained, never a snapshot: in the promotable set on{" "}
            {v.promote_qualifying_weeks} weekly reviews. One miss is tolerated;
            two in a row resets the clock. When the seats are full a challenger
            must clearly out-participate the boundary Elder; a close call goes
            to the longer-tenured player.
          </p>
          <h2 className="panel-title">Demotion</h2>
          <p>
            Abandoned the floor: {v.demote_abandoned_weeks} weeks. Outranked
            past the ceiling: {v.demote_outranked_weeks} weeks, so the swap
            lands together. Any week back on the gate resets the clock.
          </p>
        </>
      )}
      {v.removal_enabled ? (
        <>
          <h2 className="panel-title">Removal</h2>
          <p>
            Measured from battles played, never logins. {v.at_risk_days}{" "}
            battle-free days is at risk; {v.at_risk_days + v.confirm_days} days
            proposes a removal. A member who currently clears the competitive
            floor earns up to {v.contribution_grace_max_days} extra days while
            the clan has open slots. A member who told leaders they will be away
            is on hold and the clock pauses; silence is not a hold.
          </p>
        </>
      ) : null}
      <h2 className="panel-title">Talking about it</h2>
      <p>
        The clan is told why, in terms a player can act on. "Outranked" means
        someone participated more than you this week. Internal scores are never
        quoted.
      </p>
      <p className="page-head__note">
        Policy version {data.version === 0 ? "defaults" : data.version}.
      </p>
    </div>
  );
}
