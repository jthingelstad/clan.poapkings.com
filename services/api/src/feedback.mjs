/**
 * Feedback: what a person tells the maintainer and what was done about it.
 * Elixir's system, carried nearly verbatim (Jamie, 2026-09-12: "the system
 * we have for Elixir is good as it is"): a category and a Markdown note
 * from the person, with the page and clan it was written on attached; a
 * status and a Markdown reply from the maintainer; the person sees every
 * status and reply on their own list. Nothing is actioned invisibly.
 *
 * People only, for now: agents do not use Elixir Clan. The MAINTAINER is
 * not a clan role (in-game role is the app role, and this is not a clan's
 * business): it is the product's, named by verified player tag in the
 * stack's MaintainerTags parameter.
 *
 * Differences from Elixir, both because of what this product is: a
 * `judgment` category (the engine judged a member wrongly is the report
 * this product will get most), and no request_id (there are no calls to
 * attach; the page and clan ride along instead).
 */

import { randomBytes } from "node:crypto";

export const CATEGORIES = [
  "general",
  "bug",
  "judgment",
  "data_quality",
  "feature",
  "praise",
];
export const STATUSES = ["new", "seen", "planned", "done", "declined"];
const MESSAGE_MAX = 4000;

export class FeedbackError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function createFeedbackService({
  ledger,
  now = () => Date.now(),
  notify = async () => {},
  log = console,
}) {
  const newId = () => randomBytes(6).toString("base64url");

  /** What the person sees of an item: theirs in full, never another's. */
  const mine = (f) => ({
    feedback_id: f.feedback_id,
    category: f.category,
    message: f.message,
    context: f.context ?? null,
    status: f.status,
    response: f.response ?? null,
    responded_at: f.responded_at ?? null,
    response_seen_at: f.response_seen_at ?? null,
    shipped_in: f.shipped_in ?? null,
    created_at: f.created_at,
  });

  return {
    async list(person) {
      const all = await ledger.feedback();
      return all
        .filter((f) => f.person_tag === person.player_tag)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .slice(0, 50)
        .map(mine);
    },

    /** Replies not yet seen: the count for the chrome's marker. */
    async unseen(person) {
      const all = await ledger.feedback();
      return all.filter(
        (f) =>
          f.person_tag === person.player_tag &&
          f.response &&
          !f.response_seen_at,
      ).length;
    },

    async file(person, { message, category, context }) {
      const text = String(message ?? "").trim();
      if (!text || text.length > MESSAGE_MAX)
        throw new FeedbackError(400, "bad_message");
      const cat = CATEGORIES.includes(category) ? category : "general";
      const item = {
        feedback_id: newId(),
        person_tag: person.player_tag,
        person_name: person.name ?? null,
        category: cat,
        message: text,
        // The page and clan it was written on, attached by the client and
        // capped; a report about a page should not have to name the page.
        context: context
          ? {
              path: String(context.path ?? "").slice(0, 200) || null,
              clan_tag: String(context.clan_tag ?? "").slice(0, 12) || null,
              clan_name: String(context.clan_name ?? "").slice(0, 40) || null,
              role: String(context.role ?? "").slice(0, 12) || null,
            }
          : null,
        status: "new",
        created_at: new Date(now()).toISOString(),
      };
      await ledger.putFeedback(item);
      // The maintainer hears about it: best-effort, never in the way of
      // the row that was just written, and never for their own.
      if (!person.maintainer) {
        try {
          await notify({
            kind: "feedback",
            feedback_id: item.feedback_id,
            category: cat,
            from: `${item.person_name ?? "a member"} (${item.person_tag})`,
            clan_tag: item.context?.clan_tag ?? null,
            clan_name: item.context?.clan_name ?? null,
            excerpt: text.replace(/\s+/g, " ").slice(0, 300),
          });
        } catch (err) {
          log.error?.("feedback_notify_failed", { error: err?.message });
        }
      }
      return mine(item);
    },

    /** One of the person's own items; opening it marks the reply seen. */
    async item(person, feedbackId) {
      const f = await ledger.feedbackItem(feedbackId);
      if (!f || f.person_tag !== person.player_tag)
        throw new FeedbackError(404, "no_feedback");
      if (f.response && !f.response_seen_at) {
        f.response_seen_at = new Date(now()).toISOString();
        await ledger.putFeedback(f);
      }
      return mine(f);
    },

    // ---- the maintainer's lane ------------------------------------------
    async queue(person) {
      if (!person.maintainer) throw new FeedbackError(403, "maintainer_only");
      const all = await ledger.feedback();
      return all
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .slice(0, 200);
    },

    async decide(person, feedbackId, { status, response, shipped_in }) {
      if (!person.maintainer) throw new FeedbackError(403, "maintainer_only");
      const f = await ledger.feedbackItem(feedbackId);
      if (!f) throw new FeedbackError(404, "no_feedback");
      if (status !== undefined && !STATUSES.includes(status))
        throw new FeedbackError(400, "bad_status");
      const reply = response
        ? String(response).trim().slice(0, MESSAGE_MAX)
        : "";
      const next = { ...f };
      if (status) next.status = status;
      if (reply) {
        next.response = reply;
        next.responded_at = new Date(now()).toISOString();
        // A new reply is unseen again, whatever the last one was.
        next.response_seen_at = null;
      }
      if (shipped_in !== undefined)
        next.shipped_in = String(shipped_in ?? "").slice(0, 80) || null;
      await ledger.putFeedback(next);
      return next;
    },
  };
}
