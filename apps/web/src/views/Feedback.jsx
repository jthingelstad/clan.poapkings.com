import { Markdown, ago } from "elixir-mcp/packages/ui/src/index.ts";
import { useState } from "react";
import { feedbackApi } from "../api.js";
import {
  useFeedbackItem,
  useFeedbackList,
  useInvalidate,
} from "../lib/queries.js";
import { trackEvent } from "../analytics.js";

/**
 * Feedback: what you have told us, and what we did about it. Elixir's
 * page, carried: a list (when, category, the first line, its state, a
 * reply mark), a compose panel, and the record with the note and the
 * maintainer's reply rendered as the Markdown they were written in.
 * Opening a record marks its reply seen.
 */
export const CATEGORIES = [
  "general",
  "bug",
  "judgment",
  "data_quality",
  "feature",
  "praise",
];
const TONE = { new: "chip--info", planned: "chip--warn", done: "chip--ok" };
const chip = (status) => `chip ${TONE[status] ?? ""}`;
const firstLine = (text, max = 72) => {
  const line =
    String(text ?? "")
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};

/** Where the note is written from, attached so a report about a page
 *  need not name the page. */
export function contextFrom(me, path) {
  return {
    path,
    clan_tag: me?.selected?.clan_tag ?? null,
    clan_name: me?.selected?.name ?? null,
    role: me?.selected?.role ?? null,
  };
}

function Compose({ context, onSent, onClose }) {
  const [category, setCategory] = useState("general");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState("");
  return (
    <section className="panel" style={{ marginBottom: "18px" }}>
      <div className="panel__head">
        <span>Send feedback</span>
        <button
          type="button"
          className="btn btn--sm"
          style={{ marginLeft: "auto" }}
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <div className="panel__body" style={{ display: "grid", gap: "10px" }}>
        {sent ? (
          <div className="notice">Received. Thank you: it is in the list.</div>
        ) : (
          <>
            <select
              className="input"
              style={{ width: "auto" }}
              aria-label="Category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.replaceAll("_", " ")}
                </option>
              ))}
            </select>
            {context?.clan_tag ? (
              <p className="page-head__note" style={{ margin: 0 }}>
                Written from {context.path} in{" "}
                {context.clan_name ?? context.clan_tag}; that rides along, you
                need not describe the page.
              </p>
            ) : null}
            <textarea
              className="input"
              rows={6}
              aria-label="Message"
              placeholder="A judgment that looks wrong, a bug, something missing, praise… Markdown is fine."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            {failed ? <p className="field-error">{failed}</p> : null}
            <div>
              <button
                type="button"
                className="btn btn--primary"
                disabled={!message.trim()}
                onClick={async () => {
                  const r = await feedbackApi.file({
                    message,
                    category,
                    context,
                  });
                  if (r.ok) {
                    trackEvent("clan.feedback_sent", category);
                    setSent(true);
                    onSent();
                  } else setFailed("Could not send that. Try again.");
                }}
              >
                Send
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

export function FeedbackItem({ id, navigate }) {
  const query = useFeedbackItem(id);
  const item = query.data ?? null;
  const missed = query.isError;
  if (missed)
    return (
      <div className="callout callout--warn">
        <span>
          No feedback item {id} on your account.{" "}
          <a
            href="/feedback"
            onClick={(e) => (e.preventDefault(), navigate("/feedback"))}
          >
            All feedback ›
          </a>
        </span>
      </div>
    );
  if (!item) return <p className="page__lede">Loading…</p>;
  return (
    <div style={{ maxWidth: "70ch" }}>
      <p className="page-head__note" style={{ margin: "0 0 10px" }}>
        <a
          href="/feedback"
          onClick={(e) => (e.preventDefault(), navigate("/feedback"))}
        >
          ‹ Feedback
        </a>
      </p>
      <div className="page-head" style={{ alignItems: "center", gap: "10px" }}>
        <h1 className="page__title mono" style={{ fontSize: "20px" }}>
          fb_{item.feedback_id}
        </h1>
        <span className={chip(item.status)}>{item.status}</span>
        <span className="page-head__note">
          {item.category.replaceAll("_", " ")} · {item.created_at.slice(0, 10)}
          {item.context?.clan_tag ? ` · from ${item.context.path}` : ""}
        </span>
        {item.shipped_in ? (
          <span className="chip">shipped: {item.shipped_in}</span>
        ) : null}
      </div>
      <Markdown className="prose mb-[22px]" text={item.message} />
      {item.response ? (
        <section
          style={{
            borderLeft: "2px solid var(--accent-bright)",
            padding: "2px 0 2px 16px",
          }}
        >
          <div className="label" style={{ marginBottom: "8px" }}>
            Maintainer
            {item.responded_at ? ` · ${item.responded_at.slice(0, 10)}` : ""}
          </div>
          <Markdown className="prose" text={item.response} />
        </section>
      ) : (
        <p className="page__lede" style={{ margin: 0 }}>
          No reply yet. A filed note cannot be edited; send another if something
          changed.
        </p>
      )}
    </div>
  );
}

export function Feedback({ me, navigate, from }) {
  const items = useFeedbackList().data?.feedback ?? null;
  const [composing, setComposing] = useState(false);
  const [now] = useState(() => Date.now());
  const invalidate = useInvalidate();
  // A filed note moves the rail's dot too: the session refetches with it.
  const load = () => invalidate();
  return (
    <div>
      <div className="page-head" style={{ alignItems: "center" }}>
        <h1 className="page__title">Feedback</h1>
        <span className="page-head__note">
          What you have told us, and what we did about it. Every item gets a
          reply; nothing is actioned invisibly.
        </span>
        <button
          type="button"
          className="btn btn--primary"
          style={{ marginLeft: "auto" }}
          onClick={() => setComposing((v) => !v)}
        >
          Send feedback
        </button>
      </div>
      {composing ? (
        <Compose
          context={contextFrom(me, from ?? "/feedback")}
          onSent={load}
          onClose={() => setComposing(false)}
        />
      ) : null}
      {items === null ? (
        <p className="page__lede">Loading…</p>
      ) : items.length === 0 ? (
        <p className="page__lede">Nothing filed yet.</p>
      ) : (
        <div className="table__scroll">
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>When</th>
                <th>Category</th>
                <th>Said</th>
                <th>State</th>
                <th>Reply</th>
              </tr>
            </thead>
            <tbody>
              {items.map((f) => (
                <tr key={f.feedback_id}>
                  <td className="mono">
                    <a
                      href={`/feedback/${f.feedback_id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        navigate(`/feedback/${f.feedback_id}`);
                      }}
                    >
                      fb_{f.feedback_id}
                    </a>
                  </td>
                  <td className="mono" title={f.created_at}>
                    {ago(f.created_at, now)}
                  </td>
                  <td>{f.category.replaceAll("_", " ")}</td>
                  <td title={f.message}>{firstLine(f.message)}</td>
                  <td>
                    <span className={chip(f.status)}>{f.status}</span>
                  </td>
                  <td>
                    {f.response ? (
                      <span
                        className={`chip${f.response_seen_at ? "" : " chip--info"}`}
                      >
                        {f.response_seen_at ? "replied" : "new reply"}
                      </span>
                    ) : (
                      "—"
                    )}
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
