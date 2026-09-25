import { Fresh, Icon, ago } from "elixir-mcp/packages/ui/src/index.ts";
import { LEADER_MESSAGE, chatWarnings } from "@elixir-clan/engine";
import { useState } from "react";
import { manageApi } from "../api.js";
import { trackEvent } from "../analytics.js";
import { MemberSheet } from "./MemberSheet.jsx";
import { RoleChip } from "./RoleChip.jsx";

/**
 * One action (Jamie, 2026-09-25): what Elixir Clan suggests someone in the
 * clan do, assigned to them or open to their role, completed or declined.
 * Every action shows its log: what raised it, who took it and how, what
 * the record confirmed, and anyone's comments, open or closed.
 */

const LEADER_TYPES = new Set(["promotion", "demotion", "removal"]);
const STATUS = {
  done: ["Completed", "chip--ok"],
  declined: ["Declined", "chip--warn"],
  withdrawn: ["Withdrawn", ""],
};
const KIND = {
  raised: "Suggested",
  completed: "Completed",
  declined: "Declined",
  withdrawn: "Withdrawn",
  outcome_verified: "Confirmed by the record",
  outcome_flagged: "Flagged: no change seen",
  comment: "Comment",
  emailed: "Emailed",
  shared: "Shared with Elixir",
  not_shared: "Not shared with Elixir",
};
const CLASSIFIED = {
  member_kicked: "said: kicked",
  member_left: "said: left",
  ignored: "said: ignore",
};
const when = (ts) => (ts ? ts.slice(0, 16).replace("T", " ") : "");

/** A person's word on a decision, kept in the action's log. */
export function NoteInput({
  value,
  onChange,
  placeholder = "note (optional)",
}) {
  return (
    <input
      className="input basis-full"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={280}
    />
  );
}

/** Paste-ready in-game copy for clan chat; `event` and `value` name the
 *  copy for the analytics taxonomy. */
export function CopyLine({ text, event = "clan.copy_in_game", value }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-start gap-2 rounded-lg border border-[var(--line-soft)] bg-[var(--ground-sunken)] px-2.5 py-2 text-[13px]">
      <span className="flex-auto">{text}</span>
      <button
        type="button"
        className="btn btn--sm"
        title="Copy for clan chat"
        aria-label="Copy for clan chat"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            trackEvent(event, value);
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          } catch {
            // The line is on screen to select by hand.
          }
        }}
      >
        <Icon name={done ? "check" : "copy"} size={14} />
      </button>
    </div>
  );
}

/** One field of a Clan Leader Message: editable, counted, copyable, and
 *  warned when an edit holds what the game's filter blanks. */
function MessageField({ label, value, onChange, max, rows = 1 }) {
  const [done, setDone] = useState(false);
  const over = value.length > max;
  const warnings = chatWarnings(value, max).filter(
    (w) => !w.startsWith("longer"),
  );
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2">
        <span className="label">{label}</span>
        <span className={`page-head__note ${over ? "text-[var(--bad)]" : ""}`}>
          {value.length}/{max}
        </span>
        <button
          type="button"
          className="btn btn--sm ml-auto"
          aria-label={`Copy the ${label.toLowerCase()}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              trackEvent("clan.copy_in_game", "leader_message");
              setDone(true);
              setTimeout(() => setDone(false), 1500);
            } catch {
              // The text is on screen to select by hand.
            }
          }}
        >
          <Icon name={done ? "check" : "copy"} size={14} />
        </button>
      </div>
      {rows > 1 ? (
        <textarea
          className="input"
          aria-label={label}
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className="input"
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {warnings.length ? (
        <div className="page-head__note text-[var(--warn)]" role="status">
          The game may blank or garble this: {warnings.join("; ")}.
        </div>
      ) : null}
    </div>
  );
}

/** A Clan Leader Message ready to send in the game: a title and a message,
 *  each within the game's limit, edited before copying. The card holds
 *  the words (`value`/`onChange`) so completing the action can say what
 *  was sent; on its own it keeps them itself. */
export function LeaderMessage({ message, value = null, onChange = null }) {
  const [own, setOwn] = useState({
    title: message?.title ?? "",
    body: message?.body ?? "",
  });
  const words = value ?? own;
  const change = onChange ?? setOwn;
  const title = words.title;
  const body = words.body;
  const setTitle = (t) => change({ ...words, title: t });
  const setBody = (b) => change({ ...words, body: b });
  return (
    <div className="grid gap-2 rounded-lg border border-[var(--line-soft)] bg-[var(--ground-sunken)] p-2.5">
      <div className="page-head__note">
        Clan Leader Message: in the game, Clan → the leader message button; only
        leaders and co-leaders can send one, and it stays in every
        member&rsquo;s Inbox.
      </div>
      <MessageField
        label="Title"
        value={title}
        onChange={setTitle}
        max={LEADER_MESSAGE.title}
      />
      <MessageField
        label="Message"
        value={body}
        onChange={setBody}
        max={LEADER_MESSAGE.body}
        rows={3}
      />
    </div>
  );
}

/** Who wrote a log entry. */
function By({ by }) {
  if (!by || by.system) return <span>Elixir Clan</span>;
  return (
    <span>
      {by.name ?? by.tag}
      {by.role ? ` (${by.role})` : ""}
    </span>
  );
}

/** An action's log, oldest first, and a place to add to it. */
export function ActionLog({ action, clan, onChanged }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const add = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    const r = await manageApi.commentAction(
      clan.clan_tag,
      action.card_id,
      text.trim(),
    );
    setBusy(false);
    if (!r.ok) return setError("That did not save.");
    trackEvent("clan.action_commented", action.type);
    setText("");
    onChanged?.();
  };
  return (
    <div className="grid gap-2">
      <ol className="m-0 grid list-none gap-2 p-0">
        {(action.log ?? []).map((e, i) => (
          <li key={e.entry_id ?? `${e.kind}-${i}`} className="text-[13.5px]">
            <div className="page-head__note">
              {when(e.at)} · <By by={e.by} /> · {KIND[e.kind] ?? e.kind}
              {e.detail?.reconstructed ? " (from the action's own record)" : ""}
            </div>
            {e.text ? <div>{e.text}</div> : null}
            {e.detail?.reason ? (
              <div className="page-head__note">
                reason: {e.detail.reason.replaceAll("_", " ")}
              </div>
            ) : null}
            {e.detail?.classification ? (
              <div className="page-head__note">
                {CLASSIFIED[e.detail.classification] ?? e.detail.classification}
              </div>
            ) : null}
            {e.kind === "raised" && e.detail?.facts?.length ? (
              <ul className="m-0 pl-[18px] text-[var(--ink-body)]">
                {e.detail.facts.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            ) : null}
            {e.kind === "raised" && e.detail?.clauses?.length ? (
              <div className="page-head__note">
                policy v{e.detail.policy_version ?? "?"}:{" "}
                {e.detail.clauses.join(", ")}
              </div>
            ) : null}
            {e.kind === "raised" && e.detail?.prior?.length ? (
              <div className="page-head__note">
                Earlier:{" "}
                {e.detail.prior
                  .map(
                    (p) =>
                      `${STATUS[p.status]?.[0]?.toLowerCase() ?? p.status} ${(p.closed_at ?? p.raised_at).slice(0, 10)}${p.reason ? ` (${p.reason.replaceAll("_", " ")})` : ""}`,
                  )
                  .join("; ")}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      <form className="flex flex-wrap gap-2" onSubmit={add}>
        <input
          className="input flex-[1_1_240px]"
          placeholder="Add a comment to this action's log"
          aria-label="Comment"
          value={text}
          maxLength={1000}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn btn--sm" disabled={busy}>
          Add
        </button>
      </form>
      {error ? <div className="field-error">{error}</div> : null}
    </div>
  );
}

/** One action, open or closed, with its buttons and its log. */
export function ActionCard({
  action,
  clan,
  who,
  reasons,
  onChanged,
  navigate,
}) {
  const [reason, setReason] = useState("not_now");
  const [note, setNote] = useState("");
  const [declining, setDeclining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState(false);
  const open = action.status === "proposed";
  const mine = action.audience?.kind === "member";
  const ev = action.evidence ?? {};
  // The words as the person edits them, sent with a completion so what
  // the clan shares with Elixir is what was said in the game.
  const [words, setWords] = useState({
    title: action.message?.title ?? "",
    body: action.message?.body ?? "",
  });
  const decide = async (status, extra = {}) => {
    setBusy(true);
    setError("");
    const r = await manageApi.decideAction(clan.clan_tag, action.card_id, {
      status,
      reason:
        status === "declined" && LEADER_TYPES.has(action.type) ? reason : null,
      note: note || null,
      ...(status === "done" && action.message
        ? { sent: { title: words.title, body: words.body } }
        : status === "done" && action.copy && action.type === "welcome"
          ? { sent: { line: action.copy } }
          : {}),
      ...extra,
    });
    setBusy(false);
    if (!r.ok)
      return setError(
        r.data?.error === "action_closed"
          ? "This action was already taken or withdrawn."
          : "That did not work.",
      );
    trackEvent(
      "clan.action_decided",
      `${action.type}:${extra.classification ?? status}`,
    );
    onChanged?.();
  };
  return (
    <div className="panel" data-action={action.card_id}>
      <div className="panel__head flex-wrap gap-2">
        {mine ? (
          <span>
            <span className="yours">★</span> You
          </span>
        ) : !action.player_tag ? (
          <span>The clan</span>
        ) : (
          <>
            <span>{action.player_name ?? action.player_tag}</span>
            <span className="tag">{action.player_tag}</span>
            {action.role_at_raise ? (
              <RoleChip
                role={action.role_at_raise}
                label={action.role_at_raise}
              />
            ) : null}
          </>
        )}
        <span className="ml-auto">
          {open ? (
            ev.as_of ? (
              <Fresh label="evidence as of" ts={ev.as_of} />
            ) : (
              <span className="page-head__note">
                suggested {ago(action.raised_at)}
              </span>
            )
          ) : (
            <span className={`chip ${STATUS[action.status]?.[1] ?? ""}`}>
              {STATUS[action.status]?.[0] ?? action.status}
            </span>
          )}
        </span>
      </div>
      <div className="panel__body grid gap-2.5">
        <div className="font-semibold">{action.label}</div>
        {action.type === "departure" ? (
          <div>
            Left the clan {ago(ev.left_at)} ({ev.left_at?.slice(0, 10)})
            {ev.removal_state && ev.removal_state !== "none"
              ? ` · was ${ev.removal_state.replaceAll("_", " ")} on the clock`
              : ""}
            {ev.days_idle != null
              ? ` · ${Math.round(ev.days_idle)} days since their last battle`
              : ""}
            {ev.tenure_days != null
              ? ` · ${ev.tenure_days} days in the clan`
              : ""}
            . A leave and a kick look the same in the record; say which so the
            clan&rsquo;s history knows.
          </div>
        ) : action.type === "welcome" ? (
          <div>
            Joined {ago(ev.joined_at)}. Welcome them in clan chat, then mark it
            done.
          </div>
        ) : action.type === "away" ? (
          <div>
            You have not played in {Math.floor(ev.days_idle ?? 0)} days. Going
            to be away? Mark it and your inactivity clock pauses
            {ev.away_max_days ? ` (up to ${ev.away_max_days} days)` : ""}.
          </div>
        ) : action.type === "awards_announcement" ? (
          <div>
            Season {ev.season_id} is closed and its awards are granted. Tell the
            clan with a Clan Leader Message, then mark it sent.
          </div>
        ) : action.type === "rules_announcement" ? (
          <div>
            {ev.changes?.length
              ? `Policy version ${ev.version} changed: ${ev.changes.join(", ")}.`
              : `Policy version ${ev.version}: the clan's first.`}{" "}
            Tell the clan with a Clan Leader Message, then mark it sent.
          </div>
        ) : (
          <div>{ev.rationale?.headline}</div>
        )}
        {open && (action.type === "promotion" || action.type === "demotion") ? (
          <div className="page-head__note">
            In the game: {action.type === "promotion" ? "promote" : "demote"}{" "}
            {action.player_name ?? action.player_tag}, send this Clan Leader
            Message, then mark it complete. They go together.
          </div>
        ) : null}
        {action.copy && open ? <CopyLine text={action.copy} /> : null}
        {action.message && open ? (
          <LeaderMessage
            message={action.message}
            value={words}
            onChange={setWords}
          />
        ) : null}
        {LEADER_TYPES.has(action.type) && ev.facts?.length ? (
          <ul className="m-0 pl-[18px] text-[13.5px] text-[var(--ink-body)]">
            {ev.facts.map((f) => (
              <li key={f.key}>
                <span className="label mr-1.5">{f.label}</span>
                {f.value}{" "}
                <span className="page-head__note">
                  ({f.window}
                  {f.fidelity !== "daily" ? `, ${f.fidelity}` : ""})
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {!open ? (
          <div className="page-head__note">
            {action.status === "withdrawn"
              ? `${action.withdraw_reason ?? "Withdrawn"} · ${action.withdrawn_at?.slice(0, 10) ?? ""}`
              : `${action.decided_by_name ?? action.decided_by ?? ""} · ${action.decided_at?.slice(0, 10) ?? ""}`}
            {action.outcome?.verified_at ? " · confirmed by the record" : ""}
            {action.outcome?.flagged_at ? " · no change seen" : ""}
          </div>
        ) : null}

        {open && action.can_act ? (
          action.type === "departure" ? (
            <div className="flex flex-wrap gap-2">
              <NoteInput
                value={note}
                onChange={setNote}
                placeholder="why, for the log (optional)"
              />
              <button
                type="button"
                className="btn btn--danger"
                disabled={busy}
                onClick={() => decide("done", { classification: "kick" })}
              >
                Kicked
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={() => decide("done", { classification: "leave" })}
              >
                Left
              </button>
              <button
                type="button"
                className="btn btn--quiet"
                disabled={busy}
                onClick={() => decide("done", { classification: "ignore" })}
              >
                Ignore
              </button>
            </div>
          ) : action.type === "away" ? (
            <div className="flex flex-wrap gap-2">
              <a
                className="btn btn--primary"
                href="/you/away"
                onClick={(e) => {
                  e.preventDefault();
                  navigate?.("/you/away");
                }}
              >
                Mark me away
              </a>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => decide("declined")}
              >
                I&rsquo;m not away
              </button>
            </div>
          ) : action.type === "awards_announcement" ||
            action.type === "rules_announcement" ? (
            <div className="flex flex-wrap gap-2">
              <NoteInput value={note} onChange={setNote} />
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={() => decide("done")}
              >
                Sent
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => decide("declined")}
              >
                Skip
              </button>
            </div>
          ) : action.type === "welcome" ? (
            <div className="flex flex-wrap gap-2">
              <NoteInput value={note} onChange={setNote} />
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={() => decide("done")}
              >
                Welcomed
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => decide("declined")}
              >
                Skip
              </button>
            </div>
          ) : !declining ? (
            <div className="flex flex-wrap gap-2">
              <NoteInput value={note} onChange={setNote} />
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={() => decide("done")}
              >
                Complete
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => setDeclining(true)}
              >
                Decline
              </button>
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => setSheet((v) => !v)}
              >
                Notes & hold
              </button>
            </div>
          ) : (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                decide("declined");
              }}
            >
              <select
                className="select"
                aria-label="Why decline"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              >
                {(reasons ?? []).map((r) => (
                  <option key={r} value={r}>
                    {r.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
              <NoteInput value={note} onChange={setNote} />
              <button type="submit" className="btn btn--danger" disabled={busy}>
                Decline
              </button>
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => setDeclining(false)}
              >
                Back
              </button>
            </form>
          )
        ) : null}
        {sheet ? (
          <MemberSheet
            clanTag={clan.clan_tag}
            member={{
              player_tag: action.player_tag,
              name: action.player_name,
              role: action.role_at_raise,
              hold: null,
            }}
            role={who.role}
            onChange={onChanged}
          />
        ) : null}
        {error ? (
          <div className="callout callout--warn" role="alert">
            <span>{error}</span>
          </div>
        ) : null}
        <details>
          <summary className="page-head__note cursor-pointer">
            Log · {(action.log ?? []).length}{" "}
            {(action.log ?? []).length === 1 ? "entry" : "entries"}
          </summary>
          <div className="mt-2">
            <ActionLog action={action} clan={clan} onChanged={onChanged} />
          </div>
        </details>
      </div>
    </div>
  );
}
