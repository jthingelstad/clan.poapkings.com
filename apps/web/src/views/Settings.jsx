import { Model } from "./Model.jsx";
import { Sharing } from "./Sharing.jsx";

/**
 * Clan settings (Jamie, 2026-09-25): one page for the leader and
 * co-leaders with what belongs to the whole clan rather than to how it
 * runs. How the clan runs is its Policy; its awards and its recruiting
 * words keep their own pages. Here: what the clan records in Elixir
 * (door 3, read-only: always on) and the clan's own model; the mail it
 * sends through Elixir belongs here too, when that door opens.
 */
export function Settings({ clan }) {
  return (
    <div className="grid max-w-[720px] gap-6">
      <p className="page__lede m-0">
        What belongs to the whole clan, for its leader and co-leaders. How the
        clan runs is its Policy; its awards and recruiting words have their own
        pages.
      </p>
      <section className="grid gap-3" aria-labelledby="settings-sharing">
        <h2 id="settings-sharing" className="label m-0">
          What Elixir Clan records in Elixir
        </h2>
        <Sharing clan={clan} />
      </section>
      <section className="grid gap-3" aria-labelledby="settings-model">
        <h2 id="settings-model" className="label m-0">
          The clan&rsquo;s own model
        </h2>
        <Model clan={clan} />
      </section>
    </div>
  );
}
