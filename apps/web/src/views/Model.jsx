import { ago } from "elixir-mcp/packages/ui/src/index.ts";
import { useState } from "react";
import { manageApi } from "../api.js";
import { useModel } from "../lib/queries.js";
import { trackEvent } from "../analytics.js";

const day = (ts) => (ts ? ts.slice(0, 10) : "");
const n = (x) => (x === null || x === undefined ? "—" : x.toLocaleString());

/**
 * The clan's own model (2026-09-25): bring your own tokens. A leader or
 * co-leader adds the clan's Anthropic API key; the clan's model then
 * drafts words (the recruiting pitch today) for a leader to edit, never a
 * judgment about a member. The key is checked with Anthropic, kept
 * sealed and never shown again; it is used only while the person who
 * added it leads the clan, and every use is listed here.
 */
export function Model({ clan }) {
  const { state, load } = useModel(clan.clan_tag);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  if (state.signedOut) {
    window.location.assign("/?error=session_expired");
    return null;
  }
  if (state.forbidden)
    return (
      <div className="callout callout--warn" role="alert">
        <span>The clan&rsquo;s model is for the leader and co-leaders.</span>
      </div>
    );
  if (state.error)
    return (
      <div className="callout callout--warn" role="alert">
        <span>Elixir Clan did not answer. Try again in a minute.</span>
      </div>
    );
  const d = state.data;
  if (!d) return <p className="page__lede">Reading…</p>;

  const saveKey = async (e) => {
    e.preventDefault();
    if (!key.trim()) return;
    setBusy(true);
    setMessage("");
    const r = await manageApi.setModelKey(clan.clan_tag, key.trim());
    setBusy(false);
    // The key leaves the page either way: it is never kept in the browser.
    setKey("");
    if (!r.ok) {
      setMessage(
        r.data?.message ?? "Anthropic did not answer. Try again in a minute.",
      );
      return;
    }
    trackEvent("clan.model_key_set");
    load();
  };
  const choose = async (model) => {
    setBusy(true);
    const r = await manageApi.chooseModel(clan.clan_tag, model);
    setBusy(false);
    if (!r.ok) setMessage(r.data?.message ?? "That did not save.");
    load();
  };
  const remove = async () => {
    if (!window.confirm("Remove the clan's key? Nothing will use it again."))
      return;
    setBusy(true);
    await manageApi.removeModelKey(clan.clan_tag);
    setBusy(false);
    trackEvent("clan.model_key_removed");
    load();
  };

  return (
    <div className="grid max-w-[720px] gap-4">
      <p className="page__lede m-0">
        Elixir Clan pays for no model. With your clan&rsquo;s own Anthropic key,
        a model drafts words for the clan (today, the recruiting pitch in
        Recruit), never a judgment about a member. It is told the game&rsquo;s
        numbers for the clan, what the clan is for, how it runs and its own
        words, never a member&rsquo;s name or numbers. Everything it writes is a
        draft a leader edits and saves.
      </p>

      {d.set ? (
        <section className="panel">
          <div className="panel__head flex-wrap gap-2">
            <span>The clan&rsquo;s key</span>
            <span
              className={`chip ${d.usable ? "chip--ok" : "chip--warn"}`}
              role="status"
            >
              {d.usable ? "in use" : "not in use"}
            </span>
          </div>
          <div className="panel__body fields">
            <span className="label">Key</span>
            <span>
              <code>{d.hint}</code>
            </span>
            <span className="label">Added by</span>
            <span>
              {d.set_by_name ?? d.set_by} · {day(d.set_at)}
            </span>
            <span className="label">Model</span>
            <span>
              <select
                className="input"
                aria-label="Model"
                value={d.model}
                disabled={busy}
                onChange={(e) => choose(e.target.value)}
              >
                {d.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </span>
            <span className="label">Today</span>
            <span>
              {d.uses.today} of {d.per_day} uses
            </span>
            <span className="label">This month</span>
            <span>
              {d.uses.month.count} uses · {n(d.uses.month.input_tokens)} tokens
              in, {n(d.uses.month.output_tokens)} out
            </span>
          </div>
          {d.refused_at ? (
            <div className="callout callout--warn m-3" role="alert">
              <span>
                Anthropic stopped accepting this key on {day(d.refused_at)}. Add
                it again, or a new one, below.
              </span>
            </div>
          ) : !d.readable ? (
            <div className="callout callout--warn m-3" role="alert">
              <span>This key needs to be added again.</span>
            </div>
          ) : d.owner_leads === false ? (
            <div className="callout callout--warn m-3" role="alert">
              <span>
                {d.set_by_name ?? d.set_by} added this key and no longer leads
                the clan, so it is not used. Add your own below, or remove it.
              </span>
            </div>
          ) : null}
          <div className="panel__body pt-0">
            <button
              type="button"
              className="btn btn--sm"
              disabled={busy}
              onClick={remove}
            >
              Remove the key
            </button>
          </div>
        </section>
      ) : null}

      <form className="grid gap-2" onSubmit={saveKey}>
        <label className="field-label font-semibold" htmlFor="model-key">
          {d.set ? "Replace it with a key of yours" : "Add the clan's key"}
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="model-key"
            className="input flex-[1_1_280px]"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy || !key.trim()}
          >
            {busy ? "Checking…" : "Check and save"}
          </button>
        </div>
        {message ? (
          <p className="field-error m-0" role="alert">
            {message}
          </p>
        ) : null}
        <p className="page-head__note m-0">
          An API key from the Anthropic Console. It is checked with Anthropic
          (which spends nothing), kept encrypted and never shown again, and used
          only while you lead this clan: your Anthropic account pays for each
          use, so set a spend limit there. At most {d.per_day} uses a day.
        </p>
      </form>

      {d.uses.recent.length ? (
        <section>
          <div className="label mb-2">Recent uses</div>
          <div className="table__scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>By</th>
                  <th>For</th>
                  <th>Tokens</th>
                </tr>
              </thead>
              <tbody>
                {d.uses.recent.map((u) => (
                  <tr key={`${u.at}-${u.by}`}>
                    <td>{ago(u.at)}</td>
                    <td>{u.by_name ?? u.by}</td>
                    <td>
                      {d.purposes[u.purpose]?.label ?? u.purpose}
                      {u.ok ? "" : ` (failed${u.code ? `: ${u.code}` : ""})`}
                    </td>
                    <td>
                      {n(u.input_tokens)} in · {n(u.output_tokens)} out
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="page-head__note">Kept {d.keep_days} days.</p>
        </section>
      ) : null}
    </div>
  );
}
