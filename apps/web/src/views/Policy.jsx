import { useEffect, useState } from "react";
import { manageApi } from "../api.js";
import { keys, useInvalidate, usePolicy } from "../lib/queries.js";
import { trackEvent } from "../analytics.js";
import { TooFew } from "../components/TooFew.jsx";
import { PRESETS, policyFromGoals, tabStart } from "@elixir-clan/engine";

/** Whether a group or field applies under the draft (engine `applies`). */
const applies = (when, values) =>
  !when ||
  when.some((clause) =>
    Object.entries(clause).every(([k, v]) => values?.[k] === v),
  );

const switchesOf = (tab) =>
  [tab.switch, ...(tab.switches ?? [])].filter(Boolean);

/**
 * The policy editor, in tabs along the top (Jamie, 2026-09-25: one long
 * page was too much). About holds the starting points, how strict the
 * clan is and what it does; each category (Clan Wars, ranked play,
 * donations, trophy road) is its own tab, switched on or off, with its
 * own settings; then Elder, inactivity, arrivals and departures, and
 * announcements. A tab that is off shows only its switch; turning one on
 * fills its settings from the clan's posture, to tune. Every field keeps
 * its help text (the documentation of the rules IS this page). The save
 * bar, the preview and the versions sit below whichever tab is open.
 */
export function Policy({ clan }) {
  const [draft, setDraft] = useState(null);
  const [tab, setTab] = useState("about");
  const [errors, setErrors] = useState({});
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");

  const policy = usePolicy(clan.clan_tag);
  const view = policy.data ?? null;
  // The draft starts from what the server has; a saved policy is the
  // new start. A saved policy changes the judged board too: the whole
  // clan refetches.
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

  const tabs = view.tabs;
  const fieldsOf = (t) =>
    Object.keys(view.fields).filter((k) =>
      t.groups.includes(view.fields[k].group),
    );
  const changed = Object.keys(view.fields).filter(
    (k) => draft[k] !== view.current.values[k],
  );
  // The first save is a policy even with nothing changed.
  const canSave = !view.set || changed.length > 0;
  const set = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  const current = tabs.find((t) => t.key === tab) ?? tabs[0];

  /** A tab's switch: turning it on fills the tab from the clan's posture. */
  const flip = (t, on) => {
    setDraft((d) =>
      on ? { ...d, ...tabStart(d, t.key) } : { ...d, [t.switch]: false },
    );
    setPreview(null);
  };
  const fill = (goals, posture, key) => {
    setDraft(policyFromGoals(goals, posture));
    setPreview(null);
    setErrors({});
    trackEvent("clan.policy_preset", key);
  };
  const failed = (r, what) => {
    const errs = r.data?.errors ?? {};
    setErrors(errs);
    // Open the first tab that holds a field with a problem.
    const first = tabs.find((t) => fieldsOf(t).some((k) => errs[k]));
    if (first) setTab(first.key);
    setMessage(
      Object.keys(errs).length ? "Fix the fields marked on the tabs." : what,
    );
  };

  const doPreview = async () => {
    setBusy(true);
    setMessage("");
    const r = await manageApi.previewPolicy(clan.clan_tag, draft);
    setBusy(false);
    if (!r.ok) return failed(r, "Preview failed.");
    setErrors({});
    trackEvent("clan.policy_previewed");
    setPreview(r.data);
  };
  const save = async () => {
    setBusy(true);
    setMessage("");
    const r = await manageApi.savePolicy(clan.clan_tag, draft, note || null);
    setBusy(false);
    if (!r.ok) return failed(r, "Save failed.");
    setErrors({});
    setPreview(null);
    setNote("");
    trackEvent("clan.policy_saved", `v${r.data.version}`);
    setMessage(`Saved as version ${r.data.version}.`);
    load();
  };

  /** How a tab reads on the bar: its state, and whether it has edits. */
  const stateOf = (t) => {
    const sw = switchesOf(t);
    if (t.key === "elder")
      return draft.elder_mode === "categories" ? "ranked" : "by hand";
    if (!sw.length) return null;
    return sw.some((k) => draft[k] === true) ? "on" : "off";
  };

  return (
    <div className="grid gap-4">
      {view.set ? (
        <p className="page-head__note m-0">
          {`Version ${view.current.version}, saved ${view.current.saved_at?.slice(0, 10)} by ${view.current.saved_by_name ?? view.current.saved_by}.`}{" "}
          Every save is a new version; nothing is edited in place. Each action
          says which version raised it.
        </p>
      ) : (
        <div className="callout" role="note">
          <span>
            This clan has no policy yet, so nothing in clan management runs: no
            actions, no standing, no inactivity clock, no awards. Start from
            what the clan is for, or turn on the tabs for what it does, and
            save; members then see how the clan runs on their Standing page.
          </span>
        </div>
      )}

      <div className="segmented flex-wrap" role="tablist" aria-label="Policy">
        {tabs.map((t) => {
          const state = stateOf(t);
          const edited = fieldsOf(t).some((k) => changed.includes(k));
          const wrong = fieldsOf(t).some((k) => errors[k]);
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`tab-${t.key}`}
              aria-label={[
                t.title,
                state,
                edited ? "changed" : null,
                wrong ? "needs a fix" : null,
              ]
                .filter(Boolean)
                .join(", ")}
              aria-selected={t.key === current.key}
              aria-controls="policy-panel"
              onClick={() => setTab(t.key)}
            >
              {state === "on" || state === "off" ? (
                <span
                  aria-hidden="true"
                  className={`mr-1.5 inline-block size-2 rounded-full ${state === "on" ? "bg-[var(--ok)]" : "border border-[var(--ink-faint)]"}`}
                />
              ) : null}
              {t.title}
              {state && state !== "on" && state !== "off" ? (
                <span className="text-[var(--ink-faint)]"> · {state}</span>
              ) : null}
              {wrong ? (
                <span aria-hidden="true" className="ml-1 text-[var(--bad)]">
                  !
                </span>
              ) : edited ? (
                <span aria-hidden="true" className="ml-1 text-[var(--accent)]">
                  •
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <section
        className="panel"
        role="tabpanel"
        id="policy-panel"
        aria-labelledby={`tab-${current.key}`}
      >
        <div className="panel__head flex-wrap gap-2">
          <span>{current.title}</span>
          {current.switch ? (
            <label className="ml-auto inline-flex items-center gap-2 whitespace-nowrap">
              <input
                type="checkbox"
                className="size-4 shrink-0"
                aria-label={view.fields[current.switch].label}
                checked={draft[current.switch] === true}
                disabled={!view.can_edit}
                onChange={(e) => flip(current, e.target.checked)}
              />
              <span>{view.fields[current.switch].label}</span>
            </label>
          ) : null}
        </div>
        <div className="panel__body grid gap-5">
          {current.key === "about" ? (
            <About
              view={view}
              tabs={tabs}
              stateOf={stateOf}
              onFill={fill}
              onOpen={setTab}
            />
          ) : null}
          {(() => {
            // One group of the open tab: its help once, then its fields; a
            // help shared by fields in a row (the Elder weights) says it once.
            const groupBlock = (gk) => {
              const g = view.groups.find((x) => x.key === gk);
              if (!g || !applies(g.when, draft)) return null;
              const keysHere = fieldsOf({ groups: [gk] }).filter(
                (k) =>
                  k !== current.switch && applies(view.fields[k].when, draft),
              );
              const off = current.switch && draft[current.switch] !== true;
              return (
                <div key={gk} className="grid gap-3">
                  {current.groups.length > 1 ? (
                    <h2 className="label m-0">{g.title}</h2>
                  ) : null}
                  <p className="page__lede m-0">{g.why}</p>
                  {off ? (
                    <p className="page-head__note m-0">
                      Off: this clan does not use it. Turn it on above to set it
                      up.
                    </p>
                  ) : (
                    keysHere.map((k, i) => (
                      <Field
                        key={k}
                        name={k}
                        f={view.fields[k]}
                        help={
                          view.fields[keysHere[i + 1]]?.why !==
                          view.fields[k].why
                        }
                        value={draft[k]}
                        error={errors[k]}
                        disabled={!view.can_edit}
                        onChange={(v) => set(k, v)}
                      />
                    ))
                  )}
                </div>
              );
            };
            const isAdvanced = (gk) =>
              view.groups.find((x) => x.key === gk)?.advanced === true;
            const main = current.groups.filter((gk) => !isAdvanced(gk));
            const fine = current.groups.filter(
              (gk) =>
                isAdvanced(gk) &&
                applies(view.groups.find((x) => x.key === gk)?.when, draft),
            );
            const fineKeys = fieldsOf({ groups: fine });
            return (
              <>
                {main.map(groupBlock)}
                {fine.length ? (
                  <details
                    key={`${current.key}-fine`}
                    open={fineKeys.some((k) => errors[k])}
                  >
                    <summary className="label cursor-pointer">
                      Fine tuning:{" "}
                      {fine
                        .map(
                          (gk) =>
                            view.groups.find((x) => x.key === gk)?.title ?? gk,
                        )
                        .join(", ")
                        .toLowerCase()}
                    </summary>
                    <div className="mt-4 grid gap-5">
                      {fine.map(groupBlock)}
                    </div>
                  </details>
                ) : null}
              </>
            );
          })()}
        </div>
      </section>

      {view.can_edit ? (
        <div className="panel">
          <div className="panel__body grid gap-2.5">
            <div className="page-head__note">
              {!view.set
                ? "Saving creates version 1: clan management starts from it."
                : changed.length
                  ? `${changed.length} setting${changed.length === 1 ? "" : "s"} changed: ${changed.map((k) => view.fields[k].label).join(", ")}.`
                  : "No changes."}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn"
                disabled={busy || !canSave}
                onClick={doPreview}
              >
                Preview the last reviews
              </button>
              <input
                className="input flex-[1_1_200px]"
                placeholder="why this change (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
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
        <details>
          <summary className="label cursor-pointer">
            Versions ({view.versions.length})
          </summary>
          <ul className="mt-2 mb-0 pl-[18px]">
            {view.versions.map((v) => (
              <li key={v.version}>
                v{v.version} · {v.saved_at?.slice(0, 16).replace("T", " ")} ·{" "}
                {v.saved_by_name ?? ""}{" "}
                <span className="tag">{v.saved_by}</span>
                {v.note ? ` · ${v.note}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** The About tab: where to start, and what the clan does at a glance. */
function About({ view, tabs, stateOf, onFill, onOpen }) {
  return (
    <>
      {view.can_edit ? (
        <div className="grid gap-2">
          <h2 className="label m-0">Start from what the clan is for</h2>
          <p className="page__lede m-0">
            Pick a starting point and every tab is filled from it, yours to
            change before you save.
            {view.set
              ? " It replaces the whole draft; the changed settings and the preview show what would move."
              : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className="btn btn--sm"
                onClick={() => onFill(p.goals, p.posture, p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="grid gap-2">
        <h2 className="label m-0">What the clan does</h2>
        <ul className="m-0 grid list-none gap-1 p-0">
          {tabs
            .filter((t) => t.key !== "about")
            .map((t) => (
              <li key={t.key}>
                <button
                  type="button"
                  className="btn--text"
                  onClick={() => onOpen(t.key)}
                >
                  {t.title}
                </button>{" "}
                <span className="page-head__note">{stateOf(t) ?? ""}</span>
              </li>
            ))}
        </ul>
      </div>
      <h2 className="label m-0">How strict, and what the game cannot count</h2>
    </>
  );
}

/** One setting with its help and its problem, if any. */
function Field({ name, f, help = true, value, error, disabled, onChange }) {
  const id = `f-${name}`;
  return (
    <div id={name} className="grid gap-1">
      {f.type === "boolean" ? (
        <label className="flex items-center gap-2 font-semibold">
          <input
            id={id}
            type="checkbox"
            className="size-4 shrink-0"
            checked={Boolean(value)}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{f.label}</span>
        </label>
      ) : (
        <label className="field-label font-semibold" htmlFor={id}>
          {f.label}{" "}
          {f.type === "integer" || f.type === "number" ? (
            <span className="page-head__note">
              ({f.unit}, {f.min}–{f.max})
            </span>
          ) : null}
        </label>
      )}
      {f.type === "enum" ? (
        <select
          id={id}
          className="input max-w-[420px]"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error)}
        >
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : f.type === "boolean" ? null : (
        <input
          id={id}
          className="input max-w-[160px]"
          type="number"
          step={f.type === "integer" ? 1 : 0.01}
          min={f.min}
          max={f.max}
          value={value}
          disabled={disabled}
          onChange={(e) =>
            onChange(
              e.target.value === ""
                ? ""
                : f.type === "integer"
                  ? parseInt(e.target.value, 10)
                  : parseFloat(e.target.value),
            )
          }
          aria-invalid={Boolean(error)}
        />
      )}
      {help ? <div className="page-head__note">{f.why}</div> : null}
      {error ? (
        <div className="field-error text-[var(--bad)]" role="alert">
          {error}
        </div>
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
      <div className="label my-2">
        Preview · {preview.draft.boundaries.length} reviews · {moved.length}{" "}
        member{moved.length === 1 ? "" : "s"} would read differently
      </div>
      <div className="page-head__note mb-2">
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
          Nobody&rsquo;s verdict changes over the last reviews.
        </p>
      )}
    </div>
  );
}
