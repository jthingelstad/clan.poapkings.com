# Elixir Clan: vision

`clan.poapkings.com` · a vertical on Elixir · **agreed with Jamie,
2026-09-25**

This is the page every proposal is weighed against. It draws on the family
map (`../elixir-family/MAP.md` §5), the goals plan
(`../elixir-family/plans/clan-goals.md`, 2026-09-13, partly overtaken by the
decisions below) and the decisions of 2026-09-25 in `docs/NOTES.md`. When
this page and a plan disagree, this page wins; when Jamie changes it, the
change is a commit here.

## One sentence

Being in a Clash Royale clan, for any clan: every member can see how the
clan works and where they stand in it, and the clan is run the way *it*
chooses, with evidence from the record, fairly and in the open.

## The problem

A clan is run from memory and screenshots. The game shows today's roster,
this week's donations and the current race; it forgets last week, keeps no
record of who played which war, and has no place to write down how the clan
works. So leaders keep spreadsheets or a Discord bot, rules live in a
200-character description, promotions and kicks feel arbitrary to the people
they happen to, and a member who wants to know "what would make me Elder
here?" has to ask. Elixir remembers what the game forgets; Elixir Clan turns
that record into the running of one clan, by that clan's own rules.

## Who it is for

Everyone in a clan Elixir records, as who they are in the game. In-game role
is the app role.

- **Members** (most people): want to know how this clan works, where they
  stand, what would move them, and to be seen for what they do. They should
  never be surprised by a promotion, a demotion or a removal.
- **Elders**: help run the clan without its keys: notes on members, scouting
  applicants, welcoming newcomers, granting the recognition the clan lets
  them grant.
- **Leaders and co-leaders**: decide. They want the clan run the way they
  mean it with minutes of attention, not hours of tracking: the right action
  at the right time, with the evidence, and nothing done behind their back.
- **The applicant and the recruiter**: a clan that is growing needs words
  that say what it is and a way to read who is asking to join.

Success for a member: "I know how this clan works and where I stand, and I'm
seen for what I do." For a leader: "the actions are right, I can explain
every one, and I spend minutes a week on it."

## Actions

What Elixir Clan suggests a person do is an **action**: promote this member,
remove that one, say whether a departure was a kick, welcome a newcomer,
mark yourself away. An action is either **assigned to you** or **available
to you** because anyone in your role may take it (any leader, any elder).
You complete it or decline it, and it carries its evidence and the rule that
raised it. Actions are how the clan's policy reaches people; the measure of
the product is actions suggested and actions taken.

## What a clan is for

Clans differ, and real ones are mixtures: a **war** clan fights the River
Race; a **ladder** clan climbs Trophy Road or Path of Legends; a **social**
clan plays when it likes with people it likes; a **donation** clan levels
each other's cards; others play 2v2 together, coach newcomers, or feed a main
clan. Elixir Clan does not pick one. A clan says what it counts and how it
chooses its Elders, and everything else follows from its policy: what
members are told, what actions are suggested, what is recognized, what the
recruiting words say. Today that is the policy's categories (Clan Wars,
ranked play, donations, trophy road); the goals plan's larger idea, saying
what the clan is *for* and letting the policy follow, is a theme below.

## How a clan arrives

Through Elixir, and member-first. A person signs in with Elixir, and a clan
is here only when their verified player is in it: there is no Elixir Clan
without Elixir, and no adding a clan that is not associated there. No leader
has to act first: any member can use Elixir Clan on their own (the roster,
every member's numbers, Recruit) and suggest it to their leaders; when a
leader sets a policy (and the clan has 10 members), the rest turns on. A
clan Elixir only watches rather than records works with less.

## Principles

1. **Any clan.** Nothing in code, defaults, help or copy is shaped by one
   clan. A clan's rules, awards and words live in its saved versions. A test
   keeps product source free of any clan's specifics.
2. **The clan's policy decides, and nothing runs without one.** Until a
   leader saves a policy, and below 10 members (as Clan Wars), Elixir Clan
   is a statistics view: the roster and every member's numbers.
3. **People decide; the app suggests.** Every action is completed or
   declined by a person whose role allows it, with the evidence and the rule
   that raised it. Elixir Clan never acts in the game and never decides for
   anyone.
4. **Fair, and explainable to the member it is about.** Participation over
   outcome by default (what a player controls). Fail closed: an unknown is
   held and said, never a zero. Members read their evidence in a player's
   words, never a score, a percentile or a rank. Every rule is versioned and
   every action names the version that raised it.
5. **Judgment is deterministic.** The engine is a pure function of the
   record and the policy. No model decides anything about a member.
6. **Facts from Elixir, judgment here, and what the clan did goes back.**
   Elixir records and has no opinions; a fact this product needs is a
   request to Elixir. What a person in the clan did (a departure they say was
   a kick, a promotion they made, an award they granted) is a fact too, and
   goes back to Elixir attested by that person, never as a recommendation or
   a score.
7. **An app for the clan's members, not a publisher.** Everything is behind
   sign-in; nothing is published for the world.
8. **Quiet, useful, and never on our tokens.** No polling and no spend per
   page. Email, through Elixir (which holds the address), for the weekly
   clan report and the actions waiting for you, and only to people who want
   it. A model may write words (never judgments) only on a clan's own
   Anthropic key: bring your own tokens; Elixir Clan funds none.
9. **The family's design.** Elixir's kit, tokens and rail; the family reads
   as one product.

## What it is not

- Not a Discord bot or a narrator: elixir-mcp-discord and the open-source
  elixir-agent narrate from Elixir's record (elixir-bot is being retired),
  and in-game chat is not in the API.
- Not a clan's public website. A clan may keep one; Elixir Clan does not
  publish.
- Not a ladder or deck coach: one player's season and matchups are not a
  clan's (an Elixir Ladder is a concept only, with no plans to build it).
- Not an account system: Elixir is.
- Not a rules language: policies are a fixed catalog of settings, on
  purpose.

## What it does today

Sign in with Elixir; the roster with roles and statistics; "You here", every
member's own numbers week by week and what their clan makes of them; the clan's
versioned policy, in tabs switched on or off (a starting point, then each
category, Elder, inactivity and the rest), tuned from there (categories, minimums, Elder by hand or
by a weighted mix, the inactivity clock, departures, welcomes); actions for leaders, elders and members
(assigned or open to a role, completed or declined), with the words for the
game ready (a clan chat line, or a Clan Leader Message for leaders), each
with its own log
of what raised it, who took it and anyone's comments, and outcomes verified
from the record; holds, Away, tiered notes; Standing with "How it works here"; awards as a catalog
of kinds and a members' trophy case; recruiting copy in two formats; lines for members to invite their leaders and
clanmates;
scouting an applicant; clan settings, where the clan's own model, on its
own Anthropic key, is added to draft the recruiting pitch for a leader to
edit; feedback to the maintainer. See `AGENTS.md` for how.

## Themes ahead (not yet ordered)

1. **Actions for everyone.** The word in the product; each action says who
   may take it (assigned to you, or open to your role); actions for elders
   and members, not only leaders; "your actions" wherever you are.
2. **Always current, and telling you.** Scheduled evaluation, so actions
   wait in the morning and a closed season's awards are granted without
   anyone visiting; a weekly clan report and "actions waiting for you" by
   email through Elixir.
3. **What the clan is for.** Goals (war, ladder, donations, playing
   together, presence) and presets, so a new leader starts from "we are a
   war clan" or "we are a social clan", not a blank form of forty settings.
4. **The member's own page.** Per clan: where I stand against what this clan
   counts, what would move me, my actions, my history here, my trophies.
5. **Telling Elixir what the clan did.** Attested clan facts written back to
   Elixir (kick or leave, promotions, awards, away), so the family's other
   products (the Discord narrator above all) know what the clan knows, with
   the clan choosing what leaves it. Built 2026-09-25 (door 3: Elixir 9.2.0,
   JSON API 2.2.0; Clan settings ▸ Share with Elixir). The same door serves
   Elixir Drop (a new personal record on the Timeline and in Discord), next
   in Drop's own session.
6. **Beyond war.** The facts other kinds of clan need: presence by the
   game's last-seen, battles played with clanmates, donations received,
   trophies over time. Requests to Elixir first.
7. **Words by the clan's own model.** A clan's own Anthropic key writes the
   weekly report, the recruiting copy, a season recap; templates remain the
   fallback.
8. **Growing the clan.** Recruit and Scout shaped by what the clan is for; a
   clan below 10 helped toward 10; members inviting their leaders.
9. **Families** (horizon): a main clan and its feeder, and graduating
   between them.

## How we choose the next step

Each round, candidates are weighed on: which people it serves and how many
clans it helps (the any-clan test); how far it moves a theme and the
measure (actions suggested and taken, members signing in and engaging);
whether it keeps every principle; the risk of an unfair or unexplainable
result; its size (one round should ship: code, tests, docs, deploy, a live
read); and what it needs from Elixir first. One recommendation, with the
runner-up, for Jamie to take, change or refuse. Decisions go to
`docs/NOTES.md`; a change of direction comes back to this page.

## Settled (2026-09-25)

- **Reaching people:** yes, by email through Elixir: a weekly clan report,
  and the actions waiting for you. A webhook may follow later.
- **Models:** open, but only on a clan's own Anthropic key; never ours;
  never for judgment.
- **Arrival:** through Elixir only, member-first; no leader needs to act
  for a member to use it.
- **Measure:** actions suggested and taken; members signing in and
  engaging.
- **The family's name** on the product stays as it is for now.
- **A clan's own model key** (round 6): added by a leader or co-leader,
  checked with Anthropic, kept sealed and never shown again, used only by
  leaders and only while the person who added it leads the clan, capped
  per day, every use recorded. What the model may write is a closed list
  of purposes, each built from clan-level facts only.

## Open

- **Write-back** (settled and built 2026-09-25): attested facts, kept
  apart from the game record and labelled; visibility per type (a kick or
  an away only to the clan's leaders, never an agent); the clan chooses
  what leaves it, all off to start.
