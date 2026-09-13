import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { createQueryClient } from "elixir-mcp/packages/client/src/index.ts";
import {
  Chrome as ChromeBar,
  Disclaimer,
  ErrorBoundary,
  Icon,
  Rail as RailList,
  RailIdentity,
} from "elixir-mcp/packages/ui/src/index.ts";
import { api } from "./api.js";
import { keys, useMeQuery } from "./lib/queries.js";
import { railItems, railKey } from "./lib/rail.js";
import { RoleChip } from "./components/RoleChip.jsx";
import { Clan } from "./views/Clan.jsx";
import { Clans } from "./views/Clans.jsx";
import { HowElderWorks } from "./views/HowElderWorks.jsx";
import { Manage } from "./views/Manage.jsx";
import { Standing } from "./views/Standing.jsx";
import { Landing } from "./views/Landing.jsx";
import { Refused } from "./views/Refused.jsx";
import { You } from "./views/You.jsx";
import { Away } from "./views/Away.jsx";
import { Recruit } from "./views/Recruit.jsx";
import { Feedback, FeedbackItem } from "./views/Feedback.jsx";
import { MaintainItem, MaintainQueue } from "./views/Maintain.jsx";

/**
 * Routes: `/` (landing, signed out), `/clans` (the chooser), `/clan/<TAG>`
 * (a clan page; the tag without its #) with its sections and Manage tabs,
 * `/you` and `/you/away`, `/refused/<reason>`, `/feedback[/<id>]`,
 * `/maintain/feedback[/<id>]`. The router owns history and params; the
 * GATE - where a signed-in person belongs, whatever address they arrived
 * at - is the Shell's effect below, because it is a session state
 * machine (a refresh, a select) and not a per-route loader.
 */

export const clanPath = (tag) => `/clan/${String(tag).replace(/^#/, "")}`;

/** `/clan/<TAG>[/<section>[/<tab>]]` parsed: the tag with its #, the
 *  section (roster by default) and the Manage tab. */
export function parseClanPath(path) {
  const m =
    /^\/clan\/([0-9A-Za-z]{3,12})(?:\/(manage|standing|recruit|how-elder-works)(?:\/([a-z-]+))?)?\/?$/.exec(
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

/** `navigate(to)` for the views: a path, with a query string riding
 *  along (`/?error=session_expired`). */
export function useNav() {
  const nav = useNavigate();
  return useCallback(
    (to) => {
      const [pathname, qs] = String(to).split("?");
      return nav({
        to: pathname,
        search: qs ? Object.fromEntries(new URLSearchParams(qs)) : {},
      });
    },
    [nav],
  );
}

/** Elixir's breakpoint: below it the rail is a disclosure above the page. */
function useNarrow() {
  const [narrow, setNarrow] = useState(
    () => window.matchMedia?.("(max-width: 900px)").matches ?? false,
  );
  useEffect(() => {
    const mq = window.matchMedia?.("(max-width: 900px)");
    if (!mq?.addEventListener) return undefined;
    const on = (e) => setNarrow(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

/** The session, as a query on ["me"]. A 401 reads as signed out (with
 *  whether it expired), a transport failure or a 5xx as "unavailable"
 *  - signed in, Elixir did not answer - and never as signed out.
 *  `refresh(true)` is the server-side re-read (?refresh=1). */
function useMe() {
  const queryClient = useQueryClient();
  const query = useMeQuery();
  const meOf = (env) => {
    if (!env) return null;
    if (env.status === 401)
      return {
        signed_in: false,
        expired: env.data?.reason === "session_expired",
      };
    if (!env.ok) return { signed_in: true, unavailable: true };
    return env.data;
  };
  const me = query.isError
    ? { signed_in: true, unavailable: true }
    : meOf(query.data);
  const { refetch } = query;
  const refresh = useCallback(
    async (force = false) => {
      if (force) {
        const r = await api.me(true);
        queryClient.setQueryData(keys.me, r);
        return meOf(r);
      }
      const r = await refetch();
      return meOf(r.data);
    },
    [refetch, queryClient],
  );
  const setMe = useCallback(
    (data) =>
      queryClient.setQueryData(keys.me, { ok: true, status: 200, data }),
    [queryClient],
  );
  return { me, checking: query.isFetching, refresh, setMe };
}

const SessionContext = createContext(null);
/** The session and the clan chooser, for the pages. */
export const useSession = () => useContext(SessionContext);

const rootRoute = createRootRoute({
  component: Shell,
  notFoundComponent: () => null,
});

const landingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: function LandingPage() {
    const { me } = useSession();
    const error = new URLSearchParams(window.location.search).get("error");
    if (me === null || me.signed_in) return null;
    return <Landing error={error} />;
  },
});

const clansRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/clans",
  component: function ClansPage() {
    const { me, select, selecting } = useSession();
    if (!me?.ok) return null;
    return <Clans me={me} onSelect={select} selecting={selecting} />;
  },
});

const clanRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/clan/{-$tag}/{-$section}/{-$tab}",
  component: function ClanPage() {
    const { me } = useSession();
    const navigate = useNav();
    const { pathname } = useLocation();
    const parsed = parseClanPath(pathname);
    // The one page that needs no sign-in.
    if (parsed?.section === "how-elder-works")
      return <HowElderWorks tag={parsed.tag} />;
    if (!me?.ok || !parsed) return null;
    const clan = clanFromPath(pathname, me.clans);
    if (!clan) return null;
    const who = {
      player_tag: clan.acting_as,
      name: clan.acting_as_name,
      role: clan.role,
    };
    if (parsed.section === "manage")
      return (
        <Manage
          key={clan.clan_tag}
          clan={clan}
          tab={parsed.tab ?? "inbox"}
          navigate={navigate}
          who={who}
        />
      );
    if (parsed.section === "standing")
      return <Standing key={clan.clan_tag} clan={clan} who={who} />;
    if (parsed.section === "recruit")
      return <Recruit key={clan.clan_tag} clan={clan} />;
    return <Clan key={clan.clan_tag} me={me} clan={clan} navigate={navigate} />;
  },
});

const youRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/you/{-$sub}",
  component: function YouPage() {
    const { me } = useSession();
    const { sub } = youRoute.useParams();
    if (!me?.signed_in || me.unavailable) return null;
    return sub === "away" ? <Away me={me} /> : <You me={me} />;
  },
});

const refusedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/refused/$reason",
  component: function RefusedPage() {
    const { me, checking, refresh } = useSession();
    const navigate = useNav();
    const { reason } = refusedRoute.useParams();
    if (!me?.signed_in || me.unavailable) return null;
    return (
      <Refused
        reason={reason}
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
  },
});

const feedbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/feedback/{-$id}",
  component: function FeedbackPage() {
    const { me } = useSession();
    const navigate = useNav();
    const { id } = feedbackRoute.useParams();
    if (!me?.signed_in || me.unavailable) return null;
    return id ? (
      <FeedbackItem id={id} navigate={navigate} />
    ) : (
      <Feedback me={me} navigate={navigate} />
    );
  },
});

const maintainRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/maintain/{-$lane}/{-$id}",
  component: function MaintainPage() {
    const { me } = useSession();
    const navigate = useNav();
    const { id } = maintainRoute.useParams();
    if (!me?.signed_in || me.unavailable) return null;
    return id ? (
      <MaintainItem id={id} navigate={navigate} />
    ) : (
      <MaintainQueue navigate={navigate} />
    );
  },
});

export const routeTree = rootRoute.addChildren([
  landingRoute,
  clansRoute,
  clanRoute,
  youRoute,
  refusedRoute,
  feedbackRoute,
  maintainRoute,
]);

/** The app is its own providers: one query cache and one router per
 *  mount, so a test that renders <App /> gets a fresh one. */
export function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() =>
    createRouter({
      routeTree,
      history: createBrowserHistory(),
      defaultPreload: false,
      scrollRestoration: true,
    }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

/**
 * The top bar: Elixir's chrome with this product's name in it. Since the
 * rail (2026-09-12) carries every section and the way out, the bar is the
 * wordmark, the way to Elixir, and the gold way in when signed out.
 */
function Chrome({ me, navigate }) {
  return (
    <ChromeBar
      wordmark="Elixir Clan"
      home="/"
      onHome={() => navigate("/")}
      tabs={[{ label: "Elixir", href: "https://elixir.poapkings.com/" }]}
      action={
        me?.signed_in ? null : (
          <a
            className="chrome__console ml-auto"
            href="/auth/login"
            data-tinylytics-event="clan.signin_started"
            data-tinylytics-event-value="chrome"
          >
            Sign in with Elixir
          </a>
        )
      }
    />
  );
}

/** The left rail: Elixir's console structure carried over (Jamie,
 *  2026-09-12: "that is where we are going"). The kit's Rail, fed what
 *  this person may see (lib/rail.js) and the clan they are in. */
export function Rail({ me, path, navigate, narrow }) {
  const clan = me?.selected ?? null;
  return (
    <RailList
      label="Sections"
      items={railItems(me)}
      current={railKey(path)}
      navigate={navigate}
      narrow={narrow}
      title={clan?.name ?? "Elixir Clan"}
      aside={clan?.clan_tag}
      subtitle={clan?.name ?? ""}
      identity={
        <RailIdentity
          href="/you"
          onClick={(e) => {
            e.preventDefault();
            navigate("/you");
          }}
          name={
            <>
              <span className="yours">★</span>{" "}
              {clan?.player_name ?? me?.primary?.name ?? "Signed in"}
            </>
          }
          detail={
            clan ? (
              <RoleChip role={clan.role} label={clan.role_label} />
            ) : (
              "with Elixir"
            )
          }
          action={
            // Signing out is a form post, as it always was here: an
            // action with no destination of its own.
            <form method="post" action="/auth/logout">
              <button
                type="submit"
                aria-label="Sign out"
                title="Sign out"
                className="btn btn--sm"
                onClick={(e) => e.stopPropagation()}
              >
                <Icon name="log-out" size={16} />
              </button>
            </form>
          }
        />
      }
    />
  );
}

function Shell() {
  const { pathname: path } = useLocation();
  const navigate = useNav();
  const narrow = useNarrow();
  const { me, checking, refresh, setMe } = useMe();
  const [selecting, setSelecting] = useState(false);

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
    [navigate, setMe],
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
      if (
        !path.startsWith("/refused/") &&
        !path.startsWith("/you") &&
        !path.startsWith("/feedback")
      )
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

  // The rail belongs to a signed-in person with somewhere to go: their
  // clan pages, or their own pages while the gate still refuses them.
  const showRail =
    Boolean(me?.signed_in) &&
    !me.unavailable &&
    !publicPage &&
    (me.ok || path.startsWith("/you") || path.startsWith("/feedback"));

  return (
    <SessionContext.Provider
      value={{ me, checking, refresh, select, selecting }}
    >
      <div className="shell">
        <Chrome me={me} navigate={navigate} />
        <div
          className={`mx-auto flex w-full max-w-page flex-auto items-stretch ${narrow ? "flex-col" : "flex-row"}`}
        >
          {showRail ? (
            <Rail me={me} path={path} navigate={navigate} narrow={narrow} />
          ) : null}
          <main className="page">
            <div
              className={`page__inner${showRail ? "" : " page__inner--solo max-w-page"}`}
            >
              <ErrorBoundary key={path}>
                {me?.signed_in && me.unavailable && !publicPage ? (
                  <div
                    className="callout callout--warn mx-auto mt-10 max-w-[560px]"
                    role="alert"
                  >
                    <span>
                      Elixir did not answer. Your sign-in is fine; try again in
                      a minute.
                    </span>
                  </div>
                ) : (
                  <Outlet />
                )}
              </ErrorBoundary>
            </div>
          </main>
        </div>
        <Disclaimer />
      </div>
    </SessionContext.Provider>
  );
}
