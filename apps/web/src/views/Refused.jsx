import { ELIXIR_LINKS } from "../lib/links.js";

/**
 * One page per gate refusal, in gate order. Each says exactly what to do
 * and links to where, then offers to check again; nothing here guesses.
 */
export const REFUSALS = {
  not_a_person: {
    title: "That was an agent's connection, not yours",
    body: "Elixir Clan signs people in. The consent you gave was for an agent or integration door, and an agent has no player to be here as.",
    action: "Sign in again and consent as yourself, on the personal door.",
    link: [ELIXIR_LINKS.connectionsDocs, "Users, agents and integrations"],
    retry: "/auth/login",
  },
  no_primary_player: {
    title: "Add your player in Elixir",
    body: "Your Elixir account has no primary player yet, so there is nobody to show a clan for.",
    action:
      "Add the player you play as under Elixir → Tracking, then come back.",
    link: [ELIXIR_LINKS.tracking, "Elixir → Tracking"],
  },
  unverified: {
    title: "Prove your player in Elixir",
    body: "Your players are added but none is verified. Elixir Clan shows you your clan as who you are in the game, so a claim has to be a fact, not a promise.",
    action:
      "Open Elixir → Verify: Elixir names eight cards, you play one battle with them, and the claim is verified. It usually takes under a minute.",
    link: [ELIXIR_LINKS.verify, "Elixir → Verify"],
  },
  no_clan: {
    title: "You are not in a clan",
    body: "None of your verified players is in a clan right now, as far as Elixir's record goes. There is no clan page to show.",
    action:
      "Join a clan in the game. Elixir sees it on its next roster poll; check again after that.",
    link: [ELIXIR_LINKS.overview, "Your Elixir account"],
  },
};

export function Refused({ reason, me, onRecheck, checking }) {
  const page = REFUSALS[reason];
  if (!page) {
    return (
      <div className="empty" style={{ margin: "40px auto 0" }}>
        <div className="empty__title">Nothing to refuse</div>
        <p className="empty__body">There is no such gate page.</p>
        <a className="btn" href="/">
          Home
        </a>
      </div>
    );
  }
  const who = me?.primary?.name ?? me?.principal?.subject?.name;
  const players = me?.identities ?? [];
  return (
    <div style={{ maxWidth: "560px", margin: "40px auto 0" }}>
      <p className="eyebrow">NOT YET</p>
      <h1 className="page__title" style={{ marginBottom: "12px" }}>
        {page.title}
      </h1>
      {who ? (
        <p className="page-head__note" style={{ marginBottom: "12px" }}>
          Signed in to Elixir as <span className="yours">★</span> {who}
        </p>
      ) : null}
      <p className="lede">{page.body}</p>
      {players.length > 0 && reason !== "not_a_person" ? (
        <ul
          style={{
            margin: "12px 0 0",
            paddingLeft: "18px",
            color: "var(--ink-dim)",
            fontSize: "14px",
          }}
        >
          {players.map((p) => (
            <li key={p.player_tag}>
              {p.name ?? p.player_tag}{" "}
              <span className="tag">{p.player_tag}</span>{" "}
              {p.claim_status === "verified"
                ? "verified"
                : (p.claim_status ?? "unverified")}
              {p.clan_tag
                ? ` · in ${p.clan_name ?? p.clan_tag}`
                : " · not in a clan"}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="callout callout--info" style={{ margin: "18px 0" }}>
        <span>{page.action}</span>
      </div>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <a className="btn btn--primary" href={page.link[0]}>
          {page.link[1]} ›
        </a>
        {page.retry ? (
          <a className="btn" href={page.retry}>
            Sign in again
          </a>
        ) : (
          <button
            type="button"
            className="btn"
            onClick={onRecheck}
            disabled={checking}
          >
            {checking ? "Checking…" : "I did that, check again"}
          </button>
        )}
      </div>
    </div>
  );
}
