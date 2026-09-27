import { Fresh } from "elixir-mcp/packages/ui/src/index.ts";
import { CATEGORY_LABELS } from "@elixir-clan/engine";
import { useWeek } from "../lib/queries.js";

const ROLE = {
  member: "Member",
  elder: "Elder",
  coLeader: "Co-leader",
  leader: "Leader",
};
const n = (x) => (x === null || x === undefined ? "—" : x.toLocaleString());
const date = (ts) =>
  ts
    ? new Date(ts).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : "";
const plural = (k, one, many = `${one}s`) => `${n(k)} ${k === 1 ? one : many}`;
const list = (items) =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

/** An area's headline: what the clan did together. */
function summary(a) {
  const took = a.participants.length;
  if (a.key === "war") {
    const parts = [plural(a.total, "deck"), "played"];
    if (a.points !== null && a.points !== undefined)
      parts.push(`· ${n(a.points)} points`);
    return parts.join(" ");
  }
  if (a.key === "donations")
    return `${plural(a.total, "card")} donated by ${plural(took, "member")}`;
  if (a.key === "ranked")
    return `${plural(a.total, "ranked battle")} by ${plural(took, "member")}`;
  return `${plural(a.total, "battle")} by ${plural(took, "member")}`;
}

function warLine(w) {
  const lines = [];
  if (w.is_colosseum) lines.push("Colosseum week: all four war days count.");
  else if (w.finished_early && w.finish_war_day)
    lines.push(
      `The boat crossed the finish line on war day ${w.finish_war_day}.`,
    );
  if (w.decks_asked)
    lines.push(
      `${plural(w.all_decks, "member")} played every deck asked (${w.decks_asked} each).`,
    );
  return lines.join(" ");
}

function Area({ a }) {
  return (
    <section className="panel mb-[18px]">
      <div className="panel__head flex-wrap gap-2">
        <span>{a.label}</span>
        <span className="page-head__note">{summary(a)}</span>
      </div>
      <div className="panel__body grid gap-2">
        {a.war ? <div className="page-head__note">{warLine(a.war)}</div> : null}
        {a.participants.length ? (
          <ul
            className="flex flex-wrap gap-2"
            aria-label={`${a.label}: who took part`}
          >
            {a.participants.map((p) => (
              <li
                key={p.player_tag}
                className={`chip ${p.all_decks ? "chip--ok" : ""}`.trim()}
                title={
                  p.all_decks
                    ? "Played every deck asked"
                    : p.joined_during
                      ? "Joined this week"
                      : undefined
                }
              >
                {p.name ?? p.player_tag} · {n(p.value)}
                {p.all_decks ? " ✓" : ""}
                {p.joined_during ? " · new" : ""}
              </li>
            ))}
          </ul>
        ) : (
          <div className="page-head__note">Nobody this week.</div>
        )}
      </div>
    </section>
  );
}

/** Why these areas are highlighted, in the clan's own terms. */
function basisLine(d) {
  const h = d.highlight;
  if (h.basis === "policy")
    return `Highlighted: what this clan counts (${list(
      h.counted.map((k) =>
        k === "battles"
          ? "Trophy road, shown as battles played"
          : (CATEGORY_LABELS[k] ?? k),
      ),
    )}).`;
  if (d.policy.active)
    return "This clan's policy counts no category, so the week highlights where the clan was busiest.";
  if (d.policy.set)
    return "Clan management is paused below 10 members, so the week highlights where the clan was busiest.";
  return "This clan's leaders have not set up how it runs yet, so the week highlights where the clan was busiest.";
}

/**
 * The week in the clan (2026-09-27): the latest closed week, or an earlier
 * one, for every member. What the clan did together, everyone who took
 * part by name, who came and went, and the week so far. Highlighted by
 * what the clan's policy counts, or where the clan was busiest.
 */
export function Week({ clan, week, navigate }) {
  const { state } = useWeek(clan.clan_tag, week);
  const d = state.data;
  const base = `/clan/${clan.clan_tag.slice(1)}/week`;
  const go = (path) => (e) => {
    e.preventDefault();
    navigate?.(path);
  };
  const head = (
    <div className="page-head items-center">
      <h1 className="page__title">The week</h1>
      {d?.week ? (
        <>
          <span className="page-head__note">
            {date(d.week.from)} to {date(d.week.to)} ·{" "}
            {d.clan_name ?? clan.name ?? clan.clan_tag}
          </span>
          {d.as_of ? (
            <Fresh label="as of" seconds={d.freshness_seconds} ts={d.as_of} />
          ) : null}
        </>
      ) : null}
    </div>
  );
  if (state.signedOut) {
    window.location.assign("/?error=session_expired");
    return null;
  }
  if (state.error)
    return (
      <>
        {head}
        <div className="callout callout--warn" role="alert">
          <span>
            {state.error === "clan_not_recorded"
              ? "Elixir is not recording this clan yet."
              : state.error === "no_week"
                ? "That week is not in the record, or has not closed yet."
                : "Elixir did not answer. Try again in a minute."}
          </span>
          {state.error === "no_week" ? (
            <a href={base} onClick={go(base)}>
              The latest week
            </a>
          ) : null}
        </div>
      </>
    );
  if (!d)
    return (
      <>
        {head}
        <p className="page__lede">Reading the week…</p>
      </>
    );
  const at = d.weeks.findIndex((w) => w.iso_week === d.week?.iso_week);
  const earlier = at >= 0 ? d.weeks[at + 1] : null;
  const later = at > 0 ? d.weeks[at - 1] : null;
  const weekPath = (w) => `${base}/${String(w.iso_week).toLowerCase()}`;
  const highlighted = d.week ? d.areas.filter((a) => a.highlighted) : [];
  const rest = d.week ? d.areas.filter((a) => !a.highlighted) : [];
  const m = d.membership;
  const changes = m
    ? m.joined.length + m.departed.length + m.promoted.length + m.demoted.length
    : 0;
  return (
    <>
      {head}
      {d.week ? (
        <>
          <p className="page__lede">
            The week closes at the Monday reset. {basisLine(d)}
          </p>
          <nav className="flex flex-wrap gap-3 mb-[18px]" aria-label="Weeks">
            {earlier ? (
              <a href={weekPath(earlier)} onClick={go(weekPath(earlier))}>
                ← Week of {date(earlier.from)}
              </a>
            ) : null}
            {later ? (
              <a href={weekPath(later)} onClick={go(weekPath(later))}>
                Week of {date(later.from)} →
              </a>
            ) : null}
          </nav>

          {highlighted.map((a) => (
            <Area key={a.key} a={a} />
          ))}
          {d.highlight.basis === "policy" && highlighted.length === 0 ? (
            <p className="page-head__note mb-[18px]">
              Nothing the clan counts was recorded this week.
            </p>
          ) : null}

          <section className="panel mb-[18px]">
            <div className="panel__head">
              <span>Who came and went</span>
            </div>
            <div className="panel__body grid gap-2">
              {m.joined.length ? (
                <div>
                  <span className="label">Joined</span>{" "}
                  {list(m.joined.map((x) => x.name ?? x.player_tag))}
                </div>
              ) : null}
              {m.departed.length ? (
                <div>
                  <span className="label">Departed</span>{" "}
                  {list(m.departed.map((x) => x.name ?? x.player_tag))}
                </div>
              ) : null}
              {m.promoted.length ? (
                <div>
                  <span className="label">Promoted</span>{" "}
                  {list(
                    m.promoted.map(
                      (x) =>
                        `${x.name ?? x.player_tag} to ${ROLE[x.role_after] ?? x.role_after}`,
                    ),
                  )}
                </div>
              ) : null}
              {m.demoted.length ? (
                <div>
                  <span className="label">Demoted</span>{" "}
                  {list(
                    m.demoted.map(
                      (x) =>
                        `${x.name ?? x.player_tag} to ${ROLE[x.role_after] ?? x.role_after}`,
                    ),
                  )}
                </div>
              ) : null}
              {changes === 0 && m.complete ? (
                <div className="page-head__note">
                  Nobody joined, departed or changed role.
                </div>
              ) : null}
              {!m.complete ? (
                <div className="page-head__note">
                  Elixir&rsquo;s recent roster events
                  {m.events_from
                    ? ` reach back to ${date(m.events_from)}`
                    : " do not cover this week"}
                  ; earlier changes are not shown.
                </div>
              ) : null}
            </div>
          </section>

          {rest.length ? (
            <details className="mb-[18px]">
              <summary className="label cursor-pointer mb-2">
                Also this week
              </summary>
              {rest.map((a) => (
                <Area key={a.key} a={a} />
              ))}
            </details>
          ) : null}
        </>
      ) : (
        <p className="page__lede">
          No week has closed in the record yet. The first one closes at the
          Monday reset.
        </p>
      )}

      {d.so_far && at <= 0 ? (
        <section className="mb-[18px]">
          <div className="label mb-2">
            This week so far (from {date(d.so_far.from)})
          </div>
          <div className="panel">
            <div className="panel__body fields">
              {d.so_far.areas.map((a) => (
                <span key={a.key} className="contents">
                  <span className="label">{a.label}</span>
                  <span>
                    {n(a.total)} ({plural(a.took_part, "member")})
                  </span>
                </span>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <p className="page-head__note">
        Numbers are for today&rsquo;s members: someone who has departed is not
        counted. Only those who took part are named.
      </p>
    </>
  );
}
