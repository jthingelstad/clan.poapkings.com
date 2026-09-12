import { RoleChip } from "../components/RoleChip.jsx";
import { ELIXIR_LINKS } from "../lib/links.js";

function Row({ label, children }) {
  return (
    <>
      <span className="label">{label}</span>
      <span>{children}</span>
    </>
  );
}

/** The minimal "you": what the gate knows, and where it came from. */
export function You({ me }) {
  return (
    <div style={{ maxWidth: "640px" }}>
      <div className="page-head">
        <h1 className="page__title">You</h1>
        <span className="page-head__note">
          Read from Elixir at sign-in. Elixir Clan holds no profile of its own.
        </span>
      </div>
      <div className="panel">
        <div className="panel__body fields" style={{ rowGap: "10px" }}>
          <Row label="Player">
            {me.player ? (
              <>
                {me.player.name}{" "}
                <span className="tag">{me.player.player_tag}</span>
              </>
            ) : (
              "none yet"
            )}
          </Row>
          <Row label="Clan">
            {me.clan ? (
              <>
                {me.clan.name ?? ""}{" "}
                <span className="tag">{me.clan.clan_tag}</span>
              </>
            ) : (
              "not in a clan"
            )}
          </Row>
          <Row label="Role">
            {me.player?.role ? (
              <RoleChip role={me.player.role} label={me.player.role_label} />
            ) : (
              "—"
            )}
          </Row>
          <Row label="Elixir account">
            {me.principal?.subject?.name ?? "person"} on the personal door ·{" "}
            <a href={ELIXIR_LINKS.overview}>open Elixir</a>
          </Row>
          <Row label="Capabilities">
            <code>{me.scope || "cr:read"}</code>
          </Row>
          <Row label="Checked">{me.checked_at ?? "—"}</Row>
        </div>
        <div className="panel__foot">
          Change any of this in Elixir:{" "}
          <a href={ELIXIR_LINKS.tracking}>Tracking</a>,{" "}
          <a href={ELIXIR_LINKS.verify}>Verify</a>,{" "}
          <a href={ELIXIR_LINKS.connections}>Connections</a> (where this sign-in
          can be revoked).
        </div>
      </div>
    </div>
  );
}
