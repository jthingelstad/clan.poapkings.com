import { Fresh, Icon } from "elixir-mcp/packages/ui/src/index.ts";
import { useEffect, useState } from "react";
import { manageApi } from "../api.js";
import { useRecruit } from "../lib/queries.js";
import { trackEvent } from "../analytics.js";

/**
 * Recruit: a page every member can use. The clan's pitch (a leader's
 * words), the facts the game states today (one live read, cached), and
 * copy in two formats: a personal note for one person by email or
 * message, and a public post for a recruiting forum. The post carries the
 * forums' requirements itself: the required trophies in brackets, and no
 * invite link in the body. Every piece is editable before it is copied and
 * comes back to the clan's words with one click. Until a leader writes the
 * pitch there is no copy: nothing is said for a clan it has not said.
 */
const FORMATS = [
  [
    "personal",
    "Personal note",
    "For one person, by email or message. Plain text; the subject is for email.",
  ],
  [
    "post",
    "Public post",
    "For a recruiting forum, such as a Discord recruiting channel or r/RoyaleRecruit. The title carries the required trophies in brackets and the body says Required Trophies: [N], as the forums ask; invite links are left out of the body.",
  ],
];

export function Recruit({ clan }) {
  const [editing, setEditing] = useState(false);
  // A pending live read asks again after Elixir's retry_after_s: the
  // query's own refetchInterval, read off the answer (lib/queries.js).
  const { state, load, updatedAt: now } = useRecruit(clan.clan_tag);

  if (state.signedOut) {
    window.location.assign("/?error=session_expired");
    return null;
  }
  if (state.error)
    return (
      <div className="callout callout--warn" role="alert">
        <span>Elixir did not answer. Try again in a minute.</span>
      </div>
    );
  if (!state.data) return <p className="page__lede">Reading the clan…</p>;
  const d = state.data;
  const f = d.facts;

  if (editing)
    return (
      <PitchEditor
        clan={clan}
        view={d}
        onDone={() => {
          setEditing(false);
          load();
        }}
      />
    );

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      <div className="page-head" style={{ alignItems: "center" }}>
        <h1 className="page__title">Recruit</h1>
        <span className="page-head__note">
          Copy that says what {f?.name ?? clan.name ?? "the clan"} is, with
          today&rsquo;s numbers. Paste it, or edit it first.
        </span>
      </div>

      <section className="panel">
        <div className="panel__head" style={{ gap: "8px", flexWrap: "wrap" }}>
          <span>Today, from the game</span>
          {d.facts_read_at ? (
            <Fresh
              label="read"
              seconds={Math.max(0, (now - Date.parse(d.facts_read_at)) / 1000)}
              ts={d.facts_read_at}
            />
          ) : null}
          {d.pending ? (
            <span className="chip chip--info">
              fresh read queued · asking again in{" "}
              {Math.min(60, d.pending.retry_after_s)} s
            </span>
          ) : f?.source === "recorded" ? (
            <span className="chip">from the record</span>
          ) : null}
          {d.can_edit ? (
            <button
              type="button"
              className="btn--text"
              style={{ marginLeft: "auto" }}
              onClick={() => load(true)}
            >
              read again
            </button>
          ) : null}
        </div>
        <div className="panel__body fields" style={{ rowGap: "6px" }}>
          <span className="label">Members</span>
          <span>
            {f?.members ?? "?"} members
            {f ? ` · ${f.open_slots} open` : ""}
          </span>
          <span className="label">To join</span>
          <span>
            {f?.required_trophies !== null && f?.required_trophies !== undefined
              ? `${f.required_trophies.toLocaleString()} trophies`
              : "not in the record yet"}
            {f?.type
              ? ` · ${f.type === "inviteOnly" ? "invite only" : f.type}`
              : ""}
          </span>
          <span className="label">Clan numbers</span>
          <span>
            {f?.war_trophies
              ? `${f.war_trophies.toLocaleString()} war trophies`
              : "—"}
            {f?.clan_score
              ? ` · clan score ${f.clan_score.toLocaleString()}`
              : ""}
            {f?.donations_per_week
              ? ` · ${f.donations_per_week.toLocaleString()} cards a week`
              : ""}
          </span>
          {f?.top_trophies?.length ? (
            <>
              <span className="label">Top trophies</span>
              <span>
                {f.top_trophies
                  .map((m) => `${m.name} ${m.value.toLocaleString()}`)
                  .join(" · ")}
              </span>
            </>
          ) : null}
          {f?.top_donors?.length ? (
            <>
              <span className="label">Top donors</span>
              <span>
                {f.top_donors
                  .map((m) => `${m.name} ${m.value.toLocaleString()}`)
                  .join(" · ")}
              </span>
            </>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel__head" style={{ gap: "8px", flexWrap: "wrap" }}>
          <span>The pitch</span>
          <span className="page-head__note">
            {d.pitch_version === 0 ? "not written yet" : `v${d.pitch_version}`}
          </span>
          {d.can_edit ? (
            <button
              type="button"
              className="btn--text"
              style={{ marginLeft: "auto" }}
              onClick={() => setEditing(true)}
            >
              {d.pitch_version === 0 ? "write the pitch" : "edit the pitch"}
            </button>
          ) : null}
        </div>
        {d.pitch_version === 0 ? (
          <div className="panel__body page-head__note">
            {d.can_edit
              ? "Write what your clan is, in your words: a tagline, a few sentences, what makes it different and who you want. The copy below follows from it and today's numbers."
              : "A leader has not written the clan's pitch yet, so there is no copy to share."}
          </div>
        ) : (
          <div className="panel__body" style={{ display: "grid", gap: "6px" }}>
            <div style={{ fontWeight: 600 }}>{d.pitch.tagline}</div>
            <div>{d.pitch.about}</div>
            <ul style={{ margin: "4px 0 0", paddingLeft: "18px" }}>
              {d.pitch.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <div className="page-head__note">{d.pitch.looking_for}</div>
          </div>
        )}
      </section>

      {d.copy && d.problems?.length ? (
        <div className="callout callout--warn" role="alert">
          <span>Check before posting: {d.problems.join("; ")}.</span>
        </div>
      ) : null}

      {d.copy
        ? FORMATS.map(([key, title, note]) => (
            <CopyCard
              key={key}
              channel={key}
              title={title}
              note={note}
              value={d.copy[key]}
            />
          ))
        : null}
    </div>
  );
}

const asText = (value) =>
  typeof value === "string"
    ? value
    : value?.subject !== undefined
      ? `Subject: ${value.subject}\n\n${value.body}`
      : value?.title !== undefined
        ? `Title: ${value.title}\n\n${value.body}`
        : "";

function CopyCard({ channel, title, note, value }) {
  const original = asText(value);
  const [text, setText] = useState(original);
  const [done, setDone] = useState(false);
  useEffect(() => setText(original), [original]);
  return (
    <section className="panel">
      <div className="panel__head" style={{ gap: "8px", flexWrap: "wrap" }}>
        <span>{title}</span>
        <span className="page-head__note">{note}</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
          {text !== original ? (
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setText(original)}
            >
              Reset
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--sm btn--primary"
            aria-label={`Copy the ${title.toLowerCase()}`}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                trackEvent("clan.recruit_copied", channel);
                setDone(true);
                setTimeout(() => setDone(false), 1500);
              } catch {
                // The text is on screen to select by hand.
              }
            }}
          >
            <Icon name={done ? "check" : "copy"} size={14} />{" "}
            {done ? "Copied" : "Copy"}
          </button>
        </span>
      </div>
      <div className="panel__body">
        <textarea
          className="input"
          aria-label={title}
          rows={Math.min(16, Math.max(3, text.split("\n").length + 1))}
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ width: "100%", fontFamily: "inherit" }}
        />
      </div>
    </section>
  );
}

function PitchEditor({ clan, view, onDone }) {
  // A first pitch starts from a draft of the clan's goals, when it has any.
  const start =
    view.pitch_version === 0 && view.suggested ? view.suggested : view.pitch;
  const [draft, setDraft] = useState(() => ({
    ...start,
    points: (start.points ?? []).join("\n"),
    website_url: start.website_url ?? "",
    contact: start.contact ?? "",
  }));
  const [errors, setErrors] = useState({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const save = async () => {
    setBusy(true);
    setMessage("");
    const r = await manageApi.savePitch(clan.clan_tag, draft, note || null);
    setBusy(false);
    if (!r.ok) {
      setErrors(r.data?.errors ?? {});
      setMessage(
        r.data?.errors ? "Fix the fields marked below." : "Save failed.",
      );
      return;
    }
    trackEvent("clan.recruit_saved", `v${r.data.version}`);
    onDone();
  };
  return (
    <div style={{ display: "grid", gap: "14px", maxWidth: "720px" }}>
      <div className="page-head">
        <h1 className="page__title">The pitch</h1>
        <span className="page-head__note">
          Your words; the numbers come from the game. Every save is a new
          version.
          {view.pitch_version === 0 && view.suggested
            ? " This first draft comes from what the clan is for: make it yours."
            : ""}
        </span>
      </div>
      {Object.entries(view.fields).map(([key, f]) => (
        <div key={key} style={{ display: "grid", gap: "4px" }}>
          <label
            className="field-label"
            htmlFor={`p-${key}`}
            style={{ fontWeight: 600 }}
          >
            {f.label}{" "}
            <span className="page-head__note">
              ({f.optional ? "optional, " : ""}
              {f.lines
                ? `up to ${f.max} characters a line`
                : `up to ${f.max} characters`}
              )
            </span>
          </label>
          {f.lines || f.max > 200 ? (
            <textarea
              id={`p-${key}`}
              className="input"
              rows={f.lines ? 7 : 4}
              value={draft[key] ?? ""}
              onChange={(e) => set(key, e.target.value)}
            />
          ) : (
            <input
              id={`p-${key}`}
              className="input"
              value={draft[key] ?? ""}
              maxLength={f.max}
              onChange={(e) => set(key, e.target.value)}
            />
          )}
          <span className="page-head__note">{f.why}</span>
          {errors[key] ? <p className="field-error">{errors[key]}</p> : null}
        </div>
      ))}
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
