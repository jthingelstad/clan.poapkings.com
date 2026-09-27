import { useState } from "react";
import { RoleChip } from "../components/RoleChip.jsx";
import { ELIXIR_LINKS } from "../lib/links.js";

/**
 * The notice after sign-in (Jamie, 2026-09-26): anyone with an Elixir
 * account and a player in a clan is a member here, verified or not, but
 * an Elder's, Co-leader's or Leader's tools wait until that player is
 * verified in Elixir. Shown once per sign-in for the list it names, and
 * the person says they have read it before going on.
 */
export function VerifyNotice({ me, onAcknowledge }) {
  const [busy, setBusy] = useState(false);
  const clans = me?.verify_notice?.clans ?? [];
  const many = clans.length > 1;
  return (
    <div className="mx-auto mt-10 max-w-[560px]">
      <p className="eyebrow">BEFORE YOU GO ON</p>
      <h1 className="page__title mb-3">Verify your player to lead here</h1>
      <p className="lede">
        You are in as a member. In the game you hold a bigger role, and Elixir
        Clan gives an Elder&rsquo;s, Co-leader&rsquo;s or Leader&rsquo;s tools
        only to a player verified in Elixir: anyone can add a player to their
        account, and verifying proves it is yours.
      </p>
      <ul className="mt-3 mb-0 grid gap-1.5 pl-[18px]">
        {clans.map((c) => (
          <li key={`${c.clan_tag}-${c.player_tag}`}>
            {c.player_name ?? c.player_tag}{" "}
            <span className="tag">{c.player_tag}</span>{" "}
            <RoleChip role={c.role} label={c.role_label} /> in{" "}
            {c.clan_name ?? c.clan_tag}
          </li>
        ))}
      </ul>
      <div className="callout callout--info my-[18px]">
        <span>
          Until {many ? "they are" : "it is"} verified you read what a member
          reads, and nothing here is done in your player&rsquo;s name: no away
          notice, no comments, no place on the clan map. Open Elixir → Verify:
          Elixir names eight cards, you play one battle with them, and the claim
          is verified. It usually takes under a minute; sign in here again
          afterwards.
        </span>
      </div>
      <div className="flex flex-wrap gap-2.5">
        <a className="btn btn--primary" href={ELIXIR_LINKS.verify}>
          Verify in Elixir ›
        </a>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onAcknowledge();
            setBusy(false);
          }}
        >
          {busy ? "Going on…" : "I understand, continue as a member"}
        </button>
      </div>
    </div>
  );
}
