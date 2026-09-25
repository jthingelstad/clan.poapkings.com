/**
 * Recruiting: copy any member can paste, written from templates over two
 * things: the clan's own PITCH (a leader's words, versioned like policy)
 * and live FACTS from the game (one live read of the clan through Elixir,
 * cached). Two formats (Jamie, 2026-09-25): a PERSONAL note to send one
 * person by email or message, and a public POST for a recruiting forum
 * such as a Discord server's recruiting channel or r/RoyaleRecruit. The
 * post carries the forums' requirements on its own: the clan's required
 * trophies in brackets in the title (and as "Required Trophies: [N]" in the
 * body), and no invite link in the body.
 *
 * Every clan starts with an empty pitch: nothing is said for a clan until
 * its leaders say it. Pure: pitch + facts in, copy out.
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
    why: "Linked from the personal note and the post. Leave empty for none.",
  },
  contact: {
    label: "How to get in",
    max: 120,
    optional: true,
    why: '"Request to join in game", "DM the leader", a Discord invite: whatever the clan wants said. Invite links are left out of the public post, where forums remove them.',
  },
};

/** A clan's pitch before its leaders write one: empty. */
export function defaultPitch() {
  return {
    schema: RECRUIT_SCHEMA_VERSION,
    tagline: "",
    about: "",
    points: [],
    looking_for: "",
    website_url: "",
    contact: "",
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
        errors[key] = "No backticks: they break the copy on the forums.";
      values[key] = lines.slice(0, MAX_POINTS).map((l) => l.slice(0, f.max));
      continue;
    }
    const v = plain(input[key], f.max + 1);
    if (!v && !f.optional) errors[key] = `${f.label} is needed.`;
    else if (v.length > f.max)
      errors[key] = `${f.label} is at most ${f.max} characters.`;
    else if (v.includes("`"))
      errors[key] = "No backticks: they break the copy on the forums.";
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

/**
 * The same facts from Elixir's recorded roster while the live read is
 * pending. The record carries the clan's type, description, clan score and
 * war trophies as its last roster poll saw them (`clans_roster`), and they
 * are used when present; it carries no join floor, no donations a week and
 * no location name, so those stay null until the live read lands.
 */
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
    type: roster.type ?? null,
    description: roster.description ?? null,
    members: roster.member_count ?? members.length,
    open_slots: Math.max(
      0,
      ROSTER_CAP - (roster.member_count ?? members.length),
    ),
    required_trophies: null,
    clan_score: roster.clan_score ?? null,
    war_trophies: roster.clan_war_trophies ?? null,
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

/** One or two numbers from the game, used sparingly. */
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

/** Invite links are removed from the public post: forums remove the post. */
const INVITE_RE =
  /https?:\/\/(?:www\.)?(?:discord\.gg|discord\.com\/invite)\S*/gi;

/**
 * The two formats, from the pitch and the facts. Deterministic: the same
 * inputs give the same copy, and a member can edit it before sending.
 */
export function recruitCopy(pitch, facts) {
  const name = clanName(facts);
  const tag = facts?.tag ?? "";
  const f = floor(facts);
  const nums = numbers(facts);
  const site = pitch.website_url ? ` ${pitch.website_url}` : "";
  const points = pitch.points ?? [];
  const contact = pitch.contact || "Request to join in game.";

  const personal = {
    subject: `Join ${name}: ${pitch.tagline}`,
    body: [
      pitch.about,
      points.length
        ? `What makes us different: ${points.map((p) => p.replace(/\.$/, "")).join("; ")}.`
        : null,
      `${pitch.looking_for} ${floorText(facts)}${slots(facts)}`.trim(),
      nums.length ? `Where we stand today: ${nums.join(", ")}.` : null,
      `${contact}${tag ? ` Search ${tag} in game.` : ""}${site ? ` More at${site}.` : ""}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };

  const post = {
    title: `${name}${tag ? ` ${tag}` : ""} - ${pitch.tagline}${f !== null ? ` [${f}]` : ""}`,
    body: [
      pitch.about,
      points.length
        ? `**What makes us different**\n${points.map((p) => `- ${p}`).join("\n")}`
        : null,
      `**Who we want**\n${pitch.looking_for} ${slots(facts)}`.trim(),
      f !== null ? `Required Trophies: [${f}]` : null,
      nums.length ? `**Where we stand**\n${nums.join(", ")}.` : null,
      `**How to join**\n${contact.replace(INVITE_RE, "(ask for the invite)")}${tag ? ` Search ${tag} in game.` : ""}${site}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };

  return { personal, post };
}

/**
 * What a member may paste where, checked on the copy as it stands (a
 * member can edit before copying). Returns a list of problems, empty when
 * the copy passes.
 */
export function validateCopy(copy, requiredTrophies) {
  const problems = [];
  const all = [
    copy.personal?.subject,
    copy.personal?.body,
    copy.post?.title,
    copy.post?.body,
  ];
  if (all.some((t) => String(t ?? "").includes("`")))
    problems.push("no backticks in any field");
  if (requiredTrophies !== null && requiredTrophies !== undefined) {
    if (!String(copy.post?.title ?? "").includes(`[${requiredTrophies}]`))
      problems.push(`the post title carries [${requiredTrophies}]`);
    if (
      !String(copy.post?.body ?? "").includes(
        `Required Trophies: [${requiredTrophies}]`,
      )
    )
      problems.push(`the post says Required Trophies: [${requiredTrophies}]`);
  }
  if (new RegExp(INVITE_RE.source, "i").test(String(copy.post?.body ?? "")))
    problems.push("the post body carries no invite link");
  if (/\*\*|^- /m.test(String(copy.personal?.body ?? "")))
    problems.push("the personal note is plain text");
  return problems;
}
