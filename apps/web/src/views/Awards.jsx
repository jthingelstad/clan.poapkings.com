import { Fresh, ago } from "elixir-mcp/packages/ui/src/index.ts";
import { useState } from "react";
import { manageApi } from "../api.js";
import { useAwards } from "../lib/queries.js";
import { trackEvent } from "../analytics.js";

/**
 * Manage ▸ Awards: the open season's races (provisional, tie-aware), each
 * closed season's grants, a leaders' pick granted by hand with the
 * podium in view, and the clan's awards document: every award with its
 * kind, name, parameters and help text, versioned like policy. Elders
 * read all of it and grant what elders may; leaders edit.
 */
export function Awards({ clan }) {
  const [editing, setEditing] = useState(false);
  const { state, load } = useAwards(clan.clan_tag);

  if (state.signedOut) {
    window.location.assign("/?error=session_expired");
    return null;
  }
  if (state.forbidden)
    return (
      <div className="callout callout--warn" role="alert">
        <span>Awards are for the leaders and elders.</span>
      </div>
    );
  if (state.error)
    return (
      <div className="callout callout--warn" role="alert">
        <span>
          {state.error === "clan_not_recorded"
            ? "Elixir is not recording this clan yet, so there is nothing to award."
            : "Elixir did not answer. Try again in a minute."}
        </span>
      </div>
    );
  if (!state.data)
    return <p className="page__lede">Reading the record and the seasons…</p>;
  const d = state.data;
  const open = d.seasons.find((s) => !s.closed) ?? null;
  const closed = d.seasons.filter((s) => s.closed);
  const awardById = new Map(d.config.awards.map((a) => [a.id, a]));

  if (editing)
    return (
      <AwardsConfig
        clan={clan}
        view={d}
        onDone={() => {
          setEditing(false);
          load(true);
        }}
      />
    );

  return (
    <div style={{ display: "grid", gap: "22px" }}>
      <p className="page-head__note" style={{ margin: 0 }}>
        {d.config_version === 0
          ? "No leader has saved a version yet: these are the starting awards."
          : `Awards v${d.config_version}.`}{" "}
        Judged {ago(d.evaluated_at)}
        {d.as_of ? (
          <>
            {" "}
            · <Fresh label="as of" seconds={d.freshness_seconds} ts={d.as_of} />
          </>
        ) : null}
        {" · "}
        <button
          type="button"
          className="btn--text"
          onClick={() => load(true)}
          disabled={state.loading}
        >
          {state.loading ? "reading…" : "re-judge now"}
        </button>
        {d.can_edit ? (
          <>
            {" · "}
            <button
              type="button"
              className="btn--text"
              onClick={() => setEditing(true)}
            >
              edit the awards
            </button>
          </>
        ) : null}
        {d.config.publish ? (
          <>
            {" · "}
            <a href={`/api/clans/${clan.clan_tag.slice(1)}/awards`}>
              published
            </a>
          </>
        ) : (
          " · not published"
        )}
      </p>

      {open ? (
        <section>
          <div className="label" style={{ marginBottom: "8px" }}>
            Season {open.season_id} · in progress · {open.weeks} war week
            {open.weeks === 1 ? "" : "s"} so far
          </div>
          <p className="page__lede" style={{ margin: "0 0 10px" }}>
            Provisional: the season is still being fought. Nothing is granted
            until it closes.
          </p>
          <div style={{ display: "grid", gap: "12px" }}>
            {open.awards.map((a) => (
              <AwardPanel key={a.award_id} award={a} season={open} />
            ))}
          </div>
        </section>
      ) : null}

      {closed.map((s) => (
        <section key={s.season_id}>
          <div className="label" style={{ marginBottom: "8px" }}>
            Season {s.season_id} · closed {s.closed_at?.slice(0, 10)} ·{" "}
            {s.weeks} war weeks
          </div>
          <div style={{ display: "grid", gap: "12px" }}>
            {s.awards.map((a) => (
              <AwardPanel
                key={a.award_id}
                award={a}
                season={s}
                grants={d.grants.filter(
                  (g) =>
                    g.season_id === s.season_id && g.award_id === a.award_id,
                )}
                canGrant={d.can_grant.includes(a.award_id)}
                canRevoke={d.can_edit}
                clan={clan}
                candidates={d.members}
                onChange={() => load()}
              />
            ))}
          </div>
        </section>
      ))}

      <OlderGrants
        grants={d.grants.filter(
          (g) => !d.seasons.some((s) => s.season_id === g.season_id),
        )}
        awardById={awardById}
      />

      <section className="panel">
        <div className="panel__head">How awards work here</div>
        <div className="panel__body" style={{ display: "grid", gap: "8px" }}>
          {d.config.awards.map((a) => (
            <div key={a.id}>
              <strong>{a.name}</strong>
              {a.enabled ? "" : <span className="chip"> off</span>}
              <div className="page-head__note">
                {a.description ? `${a.description} ` : ""}
                <em>{describeFrom(d, a)}</em>
              </div>
            </div>
          ))}
          <p className="page__lede" style={{ margin: "6px 0 0" }}>
            Grants are written the first time the record is read after a season
            closes; a manual award is a leader&rsquo;s and says so. Nothing is
            narrated from here: the public document is what other sites read.
          </p>
        </div>
      </section>
    </div>
  );
}

function describeFrom(d, a) {
  const live = d.seasons
    .flatMap((s) => s.awards)
    .find((x) => x.award_id === a.id);
  return live?.rule ?? "";
}

const UNIT = {
  points: "pts",
  donations: "cards",
  war_decks: "war decks",
  war_days: "war days",
};

function AwardPanel({
  award,
  season,
  grants = [],
  canGrant = false,
  canRevoke = false,
  clan,
  candidates = [],
  onChange,
}) {
  const [granting, setGranting] = useState(false);
  const [tag, setTag] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rows = award.rows ?? [];
  return (
    <div className="panel">
      <div className="panel__head" style={{ gap: "8px", flexWrap: "wrap" }}>
        <span>{award.name}</span>
        <span className="chip">{STATE_LABEL[award.state] ?? award.state}</span>
        {award.kind === "perfect_attendance" && award.state !== "off" ? (
          <span className="page-head__note">pass/fail, not a ranking</span>
        ) : null}
      </div>
      <div className="panel__body" style={{ display: "grid", gap: "8px" }}>
        {award.state === "off" ? null : award.state === "held" ? (
          <p className="page__lede" style={{ margin: 0 }}>
            {award.note}
          </p>
        ) : award.state === "manual" ? (
          <>
            {rows.length === 0 ? (
              <p className="page__lede" style={{ margin: 0 }}>
                Not granted{season.closed ? " yet" : ""}.
              </p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: "18px" }}>
                {rows.map((r) => (
                  <li key={r.player_tag}>
                    <strong>{r.name ?? r.player_tag}</strong>{" "}
                    <span className="tag">{r.player_tag}</span>
                    {r.note ? ` — ${r.note}` : ""}{" "}
                    <span className="page-head__note">
                      · granted {r.granted_at?.slice(0, 10)} by{" "}
                      {r.granted_by_name ?? r.granted_by}
                    </span>
                    {canRevoke ? (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="btn--text"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            await manageApi.revokeAward(
                              clan.clan_tag,
                              season.season_id,
                              award.award_id,
                              r.player_tag,
                            );
                            setBusy(false);
                            onChange?.();
                          }}
                        >
                          take back
                        </button>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {canGrant && season.closed ? (
              granting ? (
                <form
                  style={{ display: "grid", gap: "8px", maxWidth: "520px" }}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    setError("");
                    const chosen = candidates.find((c) => c.player_tag === tag);
                    const r = await manageApi.grantAward(clan.clan_tag, {
                      award_id: award.award_id,
                      player_tag: tag,
                      player_name: chosen?.name ?? null,
                      season_id: season.season_id,
                      note,
                    });
                    setBusy(false);
                    if (!r.ok)
                      return setError(r.data?.error ?? "That did not work.");
                    trackEvent("clan.award_granted", award.kind);
                    setGranting(false);
                    setTag("");
                    setNote("");
                    onChange?.();
                  }}
                >
                  <label
                    className="field-label"
                    htmlFor={`g-${award.award_id}`}
                  >
                    Member
                  </label>
                  <select
                    id={`g-${award.award_id}`}
                    className="input"
                    value={tag}
                    required
                    onChange={(e) => setTag(e.target.value)}
                  >
                    <option value="">Choose a member…</option>
                    {candidates.map((c) => (
                      <option key={c.player_tag} value={c.player_tag}>
                        {c.name} ({c.player_tag})
                      </option>
                    ))}
                  </select>
                  <input
                    className="input"
                    placeholder="Why (shown with the award)"
                    value={note}
                    maxLength={500}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  {error ? <p className="field-error">{error}</p> : null}
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      type="submit"
                      className="btn btn--primary"
                      disabled={busy || !tag}
                    >
                      Grant {award.name}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setGranting(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  className="btn btn--sm"
                  style={{ width: "fit-content" }}
                  onClick={() => setGranting(true)}
                >
                  Grant {award.name} for season {season.season_id}
                </button>
              )
            ) : null}
          </>
        ) : rows.length === 0 ? (
          <p className="page__lede" style={{ margin: 0 }}>
            {award.kind === "perfect_attendance"
              ? "Nobody on track."
              : "Nobody in the race yet."}
          </p>
        ) : (
          <div className="table__scroll">
            <table className="table">
              <tbody>
                {rows.map((r) => {
                  const grant = grants.find(
                    (g) => g.player_tag === r.player_tag,
                  );
                  return (
                    <tr key={r.player_tag}>
                      <td style={{ width: "2.5em", color: "var(--ink-faint)" }}>
                        {award.kind === "perfect_attendance"
                          ? "✓"
                          : `${r.rank}${r.tied ? "=" : ""}`}
                      </td>
                      <td>
                        <strong>{r.name ?? r.player_tag}</strong>{" "}
                        <span className="tag">{r.player_tag}</span>
                        {r.on_podium || grant ? (
                          <span
                            className="chip chip--ok"
                            style={{ marginLeft: "6px" }}
                          >
                            {season.closed ? "granted" : "on the podium"}
                          </span>
                        ) : null}
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {metric(award, r)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const STATE_LABEL = {
  live: "in progress",
  closed: "closed",
  held: "held",
  off: "off",
  manual: "by hand",
};

function metric(award, r) {
  if (award.kind === "perfect_attendance")
    return r.decks_short === 0
      ? `all ${r.decks_asked} war decks`
      : `${r.decks_short} deck${r.decks_short === 1 ? "" : "s"} short of ${r.decks_asked}`;
  if (award.kind === "donations_podium")
    return `${r.total.toLocaleString()} ${UNIT.donations}${r.known_weeks < r.weeks ? ` (${r.known_weeks}/${r.weeks} weeks seen)` : ""}`;
  return `${r.points.toLocaleString()} ${UNIT.points}${r.tied ? ` · ${r.donations.toLocaleString()} donated` : ""}`;
}

function OlderGrants({ grants, awardById }) {
  if (!grants.length) return null;
  const seasons = [...new Set(grants.map((g) => g.season_id))].sort(
    (a, b) => b - a,
  );
  return (
    <section>
      <div className="label" style={{ marginBottom: "8px" }}>
        Earlier seasons, no longer in the record&rsquo;s window
      </div>
      {seasons.map((sid) => (
        <div key={sid} className="panel" style={{ marginBottom: "10px" }}>
          <div className="panel__head">Season {sid}</div>
          <div className="panel__body">
            <ul style={{ margin: 0, paddingLeft: "18px" }}>
              {grants
                .filter((g) => g.season_id === sid)
                .map((g) => (
                  <li key={`${g.award_id}-${g.player_tag}`}>
                    <strong>{awardById.get(g.award_id)?.name ?? g.name}</strong>
                    {g.rank > 1 ? ` #${g.rank}` : ""} ·{" "}
                    {g.player_name ?? g.player_tag}{" "}
                    <span className="tag">{g.player_tag}</span>
                    {g.note ? ` — ${g.note}` : ""}
                  </li>
                ))}
            </ul>
          </div>
        </div>
      ))}
    </section>
  );
}

/**
 * The document editor: every award as a card (kind, name, description,
 * parameters with help text, on/off), add one, remove one, the publish
 * switch, a note, save. Validation answers come back keyed by field.
 */
function AwardsConfig({ clan, view, onDone }) {
  const [draft, setDraft] = useState(() => structuredClone(view.config));
  const [errors, setErrors] = useState({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const kinds = view.kinds;
  const setAward = (i, patch) =>
    setDraft((d) => ({
      ...d,
      awards: d.awards.map((a, j) => (j === i ? { ...a, ...patch } : a)),
    }));
  const setParam = (i, key, value) =>
    setDraft((d) => ({
      ...d,
      awards: d.awards.map((a, j) =>
        j === i ? { ...a, params: { ...a.params, [key]: value } } : a,
      ),
    }));
  const add = (kind) => {
    const k = kinds[kind];
    const params = Object.fromEntries(
      Object.entries(k.params).map(([key, p]) => [key, p.default]),
    );
    setDraft((d) => ({
      ...d,
      awards: [
        ...d.awards,
        {
          id: `${kind.split("_")[0]}_${d.awards.length + 1}`,
          kind,
          name: k.title,
          description: "",
          enabled: true,
          params,
        },
      ],
    }));
  };
  const save = async () => {
    setBusy(true);
    setMessage("");
    const r = await manageApi.saveAwards(clan.clan_tag, draft, note || null);
    setBusy(false);
    if (!r.ok) {
      setErrors(r.data?.errors ?? {});
      setMessage(
        r.data?.errors ? "Fix the fields marked below." : "Save failed.",
      );
      return;
    }
    trackEvent("clan.awards_saved", draft.publish ? "published" : "private");
    onDone();
  };
  const err = (key) =>
    errors[key] ? <p className="field-error">{errors[key]}</p> : null;

  return (
    <div style={{ display: "grid", gap: "16px" }}>
      <p className="page-head__note" style={{ margin: 0 }}>
        Every save is a new version; grants already written keep the name they
        were given. Names and descriptions are yours; the rule under each is the
        kind&rsquo;s.
      </p>
      {draft.awards.map((a, i) => {
        const k = kinds[a.kind];
        return (
          <section key={i} className="panel">
            <div
              className="panel__head"
              style={{ gap: "8px", flexWrap: "wrap" }}
            >
              <span>{a.name || k.title}</span>
              <span className="chip">{k.title}</span>
              <label
                style={{
                  marginLeft: "auto",
                  display: "inline-flex",
                  gap: "6px",
                }}
              >
                <input
                  type="checkbox"
                  checked={a.enabled !== false}
                  onChange={(e) => setAward(i, { enabled: e.target.checked })}
                />
                <span>{a.enabled !== false ? "on" : "off"}</span>
              </label>
            </div>
            <div
              className="panel__body"
              style={{ display: "grid", gap: "10px" }}
            >
              <p className="page__lede" style={{ margin: 0 }}>
                {k.rule}
              </p>
              <div style={{ display: "grid", gap: "4px" }}>
                <label className="field-label" htmlFor={`a-${i}-name`}>
                  Name
                </label>
                <input
                  id={`a-${i}-name`}
                  className="input"
                  value={a.name}
                  maxLength={40}
                  onChange={(e) => setAward(i, { name: e.target.value })}
                />
                {err(`awards.${i}.name`)}
              </div>
              <div style={{ display: "grid", gap: "4px" }}>
                <label className="field-label" htmlFor={`a-${i}-desc`}>
                  Description{" "}
                  <span className="page-head__note">
                    (shown with the award)
                  </span>
                </label>
                <input
                  id={`a-${i}-desc`}
                  className="input"
                  value={a.description ?? ""}
                  maxLength={300}
                  onChange={(e) => setAward(i, { description: e.target.value })}
                />
                {err(`awards.${i}.description`)}
              </div>
              <div style={{ display: "grid", gap: "4px" }}>
                <label className="field-label" htmlFor={`a-${i}-id`}>
                  Id{" "}
                  <span className="page-head__note">
                    (the durable key in the public document; change it only
                    before the first grant)
                  </span>
                </label>
                <input
                  id={`a-${i}-id`}
                  className="input mono"
                  value={a.id}
                  onChange={(e) => setAward(i, { id: e.target.value })}
                />
                {err(`awards.${i}.id`)}
              </div>
              {Object.entries(k.params).map(([key, p]) => (
                <div key={key} style={{ display: "grid", gap: "4px" }}>
                  <label className="field-label" htmlFor={`a-${i}-${key}`}>
                    {p.label}{" "}
                    <span className="page-head__note">
                      {p.type === "enum"
                        ? `(${p.options.join(" / ")}; default ${p.default})`
                        : `(${p.min}–${p.max}; default ${p.default})`}
                    </span>
                  </label>
                  {p.type === "enum" ? (
                    <select
                      id={`a-${i}-${key}`}
                      className="input"
                      style={{ width: "auto" }}
                      value={a.params?.[key] ?? p.default}
                      onChange={(e) => setParam(i, key, e.target.value)}
                    >
                      {p.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={`a-${i}-${key}`}
                      className="input"
                      type="number"
                      style={{ width: "8em" }}
                      min={p.min}
                      max={p.max}
                      step={1}
                      value={a.params?.[key] ?? p.default}
                      onChange={(e) =>
                        setParam(
                          i,
                          key,
                          e.target.value === "" ? "" : Number(e.target.value),
                        )
                      }
                    />
                  )}
                  <span className="page-head__note">{p.why}</span>
                  {err(`awards.${i}.params.${key}`)}
                </div>
              ))}
              <button
                type="button"
                className="btn--text"
                style={{ width: "fit-content" }}
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    awards: d.awards.filter((_, j) => j !== i),
                  }))
                }
              >
                remove this award
              </button>
            </div>
          </section>
        );
      })}
      {err("awards")}
      <div
        style={{
          display: "flex",
          gap: "8px",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <span className="page-head__note">Add an award:</span>
        {Object.entries(kinds).map(([kind, k]) => (
          <button
            key={kind}
            type="button"
            className="btn btn--sm"
            onClick={() => add(kind)}
          >
            {k.title}
          </button>
        ))}
      </div>
      <label
        style={{ display: "inline-flex", gap: "8px", alignItems: "center" }}
      >
        <input
          type="checkbox"
          checked={draft.publish === true}
          onChange={(e) =>
            setDraft((d) => ({ ...d, publish: e.target.checked }))
          }
        />
        <span>
          Publish the awards document at{" "}
          <code>/api/clans/{clan.clan_tag.slice(1)}/awards</code> (public JSON,
          no sign-in; names and tags of every grant)
        </span>
      </label>
      <input
        className="input"
        placeholder="A note for this version (optional)"
        value={note}
        maxLength={200}
        onChange={(e) => setNote(e.target.value)}
      />
      {message ? <p className="field-error">{message}</p> : null}
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          onClick={save}
        >
          {busy ? "Saving…" : "Save as a new version"}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
      </div>
      {view.versions.length ? (
        <p className="page-head__note" style={{ margin: 0 }}>
          Versions:{" "}
          {view.versions
            .map(
              (v) =>
                `v${v.version} (${v.saved_at.slice(0, 10)}${v.note ? `, ${v.note}` : ""})`,
            )
            .join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
