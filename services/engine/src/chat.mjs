/**
 * Words that go into the game: clan chat lines and Clan Leader Messages.
 * Clash Royale's chat filter silently blanks some innocent text to
 * asterisks, often taking the neighbouring words with it, and every rule
 * here was learned in production from a message that came out censored
 * (the game reference, cr-agent-api-docs `wiki-api-crosswalk.md`, keeps the
 * observations with their dates):
 *
 *  - `&` between words blanks the `&` and both flanking words: write "and";
 *  - `+` directly before digits reads as a phone number: drop the `+`;
 *  - a hyphen joining two word-parts (a member name like "Ab-Cdef") reads
 *    as a handle and the whole token disappears: write it with a space;
 *    a space-flanked dash ("week - done") passes;
 *  - "phone" reads as contact-sharing and takes the word before it along:
 *    write "device";
 *  - chat is plain text: links, Discord formatting and mentions and emoji
 *    shortcodes come through as clutter or trip the link filter, so they
 *    never go in;
 *  - some slang is blocked whatever the meaning ("edging"): flag it;
 *  - scoring internals (a rank "5 of 39", a score, the band) never reach a
 *    member.
 *
 * One case was seen and not explained ("Season 135 is underway" blanked
 * while "134" passed); no rule is guessed for it.
 */

export const CHAT_MAX = 200;
/** A welcome reads best short. */
export const WELCOME_MAX = 120;

const AMP = /\s*&\s*/g;
const PLUS_DIGITS = /\+(?=\d)/g;
const INNER_HYPHEN = /(?<=\w)-(?=\w)/g;
const WORD_SUBS = [
  [/\bphones\b/gi, "devices"],
  [/\bphone\b/gi, "device"],
];

const matchCase = (original, replacement) =>
  original === original.toUpperCase() && original !== original.toLowerCase()
    ? replacement.toUpperCase()
    : original[0] === original[0].toUpperCase()
      ? replacement[0].toUpperCase() + replacement.slice(1)
      : replacement;

/** Rewrite what the filter would blank; one plain line. */
export function chatSafe(text) {
  let out = String(text ?? "")
    .replace(AMP, " and ")
    .replace(PLUS_DIGITS, "")
    .replace(INNER_HYPHEN, " ");
  for (const [pattern, word] of WORD_SUBS)
    out = out.replace(pattern, (m) => matchCase(m, word));
  return out.replace(/\s+/g, " ").trim();
}

const SENTENCE_END = /[.!?](?=\s|$)/g;

/** Clip to a length, ending on a whole sentence when one ends in the back
 *  half, else at a word with "..." (three dots, which the game shows as
 *  written). */
export function clipChat(text, max = CHAT_MAX) {
  const body = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (body.length <= max) return body;
  const window = body.slice(0, max);
  const ends = [...window.matchAll(SENTENCE_END)].map((m) => m.index + 1);
  if (ends.length && ends.at(-1) >= Math.floor(max / 2))
    return window.slice(0, ends.at(-1)).trimEnd();
  let cut = body.slice(0, Math.max(0, max - 3));
  const space = cut.lastIndexOf(" ");
  if (space > 0) cut = cut.slice(0, space);
  return `${cut.replace(/[\s.,;:]+$/, "")}...`;
}

/** Scoring internals a member must never read in the game. */
const INTERNALS = [
  /\bscores?\s+\d/i,
  /\brank(?:ed)?\s+\d+\s*(?:of|\/)\s*\d+/i,
  /\b\d+(?:st|nd|rd|th)\s+(?:of|\/)\s*\d+/i,
  /\bband\s+\d+\s*[-–]\s*\d+/i,
  /\bpercentile\b/i,
  /\b0\.\d+\b/,
];

/** Slang the filter blocks whatever the meaning. */
const BLOCKED_WORDS = [/\bedging\b/i];

/**
 * What in a line (as a person edited it) the game would blank, render as
 * literal text, or should never show a member, in a leader's words; empty
 * when it is safe to paste.
 */
export function chatWarnings(text, max = CHAT_MAX) {
  const t = String(text ?? "");
  const out = [];
  if (t.length > max) out.push(`longer than the game's ${max} characters`);
  if (/&/.test(t)) out.push('"&" (write "and")');
  if (/\+\d/.test(t)) out.push('"+" before a number (drop the "+")');
  if (/\w-\w/.test(t))
    out.push("a hyphen inside a word, even in a name (use a space)");
  if (/\bphones?\b/i.test(t)) out.push('"phone" (write "device")');
  if (/https?:\/\/|www\./i.test(t)) out.push("a link");
  if (/\*\*|__|`|\]\(|<[@#]|@(everyone|here)\b/i.test(t))
    out.push("Discord formatting or a mention");
  if (/:[a-z0-9_]+:/i.test(t)) out.push("an emoji shortcode");
  if (BLOCKED_WORDS.some((re) => re.test(t)))
    out.push("a word the filter blocks as slang");
  if (INTERNALS.some((re) => re.test(t)))
    out.push("a score, rank or band, which members never see");
  return out;
}
