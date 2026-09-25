/**
 * Below the smallest clan a policy engages with (10 members, as Clan Wars):
 * Elixir Clan is a statistics view there, and every clan-management and
 * awards page says so in the same words.
 */
export function TooFew({ members, min = 10 }) {
  return (
    <div className="empty">
      <div className="empty__title">
        Clan management starts at {min} members
      </div>
      <p className="empty__body">
        {members != null
          ? `This clan has ${members}. `
          : "This clan is below that for now. "}
        Like Clan Wars, the policy, actions, standing and awards wait until the
        clan has {min}; until then Elixir Clan shows the roster and every
        member&rsquo;s statistics, and Recruit and Scout work. A saved policy is
        kept and picks up again at {min}.
      </p>
    </div>
  );
}
