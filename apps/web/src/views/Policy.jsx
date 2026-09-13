import { useEffect, useState } from "react";
import { manageApi } from "../api.js";
import { keys, useInvalidate, usePolicy } from "../lib/queries.js";
import { trackEvent } from "../analytics.js";

/**
 * The policy editor: every field with its help text (the documentation of
 * the rules IS this page), a preview of the last reviews under the draft
 * beside the current policy, and the versions.
 */
export function Policy({ clan }) {
  const [draft, setDraft] = useState(null);
  const [errors, setErrors] = useState({});
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");

  const policy = usePolicy(clan.clan_tag);
  const view = policy.data ?? null;
  // The draft starts from what the server has; a saved policy is the
  // new start. `load` after a save refetches, and the effect resets.
  // A saved policy changes the judged board too: the whole clan refetches.
  const invalidate = useInvalidate();
  const load = () => invalidate(keys.clan(clan.clan_tag));
  useEffect(() => {
    if (view) setDraft(view.current.values);
  }, [view]);
  if (!view || !draft) return <p className="page__lede">Loading the policy…</p>;

  const changed = Object.keys(draft).filter(
    (k) => draft[k] !== view.current.values[k],
  );
  const set = (key, value) => setDraft((d) => ({ ...d, [key]: value }));

  const doPreview = async () => {
    setBusy(true);
    setMessage("");
    const r = await manageApi.previewPolicy(clan.clan_tag, draft);
    setBusy(false);
    if (!r.ok) {
      setErrors(r.data?.errors ?? {});
      setMessage(
        r.data?.errors ? "Fix the fields marked below." : "Preview failed.",
      );
      return;
    }
    setErrors({});
    trackEvent("clan.policy_previewed");
    setPreview(r.data);
  };
  const save = async () => {
    setBusy(true);
    setMessage("");
    const r = await manageApi.savePolicy(clan.clan_tag, draft, note || null);
    setBusy(false);
    if (!r.ok) {
      setErrors(r.data?.errors ?? {});
      setMessage(
        r.data?.errors ? "Fix the fields marked below." : "Save failed.",
      );
      return;
    }
    setErrors({});
    setPreview(null);
    setNote("");
    trackEvent("clan.policy_saved", `v${r.data.version}`);
    setMessage(`Saved as version ${r.data.version}.`);
    load();
  };

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      <p className="page-head__note" style={{ margin: 0 }}>
        {view.current.version === 0
          ? "This clan runs on the POAP KINGS defaults until a leader saves a version."
          : `Version ${view.current.version}, saved ${view.current.saved_at?.slice(0, 10)} by ${view.current.saved_by}.`}{" "}
        Every save is a new version; nothing is edited in place. Cards say which
        version judged them.
      </p>
      {view.groups.map((g) => {
        const fields = Object.entries(view.fields).filter(
          ([, f]) => f.group === g.key,
        );
        return (
          <section key={g.key} className="panel">
            <div className="panel__head">{g.title}</div>
            <div
              className="panel__body"
              style={{ display: "grid", gap: "14px" }}
            >
              <p className="page__lede" style={{ margin: 0 }}>
                {g.why}
              </p>
              {fields.map(([key, f]) => (
                <div key={key} id={key} style={{ display: "grid", gap: "4px" }}>
                  <label
                    className="field-label"
                    htmlFor={`f-${key}`}
                    style={{ fontWeight: 600 }}
                  >
                    {f.label}{" "}
                    <span className="page-head__note">
                      ({f.unit}
                      {f.type !== "boolean" ? `, ${f.min}–${f.max}` : ""};
                      default {String(f.default)})
                    </span>
                  </label>
                  {f.type === "boolean" ? (
                    <label
                      style={{
                        display: "inline-flex",
                        gap: "8px",
                        alignItems: "center",
                        width: "fit-content",
                      }}
                    >
                      <input
                        id={`f-${key}`}
                        type="checkbox"
                        checked={Boolean(draft[key])}
                        disabled={!view.can_edit}
                        onChange={(e) => set(key, e.target.checked)}
                      />
                      <span>{draft[key] ? "on" : "off"}</span>
                    </label>
                  ) : (
                    <input
                      id={`f-${key}`}
                      className="input"
                      type="number"
                      step={f.type === "integer" ? 1 : 0.01}
                      min={f.min}
                      max={f.max}
                      value={draft[key]}
                      disabled={!view.can_edit}
                      onChange={(e) =>
                        set(
                          key,
                          e.target.value === ""
                            ? ""
                            : f.type === "integer"
                              ? parseInt(e.target.value, 10)
                              : parseFloat(e.target.value),
                        )
                      }
                      style={{ maxWidth: "160px" }}
                      aria-invalid={Boolean(errors[key])}
                    />
                  )}
                  <div className="page-head__note">{f.why}</div>
                  {errors[key] ? (
                    <div
                      className="field-error"
                      role="alert"
                      style={{ color: "var(--bad)" }}
                    >
                      {errors[key]}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        );
      })}
      {view.can_edit ? (
        <div className="panel">
          <div className="panel__body" style={{ display: "grid", gap: "10px" }}>
            <div className="page-head__note">
              {changed.length
                ? `${changed.length} field${changed.length === 1 ? "" : "s"} changed: ${changed.join(", ")}`
                : "No changes."}
            </div>
            <div
              style={{
                display: "flex",
                gap: "8px",
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <button
                type="button"
                className="btn"
                disabled={busy || !changed.length}
                onClick={doPreview}
              >
                Preview the last reviews
              </button>
              <input
                className="input"
                placeholder="why this change (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                style={{ flex: "1 1 200px" }}
              />
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy || !changed.length}
                onClick={save}
              >
                Save as new version
              </button>
            </div>
            {message ? <div className="notice">{message}</div> : null}
            {preview ? <Preview preview={preview} /> : null}
          </div>
        </div>
      ) : null}
      {view.versions.length ? (
        <section>
          <div className="label" style={{ marginBottom: "8px" }}>
            Versions
          </div>
          <ul style={{ margin: 0, paddingLeft: "18px" }}>
            {view.versions.map((v) => (
              <li key={v.version}>
                v{v.version} · {v.saved_at?.slice(0, 16).replace("T", " ")} ·{" "}
                {v.saved_by}
                {v.note ? ` · ${v.note}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Preview({ preview }) {
  const label = (m) => {
    const bits = [];
    if (m.actionable.promotion) bits.push("promote");
    if (m.actionable.demotion) bits.push("demote");
    if (m.actionable.removal) bits.push("remove");
    if (bits.length) return bits.join(", ");
    if (m.promotion !== "none") return `promotion ${m.promotion}`;
    if (m.demotion !== "none") return `demotion ${m.demotion}`;
    if (m.removal !== "none") return `removal ${m.removal.replace("_", " ")}`;
    return "—";
  };
  const byTag = new Map(preview.current.members.map((m) => [m.player_tag, m]));
  const rows = preview.draft.members.map((m) => ({
    tag: m.player_tag,
    name: m.name,
    current: label(byTag.get(m.player_tag) ?? m),
    draft: label(m),
  }));
  const moved = rows.filter((r) => r.current !== r.draft);
  return (
    <div>
      <div className="label" style={{ margin: "8px 0" }}>
        Preview · {preview.current.boundaries.length} reviews · {moved.length}{" "}
        member{moved.length === 1 ? "" : "s"} would read differently
      </div>
      <div className="page-head__note" style={{ marginBottom: "8px" }}>
        Band now {preview.current.band.floor}–{preview.current.band.ceil}{" "}
        (target {preview.current.band.target}); under the draft{" "}
        {preview.draft.band.floor}–{preview.draft.band.ceil} (target{" "}
        {preview.draft.band.target}).
      </div>
      {moved.length ? (
        <div className="table__scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Current policy</th>
                <th>Draft</th>
              </tr>
            </thead>
            <tbody>
              {moved.map((r) => (
                <tr key={r.tag}>
                  <td>
                    {r.name} <span className="tag">{r.tag}</span>
                  </td>
                  <td>{r.current}</td>
                  <td>{r.draft}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="page__lede">
          Nobody's verdict changes over the last reviews.
        </p>
      )}
    </div>
  );
}
