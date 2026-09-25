import { Model } from "./Model.jsx";

/**
 * Clan settings (Jamie, 2026-09-25): one page for the leader and
 * co-leaders with what belongs to the whole clan rather than to how it
 * runs. How the clan runs is its Policy; its awards and its recruiting
 * words keep their own pages. First here: the clan's own model. What
 * comes through Elixir's doors next (what the clan shares with Elixir,
 * the mail it sends) belongs here too.
 */
export function Settings({ clan }) {
  return (
    <div className="grid max-w-[720px] gap-6">
      <p className="page__lede m-0">
        What belongs to the whole clan, for its leader and co-leaders. How the
        clan runs is its Policy; its awards and recruiting words have their own
        pages.
      </p>
      <section className="grid gap-3" aria-labelledby="settings-model">
        <h2 id="settings-model" className="label m-0">
          The clan&rsquo;s own model
        </h2>
        <Model clan={clan} />
      </section>
    </div>
  );
}
