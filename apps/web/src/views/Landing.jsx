import { ELIXIR_LINKS } from "../lib/links.js";

/** What went wrong on the way back from Elixir, in one sentence each.
 *  The codes are the API's (services/api/src/handler.mjs, callback). */
const ERRORS = {
  state_mismatch:
    "That sign-in did not start in this browser. Start again from here.",
  login_expired:
    "That sign-in took longer than ten minutes, or was already used. Start again.",
  missing_code: "Elixir sent you back without a code. Start again.",
  wrong_issuer: "That code did not come from Elixir. Start again.",
  exchange_failed:
    "Elixir would not exchange that code, which usually means it was already used or timed out. Start again.",
  not_configured:
    "This deployment has no Elixir client registered yet, so sign-in is not wired up. That is an operator step, not yours.",
  session_expired: "Your session ended. Sign in again to continue.",
  elixir_unavailable:
    "Elixir did not answer. Nothing is wrong with your account; try again in a minute.",
};

/** Signed out. The two prerequisites are stated here, before the button,
 *  so nobody discovers them one refusal page at a time. */
export function Landing({ error }) {
  return (
    <div style={{ maxWidth: "560px", margin: "40px auto 0" }}>
      <p className="eyebrow">ELIXIR CLAN</p>
      <h1 className="hero-title">Your clan, on Elixir.</h1>
      <p className="lede">
        The roster with every member&rsquo;s role, trophies, donations and
        activity, read from the history Elixir records. You see it as who you
        are in the game: leader, co-leader, elder or member.
      </p>

      {error ? (
        <div
          className="callout callout--warn"
          role="alert"
          style={{ margin: "20px 0" }}
        >
          <span>
            {ERRORS[error] ?? "Sign-in did not complete. Start again."}
          </span>
        </div>
      ) : null}

      <div className="panel" style={{ margin: "24px 0" }}>
        <div className="panel__head">
          Before you sign in, you need two things
        </div>
        <div className="panel__body" style={{ display: "grid", gap: "14px" }}>
          <div>
            <div style={{ fontWeight: 600 }}>1. An Elixir account</div>
            <p className="page__lede" style={{ margin: "4px 0 0" }}>
              Elixir is the account system; there is no separate sign-up here.{" "}
              <a href={ELIXIR_LINKS.requestAccess}>
                Request access at elixir.poapkings.com
              </a>{" "}
              if you do not have one yet.
            </p>
          </div>
          <div>
            <div style={{ fontWeight: 600 }}>2. A verified player</div>
            <p className="page__lede" style={{ margin: "4px 0 0" }}>
              Your primary player must be added under{" "}
              <a href={ELIXIR_LINKS.tracking}>Elixir → Tracking</a> and proven
              under <a href={ELIXIR_LINKS.verify}>Elixir → Verify</a>: one
              battle with a deck Elixir names, usually under a minute. Your
              in-game role is your role here.
            </p>
          </div>
        </div>
        <div className="panel__foot">
          Sign-in asks Elixir for <code>cr:read</code> only, the minimum that
          reads a roster. Elixir Clan stores your session and nothing else.
        </div>
      </div>

      <a className="btn btn--primary" href="/auth/login">
        Sign in with Elixir
      </a>
    </div>
  );
}
