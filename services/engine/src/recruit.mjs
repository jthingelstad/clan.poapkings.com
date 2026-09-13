/**
 * Recruiting: elixir-bot's promotion-content job (runtime/jobs/_promotion.py,
 * prompts/lanes/recruiting.md, agent/prompt_builders._promote_system) as a
 * page every member can use. The bot composed copy for five channels with
 * a model every Friday and posted it to #recruiting for members to reuse;
 * this product has no model and no channel, so the copy is written from
 * templates over two things: the clan's own PITCH (a leader's words,
 * versioned like policy) and live FACTS from the game (one live read of the
 * clan through Elixir, cached). The bot's hard rules are kept as
 * `validateCopy`: the Discord title line ends with "Required Trophies: [N]",
 * the Reddit title carries "[N]" for r/RoyaleRecruit's automod, the Reddit
 * body never carries an invite link, no backticks anywhere, and the plain
 * channels are plain text.
 *
 * Voice, from the lane prompt: a real member recruiting on behalf of the
 * clan, "we" and "our clan", the clan the star, Elixir a feature, real
 * numbers used sparingly. Pure: pitch + facts in, copy out.
 */

export const RECRUIT_SCHEMA_VERSION = 1;
export const MAX_POINTS = 6;
export const ROSTER_CAP = 50;

/** @type {Record<string, {label:string, max:number, lines?:boolean, why:string, optional?:boolean, url?:boolean}>} */
export const PITCH_FIELDS = {
  tagline: {
    label: "Tagline",
    max: 80,
    why: "One line after the clan's name in every title: what you are in six words.",
  },
  about: {
    label: "About the clan",
    max: 400,
    why: "Two or three plain sentences a member could say out loud. No stats here; the facts are added from the game.",
  },
  points: {
    label: "What makes us different",
    max: 120,
    lines: true,
    why: `Up to ${MAX_POINTS} short points, one per line. Real things (a tradition, a reward, how wars are run), never invented numbers.`,
  },
  looking_for: {
    label: "Who we are looking for",
    max: 200,
    why: "One sentence: the player who will be happy here.",
  },
  website_url: {
    label: "Website",
    max: 200,
    optional: true,
    url: true,
    why: "Linked from the copy that allows links (never the Reddit body). Leave empty for none.",
  },
  contact: {
    label: "How to get in",
    max: 120,
    optional: true,
    why: '"Request to join in game", "DM the leader", a Discord invite: whatever the clan wants said.',
  },
};

/** POAP KINGS' pitch, from prompts/lanes/recruiting.md. */
export function defaultPitch() {
  return {
    schema: RECRUIT_SCHEMA_VERSION,
    tagline: "Compete, belong, be remembered",
    about:
      "We are a tight-knit Clash Royale clan serious about Clan Wars and built on purpose, not just filled. Real life comes first; showing up on war days is what we ask.",
    points: [
      "Serious about River Race and climbing the war ladder",
      "A Free Pass Royale for the top war contributor every season",
      "POAPs: collectible proof of seasons, milestones and clan history",
      "Elixir tracks wars, milestones and awards so nobody's effort goes unseen",
      "Warm, low-drama, worth staying in for the long run",
    ],
    looking_for:
      "Active players who want to climb, play their war days and build something lasting.",
    website_url: "https://poapkings.com",
    contact: "Request to join in game, or find us at poapkings.com.",
  };
}

const plain = (v, max) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** Validate a candidate pitch. Errors are keyed by field, in a leader's words. */
export function validatePitch(input = {}) {
  const errors = {};
  const values = { schema: RECRUIT_SCHEMA_VERSION };
  for (const [key, f] of Object.entries(PITCH_FIELDS)) {
    if (f.lines) {
      const lines = (
        Array.isArray(input[key])
          ? input[key]
          : String(input[key] ?? "").split("\n")
      )
        .map((l) => plain(l, f.max + 1))
        .filter(Boolean);
      if (lines.length > MAX_POINTS)
        errors[key] = `At most ${MAX_POINTS} points.`;
      else if (lines.some((l) => l.length > f.max))
        errors[key] = `Each point is at most ${f.max} characters.`;
      else if (lines.some((l) => l.includes("`")))
        errors[key] =
          "No backticks: they break the copy on Reddit and Discord.";
      values[key] = lines.slice(0, MAX_POINTS).map((l) => l.slice(0, f.max));
      continue;
    }
    const v = plain(input[key], f.max + 1);
    if (!v && !f.optional) errors[key] = `${f.label} is needed.`;
    else if (v.length > f.max)
      errors[key] = `${f.label} is at most ${f.max} characters.`;
    else if (v.includes("`"))
      errors[key] = "No backticks: they break the copy on Reddit and Discord.";
    else if (f.url && v && !/^https:\/\/[^\s]+$/.test(v))
      errors[key] = "A website is an https:// address.";
    values[key] = v.slice(0, f.max) || null;
  }
  const ok = Object.keys(errors).length === 0;
  return { ok, values: ok ? values : null, errors };
}

/**
 * The facts the copy may use, from the live /clans/{tag} payload (the CR
 * API's shape, through Elixir's live_fetch), or from a recorded roster
 * while the live read is pending. Only numbers the game states.
 */
export function factsFromClan(payload) {
  if (!payload) return null;
  const members = Array.isArray(payload.memberList) ? payload.memberList : [];
  const top = (key) =>
    members
      .filter((m) => (m[key] ?? 0) > 0)
      .sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0))
      .slice(0, 5)
      .map((m) => ({ name: m.name, value: m[key] }));
  return {
    name: payload.name ?? null,
    tag: payload.tag ?? null,
    type: payload.type ?? null,
    description: payload.description ?? null,
    members: payload.members ?? members.length,
    open_slots: Math.max(0, ROSTER_CAP - (payload.members ?? members.length)),
    required_trophies: payload.requiredTrophies ?? null,
    clan_score: payload.clanScore ?? null,
    war_trophies: payload.clanWarTrophies ?? null,
    donations_per_week: payload.donationsPerWeek ?? null,
    location: payload.location?.name ?? null,
    top_trophies: top("trophies"),
    top_donors: top("donations"),
    source: "live",
  };
}

/** The same facts from Elixir's recorded roster (no floor, no score). */
export function factsFromRoster(roster) {
  if (!roster) return null;
  const members = roster.members ?? [];
  const top = (key) =>
    members
      .filter((m) => (m[key] ?? 0) > 0)
      .sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0))
      .slice(0, 5)
      .map((m) => ({ name: m.name, value: m[key] }));
  return {
    name: roster.name ?? null,
    tag: roster.clan_tag ?? null,
    type: null,
    description: null,
    members: roster.member_count ?? members.length,
    open_slots: Math.max(
      0,
      ROSTER_CAP - (roster.member_count ?? members.length),
    ),
    required_trophies: null,
    clan_score: null,
    war_trophies: null,
    donations_per_week: null,
    location: null,
    top_trophies: top("trophies"),
    top_donors: top("donations_this_week"),
    source: "recorded",
  };
}

const n = (x) =>
  x === null || x === undefined ? null : Number(x).toLocaleString("en-US");
const floor = (facts) => facts?.required_trophies ?? null;
const floorText = (facts) =>
  floor(facts) === null ? "" : `${n(floor(facts))} trophies to join. `;
const clanName = (facts) => facts?.name ?? "our clan";

/** One or two numbers, the way the bot was told to use them: sparingly. */
function numbers(facts) {
  const bits = [];
  if (facts?.war_trophies) bits.push(`${n(facts.war_trophies)} war trophies`);
  if (facts?.clan_score) bits.push(`clan score ${n(facts.clan_score)}`);
  if (facts?.donations_per_week)
    bits.push(`${n(facts.donations_per_week)} cards donated a week`);
  return bits.slice(0, 2);
}
function slots(facts) {
  if (!facts) return "";
  return facts.open_slots > 0
    ? `${facts.open_slots} open slot${facts.open_slots === 1 ? "" : "s"} right now.`
    : "Full at the moment; ask and we will tell you when a slot opens.";
}

/**
 * The five channels the bot wrote for, from the pitch and the facts.
 * Deterministic: the same inputs give the same copy, and a member can
 * edit it before posting.
 */
export function recruitCopy(pitch, facts) {
  const name = clanName(facts);
  const tag = facts?.tag ?? "";
  const f = floor(facts);
  const nums = numbers(facts);
  const site = pitch.website_url ? ` ${pitch.website_url}` : "";
  const points = pitch.points ?? [];

  const message =
    `${name} is recruiting: ${pitch.tagline.toLowerCase()}. ${floorText(facts)}${pitch.looking_for}${site}`.trim();

  const social = [
    `${name} (${tag}) is looking for ${pitch.looking_for.replace(/\.$/, "").replace(/^Active players/, "active players")}.`,
    pitch.about.split(/(?<=\.)\s+/)[0],
    nums.length ? `${nums.join(", ")}.` : null,
    f !== null ? `${n(f)} trophies to join.${site}` : site.trim() || null,
  ]
    .filter(Boolean)
    .join(" ");

  const email = {
    subject: `Join ${name}: ${pitch.tagline}`,
    body: [
      `${pitch.about}`,
      points.length
        ? `What makes us different: ${points.map((p) => p.replace(/\.$/, "")).join("; ")}.`
        : null,
      `${pitch.looking_for} ${floorText(facts)}${slots(facts)}`.trim(),
      nums.length ? `Where we stand today: ${nums.join(", ")}.` : null,
      `${pitch.contact ?? "Request to join in game."}${site ? ` More at${site}.` : ""}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };

  const discordTitle = `${name}${tag ? ` (${tag})` : ""}: ${pitch.tagline}${f !== null ? ` Required Trophies: [${f}]` : ""}`;
  const discord = [
    `**${discordTitle}**`,
    pitch.about,
    ...points.map((p) => `- ${p}`),
    `${pitch.looking_for} ${slots(facts)}`.trim(),
    nums.length ? `Today: ${nums.join(", ")}.` : null,
    `${pitch.contact ?? "Request to join in game."}${site}`,
  ]
    .filter(Boolean)
    .join("\n");

  const reddit = {
    title: `${name} ${tag} - ${pitch.tagline}${f !== null ? ` [${f}]` : ""}`,
    body: [
      pitch.about,
      points.length
        ? `**What makes us different**\n${points.map((p) => `- ${p}`).join("\n")}`
        : null,
      `**Who we want**\n${pitch.looking_for} ${floorText(facts)}${slots(facts)}`.trim(),
      nums.length ? `**Where we stand**\n${nums.join(", ")}.` : null,
      `**How to join**\n${(pitch.contact ?? "Request to join in game.").replace(/https?:\/\/discord\S+/gi, "(ask for the invite)")}${tag ? ` Search ${tag} in game.` : ""}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };

  return { message, social, email, discord, reddit };
}

/**
 * elixir-bot's validator (_validate_promote_content_or_raise), carried:
 * what a member is allowed to paste where. Returns a list of problems,
 * empty when the copy passes.
 */
export function validateCopy(copy, requiredTrophies) {
  const problems = [];
  const all = [
    copy.message,
    copy.social,
    copy.email?.subject,
    copy.email?.body,
    copy.discord,
    copy.reddit?.title,
    copy.reddit?.body,
  ];
  if (all.some((t) => String(t ?? "").includes("`")))
    problems.push("no backticks in any field");
  if (requiredTrophies !== null && requiredTrophies !== undefined) {
    const need = `Required Trophies: [${requiredTrophies}]`;
    const first =
      String(copy.discord ?? "")
        .split("\n")
        .find((l) => l.trim()) ?? "";
    const unwrapped = first
      .trim()
      .replace(/^\*\*(.*)\*\*$/, "$1")
      .trim();
    if (!unwrapped.endsWith(need))
      problems.push(`discord first line must end with ${need}`);
    if (!String(copy.reddit?.title ?? "").includes(`[${requiredTrophies}]`))
      problems.push(`reddit title must include [${requiredTrophies}]`);
  }
  if (/discord\.gg|discord\.com\/invite/i.test(String(copy.reddit?.body ?? "")))
    problems.push("reddit body must not carry an invite link");
  for (const [k, t] of [
    ["message", copy.message],
    ["social", copy.social],
    ["email", copy.email?.body],
  ])
    if (/\*\*|^- /m.test(String(t ?? "")))
      problems.push(`${k} must be plain text`);
  const words = (t) =>
    String(t ?? "")
      .split(/\s+/)
      .filter(Boolean).length;
  if (words(copy.message) > 40) problems.push("message over 40 words");
  if (words(copy.social) > 80) problems.push("social over 80 words");
  return problems;
}
