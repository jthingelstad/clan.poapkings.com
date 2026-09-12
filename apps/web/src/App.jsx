import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { Chrome } from "./components/Chrome.jsx";
import { Disclaimer } from "./components/Disclaimer.jsx";
import { Clan } from "./views/Clan.jsx";
import { Landing } from "./views/Landing.jsx";
import { Refused } from "./views/Refused.jsx";
import { You } from "./views/You.jsx";

/**
 * Routes: `/` (landing, signed out), `/clan`, `/you`, `/refused/<reason>`.
 * A path-based router in twenty lines: the app has four places and no
 * parameters worth a dependency.
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

export function App() {
  const [path, navigate] = usePath();
  const [me, setMe] = useState(null); // null = not asked yet
  const [checking, setChecking] = useState(false);

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

  // Where a signed-in person belongs, whatever address they arrived at.
  useEffect(() => {
    if (!me) return;
    if (!me.signed_in) {
      if (path !== "/") navigate(me.expired ? "/?error=session_expired" : "/");
      return;
    }
    if (me.unavailable) return;
    if (me.ok && (path === "/" || path.startsWith("/refused")))
      navigate("/clan");
    if (!me.ok && (path === "/" || path === "/clan"))
      navigate(`/refused/${me.reason}`);
  }, [me, path, navigate]);

  const error = new URLSearchParams(window.location.search).get("error");
  let view = null;
  if (me === null) view = null;
  else if (!me.signed_in)
    view = (
      <Landing
        error={error === "session_expired" ? "session_expired" : error}
      />
    );
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
          if (next?.ok) navigate("/clan");
          else if (next?.reason) navigate(`/refused/${next.reason}`);
        }}
      />
    );
  else if (me.ok) view = <Clan me={me} />;

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
