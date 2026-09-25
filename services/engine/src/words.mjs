/**
 * Words by the clan's own model (2026-09-25): what a clan's own Anthropic
 * key may be used for, the request for each use, and the check on each
 * answer. A model writes WORDS, never judgments (VISION, principle 5):
 *
 *  - the uses are a closed list (`PURPOSES`); nothing about a member is
 *    ever one of them;
 *  - a request carries clan-level facts only: the game's numbers for the
 *    clan, what it is for, how it runs, its own words. Never a member's
 *    name or numbers;
 *  - every answer is checked here and handed to a person to edit and
 *    save. Nothing a model writes is saved or sent by itself.
 *
 * Pure: context in, request out; answer in, values out.
 */

import { MAX_POINTS, PITCH_FIELDS, validatePitch } from "./recruit.mjs";
import { GOALS, POSTURES } from "./goals.mjs";
import { clipChat } from "./chat.mjs";

/** What a clan's model may write. */
export const PURPOSES = {
  recruit_pitch: {
    label: "Recruiting pitch",
    why: "Drafts the clan's recruiting words for a leader to edit and save.",
  },
};

/**
 * Models a clan's key may use, the first one the key can reach chosen
 * by default: a writer that is good and inexpensive for short copy, then
 * the rest. A leader may pick any model the key lists.
 */
export const MODEL_PREFERENCE = [
  "claude-sonnet-5",
  "claude-opus-5-5",
  "claude-haiku-4-5-20251001",
];

/** The default model among the ids a key can reach, or null. */
export function chooseModel(ids = []) {
  const reach = new Set(ids);
  return (
    MODEL_PREFERENCE.find((id) => reach.has(id)) ??
    ids.find((id) => /^claude-/.test(id)) ??
    null
  );
}

/** A leader's note to the model is short. */
export const NOTE_MAX = 300;

const TYPE = { open: "open", inviteOnly: "invite only", closed: "closed" };
const n = (x) => Number(x).toLocaleString("en-US");

/** The game's facts about the clan as lines, never a member. */
function factLines(facts) {
  if (!facts) return [];
  const out = [];
  if (facts.type) out.push(`Joining: ${TYPE[facts.type] ?? facts.type}.`);
  if (facts.members != null)
    out.push(
      `Members: ${facts.members} of 50${facts.open_slots != null ? ` (${facts.open_slots} places open)` : ""}.`,
    );
  if (facts.required_trophies != null)
    out.push(`Required trophies to join: ${n(facts.required_trophies)}.`);
  if (facts.clan_score != null) out.push(`Clan score: ${n(facts.clan_score)}.`);
  if (facts.war_trophies != null)
    out.push(`Clan war trophies: ${n(facts.war_trophies)}.`);
  if (facts.donations_per_week != null)
    out.push(`Donations a week: ${n(facts.donations_per_week)}.`);
  if (facts.location) out.push(`Location: ${facts.location}.`);
  if (facts.description)
    out.push(`The clan's in-game description: "${facts.description}"`);
  return out;
}

const PITCH_TOOL = {
  name: "write_pitch",
  description:
    "The clan's recruiting pitch, for its leaders to edit before anything is posted.",
  input_schema: {
    type: "object",
    properties: {
      tagline: {
        type: "string",
        description: `What the clan is in about six words (at most ${PITCH_FIELDS.tagline.max} characters). No clan name, no numbers.`,
      },
      about: {
        type: "string",
        description: `Two or three plain sentences a member could say out loud (at most ${PITCH_FIELDS.about.max} characters). No statistics.`,
      },
      points: {
        type: "array",
        items: { type: "string" },
        maxItems: MAX_POINTS,
        description: `Up to ${MAX_POINTS} short points (each at most ${PITCH_FIELDS.points.max} characters) on what makes the clan different, from what you were told only.`,
      },
      looking_for: {
        type: "string",
        description: `One sentence on the player who will be happy here (at most ${PITCH_FIELDS.looking_for.max} characters).`,
      },
    },
    required: ["tagline", "about", "points", "looking_for"],
  },
};

const PITCH_SYSTEM = [
  "You draft recruiting words for a Clash Royale clan, in its leaders' voice: plain, warm and specific, the way a player would say it. A leader edits your draft before anything is posted.",
  "Rules:",
  "- Use only what you are told about the clan. Never invent a number, a tradition, a reward, an event, a schedule or a rule. When you know little, write less.",
  "- Keep statistics out of the words: the clan's numbers (trophies, required trophies, members, war trophies, donations) are added to every post from the game.",
  "- Never name a member. No links, emoji, hashtags, markdown or backticks.",
  "- Keep to the limits in the tool's fields.",
  "- Write in English unless the leader's note asks for another language.",
  "Answer by calling write_pitch.",
].join("\n");

/**
 * The request for a recruiting pitch: the system words, the prompt, the
 * answer's shape, and the output budget. `howItWorks` is the policy as
 * members read it (`describePolicy`), `pitch` the clan's current words
 * (null for a first pitch), `note` what the leader asks for.
 */
export function pitchRequest({
  clanName = null,
  facts = null,
  goals = [],
  posture = null,
  howItWorks = [],
  pitch = null,
  note = null,
} = {}) {
  const lines = [
    `The clan: ${clanName ?? facts?.name ?? "a Clash Royale clan"}.`,
  ];
  const game = factLines(facts);
  if (game.length) lines.push("", "What the game says about it:", ...game);
  if (goals.length)
    lines.push(
      "",
      "What the clan is for, in its leaders' words:",
      ...goals.map(
        (g) => `- ${GOALS[g]?.label ?? g}: ${GOALS[g]?.about ?? ""}`,
      ),
    );
  if (posture && POSTURES[posture])
    lines.push(`- How hard it asks: ${POSTURES[posture].about}`);
  const rules = howItWorks.flatMap((s) => s.lines ?? []);
  if (rules.length)
    lines.push(
      "",
      "How it runs (its saved policy):",
      ...rules.map((l) => `- ${l}`),
    );
  if (pitch && (pitch.tagline || pitch.about))
    lines.push(
      "",
      "Its current pitch (improve it; keep what is true):",
      `Tagline: ${pitch.tagline ?? ""}`,
      `About: ${pitch.about ?? ""}`,
      ...(pitch.points ?? []).map((p) => `Point: ${p}`),
      `Looking for: ${pitch.looking_for ?? ""}`,
    );
  const ask = String(note ?? "")
    .trim()
    .slice(0, NOTE_MAX);
  if (ask) lines.push("", `The leader's note: ${ask}`);
  return {
    purpose: "recruit_pitch",
    max_tokens: 1200,
    system: PITCH_SYSTEM,
    prompt: lines.join("\n"),
    tool: PITCH_TOOL,
  };
}

const tidy = (v) =>
  String(v ?? "")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/[`*_#]+/g, "")
    .replace(/^\s*[-•]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

const numbersIn = (text) =>
  String(text ?? "")
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .match(/\b\d+(?:\.\d+)?\b/g) ?? [];

/**
 * A model's answer as a pitch a leader can edit: tidied (no links,
 * markdown or bullets), clipped to each field's limit at a sentence, the
 * clan's own website and contact kept (a model never writes those), then
 * validated. `checks` are what a leader should look at before saving: a
 * number the model was not given (`prompt` is the request it answered).
 */
export function pitchFromDraft(input, current = null, { prompt = "" } = {}) {
  const a = input && typeof input === "object" ? input : {};
  const points = (Array.isArray(a.points) ? a.points : [])
    .map(tidy)
    .filter(Boolean)
    .slice(0, MAX_POINTS)
    .map((p) => clipChat(p, PITCH_FIELDS.points.max));
  const draft = {
    tagline: clipChat(tidy(a.tagline), PITCH_FIELDS.tagline.max),
    about: clipChat(tidy(a.about), PITCH_FIELDS.about.max),
    points,
    looking_for: clipChat(tidy(a.looking_for), PITCH_FIELDS.looking_for.max),
    website_url: current?.website_url ?? "",
    contact: current?.contact ?? "",
  };
  const known = new Set(numbersIn(prompt));
  const numbers = [
    ...new Set(
      numbersIn(
        [draft.tagline, draft.about, ...draft.points, draft.looking_for].join(
          " ",
        ),
      ).filter((x) => !known.has(x)),
    ),
  ];
  const checked = validatePitch(draft);
  return {
    values: draft,
    errors: checked.errors,
    checks: numbers.length
      ? [
          `Check before saving: ${numbers.map((x) => Number(x).toLocaleString("en-US")).join(", ")} ${numbers.length === 1 ? "was" : "were"} not in anything the model was told about the clan.`,
        ]
      : [],
  };
}
