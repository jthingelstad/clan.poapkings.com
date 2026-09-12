/**
 * The top bar: Elixir's chrome with this product's name in it. Since the
 * rail (2026-09-12) carries every section and the way out, the bar is the
 * wordmark, the way to Elixir, and the gold way in when signed out.
 */
export function Chrome({ me, navigate }) {
  const signedIn = Boolean(me?.signed_in);
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
          <a className="chrome__tab" href="https://elixir.poapkings.com/">
            Elixir
          </a>
        </nav>
        {signedIn ? null : (
          <a
            className="chrome__console"
            href="/auth/login"
            style={{ marginLeft: "auto" }}
          >
            Sign in with Elixir
          </a>
        )}
      </div>
    </header>
  );
}
