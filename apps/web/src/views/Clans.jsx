import { useState } from "react";
import { RoleChip } from "../components/RoleChip.jsx";
import { ELIXIR_LINKS } from "../lib/links.js";

/**
 * The chooser: one card per clan the person holds a VERIFIED tag in,
 * with the tag and role they act as there. Unverified alts are listed
 * greyed with a Verify link, so the page also says why a clan is missing.
 */
export function Clans({ me, onSelect, selecting }) {
  const [picking, setPicking] = useState(null);
  const unverified = (me.identities ?? []).filter(
    (i) =>
      i.claim_status !== "verified" &&
      (i.relationship === "primary" || i.relationship === "alt"),
  );
  return (
    <div style={{ maxWidth: "640px" }}>
      <div className="page-head">
        <h1 className="page__title">Your clans</h1>
        <span className="page-head__note">
          Every clan you hold a verified player in. Pick one to work in; it is
          remembered.
        </span>
      </div>
      <div style={{ display: "grid", gap: "12px" }}>
        {me.clans.map((c) => {
          const current = me.selected?.clan_tag === c.clan_tag;
          return (
            <button
              type="button"
              key={c.clan_tag}
              className="panel"
              data-clan={c.clan_tag}
              aria-current={current ? "true" : undefined}
              disabled={selecting}
              onClick={() => {
                setPicking(c.clan_tag);
                onSelect(c.clan_tag);
              }}
              style={{
                textAlign: "left",
                cursor: "pointer",
                font: "inherit",
                color: "inherit",
                boxShadow: current ? "var(--mark-current)" : undefined,
              }}
            >
              <div
                className="panel__body"
                style={{ display: "grid", gap: "6px" }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: "10px",
                    flexWrap: "wrap",
                  }}
                >
                  <span className="page-title">{c.name ?? c.clan_tag}</span>
                  <span className="tag">{c.clan_tag}</span>
                  {current ? (
                    <span className="chip chip--info">current</span>
                  ) : null}
                  {picking === c.clan_tag && selecting ? (
                    <span className="page-head__note">opening…</span>
                  ) : null}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    flexWrap: "wrap",
                  }}
                >
                  <span className="yours">★</span>
                  <span>{c.acting_as_name ?? c.acting_as}</span>
                  <span className="tag">{c.acting_as}</span>
                  <RoleChip role={c.role} label={c.role_label} />
                  {c.your_tags.length > 1 ? (
                    <span className="page-head__note">
                      and {c.your_tags.length - 1} more of your players here
                    </span>
                  ) : null}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {unverified.length > 0 ? (
        <div className="panel" style={{ marginTop: "20px", opacity: 0.85 }}>
          <div className="panel__head">Not yet: unverified players</div>
          <div className="panel__body" style={{ display: "grid", gap: "8px" }}>
            {unverified.map((i) => (
              <div
                key={i.player_tag}
                style={{
                  display: "flex",
                  gap: "8px",
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <span>{i.name ?? i.player_tag}</span>
                <span className="tag">{i.player_tag}</span>
                {i.clan_tag ? (
                  <span className="page-head__note">
                    in {i.clan_name ?? i.clan_tag}
                  </span>
                ) : null}
                <a
                  className="btn btn--sm"
                  href={ELIXIR_LINKS.verify}
                  style={{ marginLeft: "auto" }}
                >
                  Verify in Elixir ›
                </a>
              </div>
            ))}
          </div>
          <div className="panel__foot">
            A clan only appears here for a player you have proven. Verify is one
            battle with a deck Elixir names.
          </div>
        </div>
      ) : null}
    </div>
  );
}
