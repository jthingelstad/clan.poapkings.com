import { useSharing } from "../lib/queries.js";

/**
 * What Elixir Clan records in Elixir (door 3, 2026-09-25): what the clan
 * did goes back to Elixir as facts, each said by the person who did it.
 * Always, with nothing to switch (Jamie, 2026-09-25): every kind is
 * something the clan already sees in the game or here, and Elixir shows
 * each only to the readers its kind allows; the family's other apps (the
 * Discord narrator) read them there. This section says what and to whom.
 */
export function Sharing({ clan }) {
  const { state } = useSharing(clan.clan_tag);
  const d = state.data;
  if (state.forbidden || state.signedOut) return null;
  if (state.error)
    return (
      <p className="page-head__note m-0">
        Elixir Clan did not answer. Try again in a minute.
      </p>
    );
  if (!d) return <p className="page__lede">Reading…</p>;
  return (
    <div className="grid gap-3">
      <p className="page__lede m-0">
        What your clan does here is recorded in Elixir, said by the person who
        did it, so the family&rsquo;s other apps (the Discord narrator among
        them) know what the clan knows. Elixir keeps it apart from the game
        record and shows each kind only to the people below.
      </p>
      <div className="grid gap-3">
        {Object.entries(d.types).map(([key, t]) => (
          <div key={key} className="grid gap-1">
            <span className="font-semibold">{t.label}</span>
            <span className="page-head__note">
              {t.why} Seen in Elixir by: {t.sees}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
