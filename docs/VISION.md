# Elixir Clan: vision

`clan.poapkings.com` · a vertical on Elixir · **draft for Jamie, 2026-09-25**

This is the page every proposal is weighed against. It draws on the family
map (`../elixir-family/MAP.md` §5), the goals plan
(`../elixir-family/plans/clan-goals.md`, 2026-09-13, partly overtaken by the
decisions below) and the decisions of 2026-09-25 in `docs/NOTES.md`. When
this page and a plan disagree, this page wins; when Jamie changes it, the
change is a commit here.

## One sentence

Being in a Clash Royale clan, for any clan: every member can see how the
clan works and where they stand in it, and leaders run the clan the way *it*
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
  applicants, granting the recognition the clan lets them grant.
- **Leaders and co-leaders**: decide. They want the clan run the way they
  mean it with minutes of attention, not hours of tracking: the right card
  at the right time, with the evidence, and nothing done behind their back.
- **The applicant and the recruiter**: a clan that is growing needs words
  that say what it is and a way to read who is asking to join.

Success for a member: "I know how this clan works and where I stand, and I'm
seen for what I do." For a leader: "the cards are right, I can explain every
one, and I spend minutes a week on it."

## What a clan is for

Clans differ, and real ones are mixtures: a **war** clan fights the River
Race; a **ladder** clan climbs Trophy Road or Path of Legends; a **social**
clan plays when it likes with people it likes; a **donation** clan levels
each other's cards; others play 2v2 together, coach newcomers, or feed a main
clan. Elixir Clan does not pick one. A clan says what it counts and how it
chooses its Elders, and everything else follows from its policy: what
members are told, what cards are raised, what is recognized, what the
recruiting words say. Today that is the policy's categories (Clan Wars,
ranked play, donations, trophy road); the goals plan's larger idea, saying
what the clan is *for* and letting the policy follow, is the most likely
next step (see Themes).

## Principles

1. **Any clan.** Nothing in code, defaults, help or copy is shaped by one
   clan. A clan's rules, awards and words live in its saved versions. A test
   keeps product source free of any clan's specifics.
2. **The clan's policy decides, and nothing runs without one.** Until a
   leader saves a policy, and below 10 members (as Clan Wars), Elixir Clan
   is a statistics view: the roster and every member's numbers.
3. **Leaders decide; the app proposes.** Every action is a card a leader
   marks Done or declines, with the evidence and the rule that raised it.
   Elixir Clan never acts in the game and never decides for a leader.
4. **Fair, and explainable to the member it is about.** Participation over
   outcome by default (what a player controls). Fail closed: an unknown is
   held and said, never a zero. Members read their evidence in a player's
   words, never a score, a percentile or a rank. Every rule is versioned and
   every card names the version that judged it.
5. **Judgment is deterministic.** The engine is a pure function of the
   record and the policy. No model decides anything about a member.
6. **Facts from Elixir, judgment here.** Elixir records and has no opinions;
   a fact this product needs is a request to Elixir, never a judgment moved
   upstream. Elixir Clan reads only through its public door.
7. **An app for the clan's members, not a publisher.** Everything is behind
   sign-in; nothing is published for the world.
8. **Quiet and frugal.** No polling, no spend per page, nothing sent that a
   person did not ask for.
9. **The family's design.** Elixir's kit, tokens and rail; the family reads
   as one product.

## What it is not

- Not a Discord bot or a narrator (elixir-bot and the open-source
  elixir-agent do that), and not a chat: in-game chat is not in the API.
- Not a clan's public website. A clan may keep one; Elixir Clan does not
  publish.
- Not a ladder or deck coach: one player's season and matchups are Elixir
  Ladder's.
- Not an account system: Elixir is.
- Not a rules language: policies are a fixed catalog of settings, on
  purpose.

## What it does today

Sign in with Elixir; the roster with roles and statistics; the clan's
versioned policy (categories, minimums, Elder by hand or by a weighted mix,
the inactivity clock, departures); cards leaders decide, with outcomes
verified from the record; holds, Away, tiered notes; Standing with "How it
works here"; awards as a catalog of kinds and a members' trophy case;
recruiting copy in two formats; scouting an applicant; feedback to the
maintainer. See `AGENTS.md` for how.

## Themes ahead (not yet ordered)

1. **What the clan is for.** Goals (war, ladder, donations, playing
   together, presence) and presets, so a new leader starts from "we are a
   war clan" or "we are a social clan", not a blank form of forty settings.
   From the goals plan, minus what 2026-09-25 retired.
2. **Always current.** Scheduled evaluation, so cards are waiting in the
   morning and a closed season's awards are granted without anyone visiting;
   the leader's weekly rhythm (review day, season close) made visible.
3. **The member's own page.** Per clan: where I stand against what this clan
   counts, what would move me, my history here, my trophies across seasons.
   Members are most of the people.
4. **Beyond war.** The facts other kinds of clan need: presence by the
   game's last-seen, battles played with clanmates, donations received,
   trophies over time. Requests to Elixir first.
5. **Growing the clan.** Recruit and Scout shaped by what the clan is for;
   a clan below 10 helped toward 10.
6. **Families** (horizon): a main clan and its feeder, and graduating
   between them.

## How we choose the next step

Each round, candidates are weighed on: which people it serves and how many
clans it helps (the any-clan test); how far it moves a theme; whether it
keeps every principle; the risk of an unfair or unexplainable result; its
size (one round should ship: code, tests, docs, deploy, a live read); and
what it needs from Elixir first. One recommendation, with the runner-up, for
Jamie to take, change or refuse. Decisions go to `docs/NOTES.md`; a change of
direction comes back to this page.

## Open questions for Jamie

1. **Does Elixir Clan ever reach out?** An email to leaders when cards wait,
   or to a member about their standing, or a Discord webhook (deferred)?
   Principle 8 says nothing is sent unasked; opt-in would be the shape.
2. **May a model ever write words** (never judgments): recruiting copy,
   a season recap? Today nothing uses one.
3. **How does a clan arrive?** A leader finds it and sets it up; members
   follow? Or members first? What should a clan Elixir does not record yet
   see?
4. **What says it is working?** Candidate measures: clans with a policy,
   weekly active leaders, cards decided vs withdrawn, members opening
   Standing, feedback in the `judgment` category.
5. **The family's name on a general product**: the `poapkings.com`
   hostnames and the kit's "a POAP KINGS product" footer (a family decision).
