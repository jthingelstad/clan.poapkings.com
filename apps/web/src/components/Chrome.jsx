/**
 * The top bar: Elixir's chrome with this product's name in it. It carries
 * one state, signed in or not, because unlike Elixir's site there is no
 * signed-out surface to speak of: the way in is the gold button, and the
 * way out is a form, since signing out is an action rather than a place.
 */
export function Chrome({ me, navigate, path }) {
  const signedIn = Boolean(me?.signed_in);
  const tab = (label, to) => (
    <a
      className={`chrome__tab${path === to || (to.startsWith("/clan/") && path.startsWith("/clan/")) ? " chrome__tab--on" : ""}`}
      href={to}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      {label}
    </a>
  );
  return (
    <header className="chrome">
      <div className="chrome__inner">
        <a
          className="wordmark"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          Elixir Clan
        </a>
        <nav className="chrome__nav" aria-label="Elixir Clan">
          {signedIn && me.ok
            ? tab(
                "Clan",
                me.selected
                  ? `/clan/${me.selected.clan_tag.slice(1)}`
                  : "/clans",
              )
            : null}
          {signedIn && me.ok && me.clans?.length > 1
            ? tab("Clans", "/clans")
            : null}
          {signedIn ? tab("You", "/you") : null}
          <a className="chrome__tab" href="https://elixir.poapkings.com/">
            Elixir
          </a>
        </nav>
        {signedIn ? (
          <form
            method="post"
            action="/auth/logout"
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: "12px",
            }}
          >
            {me.primary?.name ? (
              <span style={{ fontSize: "13px", color: "var(--ink-dim)" }}>
                <span className="yours">★</span> {me.primary.name}
              </span>
            ) : null}
            <button type="submit" className="btn btn--quiet btn--sm">
              Sign out
            </button>
          </form>
        ) : (
          <a className="chrome__console" href="/auth/login">
            Sign in with Elixir
          </a>
        )}
      </div>
    </header>
  );
}
