import { useState } from "react";
import { manageApi } from "../api.js";
import { keys, useInvalidate, useSocial } from "../lib/queries.js";
import { trackEvent } from "../analytics.js";

/**
 * The clan's Social switch (Jamie, 2026-09-26): every clan has the social
 * features, and its leaders can turn them off. Off hides the clan map from
 * everyone here; members' own places are theirs and stay, shown in their
 * other clans. Recruit is not affected.
 */
export function SocialSetting({ clan }) {
  const { state } = useSocial(clan.clan_tag);
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState(false);
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
    <div className="grid gap-2">
      <p className="page__lede m-0">
        The clan map: members add a city or region and see where the clan plays
        from, with each one&rsquo;s local time. Only this clan&rsquo;s signed-in
        members see it, and nothing of it goes to Elixir.{" "}
        {d.enabled ? "It is on." : "It is off."}
        {d.set_by_name ? ` Last set by ${d.set_by_name}.` : ""}
      </p>
      <button
        type="button"
        className="btn w-fit"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await manageApi.setSocial(clan.clan_tag, !d.enabled);
          setBusy(false);
          if (r.ok)
            trackEvent("clan.social_set", r.data.enabled ? "on" : "off");
          invalidate(keys.social(clan.clan_tag));
          invalidate(keys.map(clan.clan_tag));
          invalidate(keys.me);
        }}
      >
        {d.enabled ? "Turn social features off" : "Turn social features on"}
      </button>
    </div>
  );
}
