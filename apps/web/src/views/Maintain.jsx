import { Markdown, ago } from "elixir-mcp/packages/ui/src/index.ts";
import { useEffect, useState } from "react";
import { feedbackApi } from "../api.js";
import { keys, useInvalidate, useMaintainQueue } from "../lib/queries.js";
import { trackEvent } from "../analytics.js";

/**
 * The maintainer's lane: the feedback queue, unread first, and one item
 * with the acts: a status and a Markdown reply the person sees on their
 * own list. Elixir's admin queue, carried. Who is a maintainer is the
 * stack's MaintainerTags parameter; the API refuses everyone else.
 */
const STATUSES = ["seen", "planned", "done", "declined"];
const TONE = { new: "chip--warn", planned: "chip--info", done: "chip--ok" };
const chip = (status) => `chip ${TONE[status] ?? ""}`;

export function MaintainQueue({ navigate }) {
  const queue = useMaintainQueue().data;
  const refused = queue?.status === 403;
  const items = queue?.ok ? (queue.data.feedback ?? []) : null;
  const [now] = useState(() => Date.now());
  if (refused)
    return (
      <div className="callout callout--warn" role="alert">
        <span>The maintainer&rsquo;s lane is for the maintainer.</span>
      </div>
    );
  const sorted = (items ?? [])
    .slice()
    .sort((a, b) =>
      a.status === "new" && b.status !== "new"
        ? -1
        : b.status === "new" && a.status !== "new"
          ? 1
          : 0,
    );
  return (
    <div>
      <div className="page-head" style={{ alignItems: "center" }}>
        <h1 className="page__title">Feedback queue</h1>
        <span className="page-head__note">
          Every item gets a reply; the reply lands on the person&rsquo;s own
          feedback page. Open one to answer it.
        </span>
      </div>
      {items === null ? (
        <p className="page__lede">Loading…</p>
      ) : items.length === 0 ? (
        <p className="page__lede">No feedback yet.</p>
      ) : (
        <div className="table__scroll">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>From</th>
                <th>Clan</th>
                <th>Category</th>
                <th>Said</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((f) => (
                <tr key={f.feedback_id}>
                  <td className="mono" title={f.created_at}>
                    {ago(f.created_at, now)}
                  </td>
                  <td>
                    {f.person_name ?? "—"}{" "}
                    <span className="tag">{f.person_tag}</span>
                  </td>
                  <td>
                    {f.context?.clan_tag ? (
                      <>
                        {f.context.clan_name ?? ""}{" "}
                        <span className="tag">{f.context.clan_tag}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{f.category.replaceAll("_", " ")}</td>
                  <td>
                    <a
                      href={`/maintain/feedback/${f.feedback_id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        navigate(`/maintain/feedback/${f.feedback_id}`);
                      }}
                    >
                      {f.message.length > 80
                        ? `${f.message.slice(0, 80)}…`
                        : f.message}
                    </a>
                  </td>
                  <td>
                    <span className={chip(f.status)}>
                      {f.status}
                      {f.response ? " · answered" : ""}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function MaintainItem({ id, navigate }) {
  const [response, setResponse] = useState("");
  const [shipped, setShipped] = useState("");
  const [saved, setSaved] = useState("");
  const queue = useMaintainQueue();
  const item =
    (queue.data?.data?.feedback ?? []).find((f) => f.feedback_id === id) ??
    null;
  const missed = queue.isFetched && !item;
  const invalidate = useInvalidate();
  const load = () => invalidate(keys.maintain);
  // The reply starts from the saved one, unless the maintainer is
  // mid-edit: a background reload must not eat typing.
  useEffect(() => {
    if (!item) return;
    setResponse((prev) => prev || item.response || "");
    setShipped((prev) => prev || item.shipped_in || "");
  }, [item]);
  if (missed)
    return (
      <div className="callout callout--warn">
        <span>
          No feedback item {id}.{" "}
          <a
            href="/maintain/feedback"
            onClick={(e) => (
              e.preventDefault(),
              navigate("/maintain/feedback")
            )}
          >
            All feedback ›
          </a>
        </span>
      </div>
    );
  if (!item) return <p className="page__lede">Loading…</p>;
  const act = async (status, withReply) => {
    setSaved("");
    const r = await feedbackApi.decide(item.feedback_id, {
      status,
      ...(withReply ? { response: response.trim() || undefined } : {}),
      ...(shipped.trim() ? { shipped_in: shipped.trim() } : {}),
    });
    if (r.ok) {
      trackEvent("clan.feedback_answered", status);
      setSaved(withReply ? "Reply sent." : "Status saved.");
      load();
    } else setSaved("That did not save.");
  };
  return (
    <div style={{ maxWidth: "70ch" }}>
      <p className="page-head__note" style={{ margin: "0 0 10px" }}>
        <a
          href="/maintain/feedback"
          onClick={(e) => (e.preventDefault(), navigate("/maintain/feedback"))}
        >
          ‹ All feedback
        </a>
      </p>
      <section className="panel">
        <div className="panel__head" style={{ gap: "8px", flexWrap: "wrap" }}>
          <span className="mono">fb_{item.feedback_id}</span>
          <span className="chip">{item.category.replaceAll("_", " ")}</span>
          <span className={chip(item.status)}>{item.status}</span>
          <span className="page-head__note" style={{ marginLeft: "auto" }}>
            {item.person_name ?? "?"}{" "}
            <span className="tag">{item.person_tag}</span>
            {item.context?.clan_tag
              ? ` · ${item.context.clan_name ?? item.context.clan_tag} (${item.context.role})`
              : ""}
            {item.context?.path ? ` · ${item.context.path}` : ""} ·{" "}
            {item.created_at.slice(0, 10)}
          </span>
        </div>
        <div className="panel__body">
          <Markdown className="prose" text={item.message} />
        </div>
        <div
          className="panel__body"
          style={{
            borderTop: "1px solid var(--line-soft)",
            display: "grid",
            gap: "10px",
          }}
        >
          <label style={{ display: "grid", gap: "4px" }}>
            <span className="field-label">
              Reply (Markdown; the person sees it)
            </span>
            <textarea
              className="input"
              rows={4}
              value={response}
              onChange={(e) => setResponse(e.target.value)}
            />
          </label>
          <label style={{ display: "grid", gap: "4px" }}>
            <span className="field-label">
              Shipped in (optional, free text)
            </span>
            <input
              className="input"
              value={shipped}
              onChange={(e) => setShipped(e.target.value)}
              placeholder="fourth push, 2026-09-13"
            />
          </label>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={`btn btn--sm${s === "done" ? " btn--primary" : ""}`}
                onClick={() => act(s, true)}
              >
                {s}
                {response.trim() ? " + reply" : ""}
              </button>
            ))}
          </div>
          {saved ? (
            <p className="page-head__note" style={{ margin: 0 }}>
              {saved}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
