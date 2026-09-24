import { ago } from "elixir-mcp/packages/ui/src/index.ts";
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
          <Row label="Players">
            {(me.identities ?? []).length === 0 ? (
              "none yet"
            ) : (
              <span style={{ display: "grid", gap: "4px" }}>
                {me.identities.map((i) => (
                  <span key={i.player_tag}>
                    {i.is_primary ? <span className="yours">★ </span> : null}
                    {i.name ?? i.player_tag}{" "}
                    <span className="tag">{i.player_tag}</span>{" "}
                    {/* A friend or a watched player is followed, never
                        claimed: "unverified" read as a problem to fix. */}
                    {i.relationship === "friend" ||
                    i.relationship === "watching" ? (
                      <span className="chip">{i.relationship}</span>
                    ) : i.claim_status === "verified" ? (
                      <span className="chip chip--ok">verified</span>
                    ) : (
                      <span className="chip chip--warn">
                        {i.claim_status ?? "unverified"}
                      </span>
                    )}
                    {i.clan_tag ? (
                      <span className="page-head__note">
                        {" "}
                        · {i.clan_name ?? i.clan_tag}
                      </span>
                    ) : null}
                  </span>
                ))}
              </span>
            )}
          </Row>
          <Row label="Working in">
            {me.selected ? (
              <>
                {me.selected.name ?? ""}{" "}
                <span className="tag">{me.selected.clan_tag}</span> as{" "}
                {me.selected.player_name ?? me.selected.player_tag}{" "}
                <RoleChip
                  role={me.selected.role}
                  label={me.selected.role_label}
                />
              </>
            ) : (me.clans ?? []).length > 0 ? (
              <a href="/clans">choose a clan</a>
            ) : (
              "no verified clan yet"
            )}
          </Row>
          <Row label="Elixir account">
            {me.principal?.subject?.name ?? "person"} on the personal door ·{" "}
            <a href={ELIXIR_LINKS.overview}>open Elixir</a>
          </Row>
          <Row label="Capabilities">
            <code>{me.scope || "cr:read"}</code>
          </Row>
          <Row label="Checked">
            {me.checked_at ? (
              <span title={me.checked_at}>{ago(me.checked_at)}</span>
            ) : (
              "—"
            )}
          </Row>
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
