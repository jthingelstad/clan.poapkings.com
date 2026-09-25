import { useEffect, useState } from "react";
import { manageApi } from "../api.js";
import { keys, useInvalidate, usePolicy } from "../lib/queries.js";
import { trackEvent } from "../analytics.js";
import { TooFew } from "../components/TooFew.jsx";

/** Whether a group or field applies under the draft (engine `applies`). */
const applies = (when, values) =>
  !when ||
  when.some((clause) =>
    Object.entries(clause).every(([k, v]) => values?.[k] === v),
  );

/**
 * The policy editor: every field with its help text (the documentation of
 * the rules IS this page), shown only where it applies under the draft, a
 * preview of the last reviews under the draft beside the current policy,
 * and the versions. Until a leader saves the first version nothing in clan
 * management runs; everything starts off.
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
  // Below the smallest clan a policy engages with there is nothing to set.
  if (view.big_enough === false)
    return (
      <div className="grid gap-4">
        {view.set ? (
          <p className="page-head__note m-0">
            {`Version ${view.current.version} is kept and picks up again when the clan has ${view.min_members} members.`}
          </p>
        ) : null}
        <TooFew members={view.members} min={view.min_members} />
      </div>
    );

  const changed = Object.keys(draft).filter(
    (k) => draft[k] !== view.current.values[k],
  );
  // The first save is a policy even with nothing changed.
  const canSave = !view.set || changed.length > 0;
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
      {view.set ? (
        <p className="page-head__note m-0">
          {`Version ${view.current.version}, saved ${view.current.saved_at?.slice(0, 10)} by ${view.current.saved_by_name ?? view.current.saved_by}.`}{" "}
          Every save is a new version; nothing is edited in place. Cards say
          which version judged them.
        </p>
      ) : (
        <div className="callout" role="note">
          <span>
            This clan has no policy yet, so nothing in clan management runs: no
            cards, no standing, no inactivity clock, no awards. Everything below
            starts off. Turn on what your clan does and save; members then see
            how the clan runs on their Standing page.
          </span>
        </div>
      )}
      {view.groups.map((g) => {
        if (!applies(g.when, draft)) return null;
        const fields = Object.entries(view.fields).filter(
          ([, f]) => f.group === g.key && applies(f.when, draft),
        );
        if (!fields.length) return null;
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
                    {f.type === "integer" || f.type === "number" ? (
                      <span className="page-head__note">
                        ({f.unit}, {f.min}–{f.max})
                      </span>
                    ) : null}
                  </label>
                  {f.type === "enum" ? (
                    <select
                      id={`f-${key}`}
                      className="input max-w-[420px]"
                      value={draft[key]}
                      disabled={!view.can_edit}
                      onChange={(e) => set(key, e.target.value)}
                      aria-invalid={Boolean(errors[key])}
                    >
                      {f.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : f.type === "boolean" ? (
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
              {!view.set
                ? "Saving creates version 1: clan management starts from it."
                : changed.length
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
                disabled={busy || !canSave}
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
                disabled={busy || !canSave}
                onClick={save}
              >
                {view.set ? "Save as new version" : "Save this clan's policy"}
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
                {v.saved_by_name ?? ""}{" "}
                <span className="tag">{v.saved_by}</span>
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
  const none = {
    actionable: {},
    promotion: "none",
    demotion: "none",
    removal: "none",
  };
  const byTag = new Map(
    (preview.current?.members ?? []).map((m) => [m.player_tag, m]),
  );
  const rows = preview.draft.members.map((m) => ({
    tag: m.player_tag,
    name: m.name,
    current: label(byTag.get(m.player_tag) ?? none),
    draft: label(m),
  }));
  const moved = rows.filter((r) => r.current !== r.draft);
  const bandText = (b) =>
    b ? `${b.floor}–${b.ceil} (target ${b.target})` : "none (Elders by hand)";
  return (
    <div>
      <div className="label" style={{ margin: "8px 0" }}>
        Preview · {preview.draft.boundaries.length} reviews · {moved.length}{" "}
        member{moved.length === 1 ? "" : "s"} would read differently
      </div>
      <div className="page-head__note" style={{ marginBottom: "8px" }}>
        {preview.current
          ? `Elder band now ${bandText(preview.current.band)}; under the draft ${bandText(preview.draft.band)}.`
          : `No policy yet. Under the draft, the Elder band is ${bandText(preview.draft.band)}.`}
      </div>
      {moved.length ? (
        <div className="table__scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Member</th>
                <th>{preview.current ? "Current policy" : "Today"}</th>
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
