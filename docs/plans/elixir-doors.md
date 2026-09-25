# Plan: three doors into Elixir for the family's apps

**Proposed 2026-09-25 by Elixir Clan, for the Elixir team; Jamie's answers
folded in the same day. Door 3 BUILT 2026-09-25 (Elixir 9.2.0, JSON API
2.2.0; Clan's sharing switches); doors 1 and 2 not built.**
Kept here until the family's plans folder (`../elixir-family/plans/`) can
take it. Elixir decides the contracts; nothing here is Elixir's until its
team agrees.

## Why

Elixir Clan and Elixir Drop stay separate from Elixir (Jamie, 2026-09-25):
their own backends and storage, reading Elixir through its public JSON API
on a person's own grant. Three things they now need cannot be done that
way, and each is one small first-party door on Elixir's side rather than a
shared database:

1. **Reading the record with nobody signed in**, so Clan can raise actions
   in the morning and grant a closed season's awards without a visit.
2. **Sending a person email**, because Elixir holds the address, the
   consent and the sending (and Clan never asks for `account:email`).
3. **Writing back facts people attested**, so what a clan did and what a
   player achieved in Drop reach Elixir's Timeline, its events feed, its
   future email and elixir-mcp-discord (elixir-bot is being retired).

## The line that keeps Elixir judgment-free

Only **facts** cross, never recommendations, scores or opinions. A fact is
something a person attested ("this departure was a kick", said by a named
leader) or that a vertical's own game produced ("a new personal record in
Drop"). "This member should be removed" never crosses. Every written fact
carries its provenance: the vertical, the person's verified tag and role at
the time, and when. The naming test applies: nothing in the contract names
a policy, a threshold or a verdict.

## Door 1: Elixir Clan as an integration

Jamie, 2026-09-25: use Elixir's existing **integrations** (Admin →
Integrations: an admin-issued `svt_` key, named permissions, budgets, last
use and suspension; Elixir Drop is the first). Elixir Clan becomes the
second integration, with one new permission, `clans:read`: the JSON API's
`GET /clans/{tag}/participation` and `GET /clans/{tag}/roster` for any
recorded clan, the same answers a person's grant gets. Clan uses it only for
clans whose leaders saved a policy, on a schedule (once or twice a day), and
keeps the key in its server configuration like any secret. No person's
tokens are ever stored for this.

## Door 2: mail through Elixir's email

Jamie, 2026-09-25: email is managed in Elixir, and Elixir Clan is a client
of it. Elixir already has the kinds, the per-kind preferences under the
account's email settings, one-click unsubscribe, the send ledger and the
account's activity log; Clan's mail joins them as new kinds rather than a
new system. On its integration key, with a `mail:send` permission, Clan
posts a composed issue for a kind (`clan_weekly_report`,
`clan_actions_waiting`, a digest, never one mail per action) and the player
tags it is for; Elixir sends only to accounts whose verified player is in
that clan and who have the kind switched on, adds the unsubscribe link and
the send id, and shows the mail in the account's activity like its own. The
integration never sees an address. Elixir Drop, which today sends only
magic sign-in links from its own side, can add kinds the same way later.

## Door 3: facts people attested

`POST /api/v1/clans/{tag}/facts` (Clan) and
`POST /api/v1/players/{tag}/facts` (Drop), on the acting person's own grant
(the attester is whoever holds it), with a `type` from a registry and a
small bounded `detail`:

| Type | From | Detail |
|---|---|---|
| `departure_classified` | Clan, a leader | `kick` \| `leave`, the departure it answers |
| `role_change_made` | Clan, a leader | the member, from and to, the action it completes |
| `award_granted` | Clan | the award's name, season, place |
| `member_away` | Clan, the member | until |
| `clan_message` | Clan, whoever sent it | a message sent to the clan: a Clan Leader Message (title and body) or a clan chat line, the action it completes |
| `personal_record` | Drop | the game, the score, the previous best |

Elixir records them with their provenance and shows them where a fact
belongs: the Timeline, the events feed (`elixir_events`, so
elixir-mcp-discord can narrate), later email. **Each has a visibility**
(clan members only, or the player's own followers) and **the clan chooses
what leaves it** in its policy (Clan side). A kick is private by default,
and narrators have never announced kicks; that stays.

## Order

Door 3 first: small, and it serves both apps (Drop's personal records and
Clan's departures and awards). Doors 1 and 2 together next, since Clan's
"always current, and telling you" theme needs both (scheduled evaluation
raises the actions; the mail tells people).

## What Clan builds once a door exists

- Door 3: a policy switch per fact type ("share with Elixir"), the write on
  the action's completion, and a log entry saying it was shared.
- Door 1: scheduled evaluation for clans with an active policy.
- Door 2: the weekly report and the actions digest, and a per-person choice
  shown in Clan that links to Elixir's settings.

## Settled with Jamie (2026-09-25)

1. Door 1 is an integration, Elixir's existing admin-approved kind.
2. Email is Elixir's: kinds, preferences, unsubscribe and the activity log;
   Clan (and later Drop) are clients.
3. The fact types above, with `clan_message` added.

## Open for the Elixir team

- The `clans:read` and `mail:send` permissions and the facts routes in the
  JSON API contract; the facts' visibility and how the Timeline and the
  events feed show them.
- Default for the new mail kinds (Elixir's own product mail sets the
  pattern).
