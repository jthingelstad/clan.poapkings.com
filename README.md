# Elixir Clan

Clan management for any Clash Royale clan, on [Elixir](https://elixir.poapkings.com):
the roster with every member's role, trophies, donations and activity, shown
to you as who you are in the game, and your clan's own policy run against
the record: Elder by participation in what your clan counts or by hand, an
inactivity clock, cards your leaders decide, awards, recruiting copy and
scouting. Live at <https://clan.poapkings.com>.

- Sign in with Elixir only (OAuth 2.1, PKCE, `cr:read`). No accounts here.
- Requires a verified player; in-game role is the app role.
- Nothing in clan management runs until a leader sets your clan's policy.
- An app for a clan's members: nothing is published outside it.
- Stores sessions, your remembered clan, and each clan's policy, cards,
  holds, notes, awards, pitch and feedback: tags and summaries, never
  Elixir's payloads.

## Develop

```
npm install
npm run verify        # format, lint, tests (no network)
npm run build         # the SPA
```

Deploying and the AWS shape: [AGENTS.md](AGENTS.md). Decisions:
[docs/NOTES.md](docs/NOTES.md).

Part of the Elixir family with [Elixir](https://github.com/jthingelstad/elixir-mcp)
and [Elixir Drop](https://github.com/jthingelstad/drop.poapkings.com). MIT.

---

*This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*
