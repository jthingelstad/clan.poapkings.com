import { useEffect, useState } from "react";
import { manageApi } from "../api.js";
import { useSharing } from "../lib/queries.js";
import { trackEvent } from "../analytics.js";

/**
 * Share with Elixir (door 3, 2026-09-25): what the clan did goes back to
 * Elixir as facts, each said by the person who did it, one switch per
 * kind, all off until a leader turns one on. Elixir keeps them apart from
 * the game record and shows each only to the readers its kind allows;
 * the families' other apps (the Discord narrator) read them there.
 */
export function Sharing({ clan }) {
  const { state, load } = useSharing(clan.clan_tag);
  const [values, setValues] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const d = state.data;
  useEffect(() => {
    if (d) setValues(d.values);
  }, [d]);
  if (state.forbidden || state.signedOut) return null;
  if (state.error)
    return (
      <p className="page-head__note m-0">
        Elixir Clan did not answer. Try again in a minute.
      </p>
    );
  if (!d || !values) return <p className="page__lede">Reading…</p>;
  const changed = Object.keys(values).some((k) => values[k] !== d.values[k]);
  const save = async () => {
    setBusy(true);
    setMessage("");
    const r = await manageApi.saveSharing(clan.clan_tag, values);
    setBusy(false);
    if (!r.ok) return setMessage("That did not save.");
    trackEvent(
      "clan.sharing_saved",
      Object.keys(values)
        .filter((k) => values[k])
        .join(",") || "none",
    );
    setMessage("Saved.");
    load();
  };
  return (
    <div className="grid gap-3">
      <p className="page__lede m-0">
        What your clan does can go back to Elixir, said by the person who did
        it, so the family&rsquo;s other apps (the Discord narrator among them)
        know what the clan knows. Elixir keeps it apart from the game record and
        shows it only to the people each kind allows. Nothing is shared until
        you turn a kind on.
      </p>
      <div className="grid gap-3">
        {Object.entries(d.types).map(([key, t]) => (
          <div key={key} className="grid gap-1">
            <label className="flex items-center gap-2 font-semibold">
              <input
                type="checkbox"
                className="size-4 shrink-0"
                checked={values[key] === true}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [key]: e.target.checked }))
                }
              />
              <span>{t.label}</span>
            </label>
            <span className="page-head__note">
              {t.why} Seen in Elixir by: {t.sees}
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || !changed}
          onClick={save}
        >
          {busy ? "Saving…" : "Save what the clan shares"}
        </button>
        {d.saved_at ? (
          <span className="page-head__note">
            Last set {d.saved_at.slice(0, 10)}
            {d.saved_by_name ? ` by ${d.saved_by_name}` : ""}.
          </span>
        ) : null}
      </div>
      {message ? <div className="notice">{message}</div> : null}
    </div>
  );
}
