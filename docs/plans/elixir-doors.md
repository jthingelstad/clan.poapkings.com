# Plan: three doors into Elixir for the family's apps

**Proposed 2026-09-25 by Elixir Clan, for the Elixir team. Not built.**
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

## Door 1: a first-party read grant with no person present

Recorded game data is already readable by every account. A first-party
client (Clan, Drop) gets a **client-credentials grant** to `/api/v1` with
`cr:read`, audited per call like any grant, spending no quota as
first-party reads do today. Clan uses it only for clans whose leaders saved
a policy, on a schedule (once or twice a day), and never stores a person's
tokens to do it.

*Alternative, no Elixir change:* Clan keeps a leader's rotating refresh
token and reads on their behalf. It works, but Clan would hold people's
credentials; the grant is the cleaner door.

## Door 2: mail to a person

`POST /api/v1/mail` for first-party clients: the recipient named by a
verified player tag (Elixir resolves the person and their address), a
**kind** from a registry (`clan.weekly_report`, `clan.actions_waiting`,
later Drop's), a subject and a Markdown body. Elixir sends only if the
person has that kind switched on in Elixir's account settings (one place to
manage every family email), adds the unsubscribe link and the send id,
keeps the send record, and answers with the send id. The vertical never
sees an address.

Clan would send: a **weekly clan report** to members who want it, and
**actions waiting for you** (a digest, never one mail per action).

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

## Questions for Jamie and the Elixir team

1. Client credentials for first-party apps (door 1), or Clan holding
   leaders' refresh tokens?
2. Email consent per kind in Elixir's account settings (door 2), off by
   default?
3. Which fact types are worth it first (door 3), and what may a clan share
   beyond its own members?
