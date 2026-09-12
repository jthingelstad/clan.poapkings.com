# Elixir Clan

Your Clash Royale clan, on [Elixir](https://elixir.poapkings.com): the roster
with every member's role, trophies, donations and activity, shown to you as
who you are in the game. Live at <https://clan.poapkings.com>.

- Sign in with Elixir only (OAuth 2.1, PKCE, `cr:read`). No accounts here.
- Requires a verified primary player; in-game role is the app role.
- Stores sessions and nothing else.

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
