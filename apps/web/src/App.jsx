import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { Chrome } from "./components/Chrome.jsx";
import { Disclaimer } from "./components/Disclaimer.jsx";
import { Clan } from "./views/Clan.jsx";
import { Clans } from "./views/Clans.jsx";
import { HowElderWorks } from "./views/HowElderWorks.jsx";
import { Manage } from "./views/Manage.jsx";
import { Standing } from "./views/Standing.jsx";
import { Landing } from "./views/Landing.jsx";
import { Refused } from "./views/Refused.jsx";
import { You } from "./views/You.jsx";

/**
 * Routes: `/` (landing, signed out), `/clans` (the chooser), `/clan/<TAG>`
 * (a clan page; the tag without its #), `/clan` (the remembered clan),
 * `/you`, `/refused/<reason>`. A path-based router in twenty lines: the
 * app has five places and one parameter.
 */
function usePath() {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  const navigate = useCallback((to) => {
    window.history.pushState(null, "", to);
    setPath(to);
  }, []);
  return [path, navigate];
}

export const clanPath = (tag) => `/clan/${String(tag).replace(/^#/, "")}`;

/** `/clan/<TAG>[/<section>[/<tab>]]` parsed: the tag with its #, the
 *  section (roster by default) and the Manage tab. */
export function parseClanPath(path) {
  const m =
    /^\/clan\/([0-9A-Za-z]{3,12})(?:\/(manage|standing|how-elder-works)(?:\/([a-z-]+))?)?\/?$/.exec(
      path,
    );
  if (!m) return null;
  return {
    tag: `#${m[1].toUpperCase().replace(/O/g, "0")}`,
    section: m[2] ?? "roster",
    tab: m[3] ?? null,
  };
}

/** The clan a `/clan/<TAG>...` path names, if it is one of the person's. */
export function clanFromPath(path, clans = []) {
  const parsed = parseClanPath(path);
  if (!parsed) return null;
  return clans.find((c) => c.clan_tag === parsed.tag) ?? null;
}

export function App() {
  const [path, navigate] = usePath();
  const [me, setMe] = useState(null); // null = not asked yet
  const [checking, setChecking] = useState(false);
  const [selecting, setSelecting] = useState(false);

  const refresh = useCallback(async (force = false) => {
    setChecking(true);
    const r = await api.me(force);
    setChecking(false);
    if (r.status === 401)
      return setMe({
        signed_in: false,
        expired: r.data?.reason === "session_expired",
      });
    if (!r.ok) return setMe({ signed_in: true, unavailable: true });
    setMe(r.data);
    return r.data;
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const select = useCallback(
    async (tag) => {
      setSelecting(true);
      const r = await api.select(tag);
      setSelecting(false);
      if (r.ok) {
        setMe(r.data);
        navigate(clanPath(tag));
      } else if (r.status === 401) {
        setMe({ signed_in: false, expired: true });
      }
    },
    [navigate],
  );

  // The one page that needs no sign-in.
  const publicPage = parseClanPath(path)?.section === "how-elder-works";

  // Where a signed-in person belongs, whatever address they arrived at.
  useEffect(() => {
    if (!me || publicPage) return;
    if (!me.signed_in) {
      if (path !== "/") navigate(me.expired ? "/?error=session_expired" : "/");
      return;
    }
    if (me.unavailable) return;
    if (!me.ok) {
      if (!path.startsWith("/refused/") && path !== "/you")
        navigate(`/refused/${me.reason}`);
      return;
    }
    const atClan = clanFromPath(path, me.clans);
    if (path === "/" || path.startsWith("/refused") || path === "/clan") {
      navigate(me.selected ? clanPath(me.selected.clan_tag) : "/clans");
    } else if (path.startsWith("/clan/") && !atClan) {
      navigate("/clans");
    } else if (
      atClan &&
      me.selected?.clan_tag !== atClan.clan_tag &&
      !selecting
    ) {
      // Arriving at another of your clans by URL selects it, so the
      // remembered clan follows where you actually went.
      select(atClan.clan_tag);
    }
  }, [me, path, navigate, select, selecting, publicPage]);

  const error = new URLSearchParams(window.location.search).get("error");
  let view = null;
  if (publicPage) view = <HowElderWorks tag={parseClanPath(path).tag} />;
  else if (me === null) view = null;
  else if (!me.signed_in) view = <Landing error={error} />;
  else if (me.unavailable)
    view = (
      <div
        className="callout callout--warn"
        role="alert"
        style={{ maxWidth: "560px", margin: "40px auto 0" }}
      >
        <span>
          Elixir did not answer. Your sign-in is fine; try again in a minute.
        </span>
      </div>
    );
  else if (path === "/you") view = <You me={me} />;
  else if (path.startsWith("/refused/"))
    view = (
      <Refused
        reason={path.slice("/refused/".length)}
        me={me}
        checking={checking}
        onRecheck={async () => {
          const next = await refresh(true);
          if (next?.ok)
            navigate(
              next.selected ? clanPath(next.selected.clan_tag) : "/clans",
            );
          else if (next?.reason) navigate(`/refused/${next.reason}`);
        }}
      />
    );
  else if (me.ok && path === "/clans")
    view = <Clans me={me} onSelect={select} selecting={selecting} />;
  else if (me.ok) {
    const clan = clanFromPath(path, me.clans);
    const parsed = parseClanPath(path);
    const who = clan
      ? {
          player_tag: clan.acting_as,
          name: clan.acting_as_name,
          role: clan.role,
        }
      : null;
    if (!clan) view = null;
    else if (parsed.section === "manage")
      view = (
        <Manage
          key={clan.clan_tag}
          clan={clan}
          tab={parsed.tab ?? "inbox"}
          navigate={navigate}
          who={who}
        />
      );
    else if (parsed.section === "standing")
      view = <Standing key={clan.clan_tag} clan={clan} who={who} />;
    else
      view = (
        <Clan key={clan.clan_tag} me={me} clan={clan} navigate={navigate} />
      );
  }

  return (
    <div className="shell">
      <Chrome me={me} navigate={navigate} path={path} />
      <main
        className="page"
        style={{ maxWidth: "var(--page-max)", margin: "0 auto", width: "100%" }}
      >
        <div
          className="page__inner page__inner--solo"
          style={{ maxWidth: "var(--page-max)" }}
        >
          {view}
        </div>
      </main>
      <Disclaimer />
    </div>
  );
}
