/**
 * The clan's own model (2026-09-25): bring your own tokens. Elixir Clan
 * funds no model use (VISION, principle 8); a leader or co-leader adds
 * the clan's Anthropic API key, and the clan's model may then write words
 * for the uses the engine names (`PURPOSES` in `words.mjs`), never a
 * judgment about a member.
 *
 * The key:
 *  - is checked with Anthropic before it is kept (the model list: it
 *    spends nothing); an Admin key is refused;
 *  - is kept sealed (AES-256-GCM, a key derived from the app's secret for
 *    this use only, bound to the clan and the person who added it) in its
 *    own item, outside the clan's index, and is never shown again: people
 *    see its last four characters, who added it and when;
 *  - is used only while the person who added it is a leader or co-leader
 *    of the clan: it is their account that pays;
 *  - is used only by leaders and co-leaders, at most `USES_PER_DAY` times a
 *    day per clan, and every use is recorded (who, what for, the model,
 *    the tokens), kept `USE_KEEP_DAYS` days for the leaders to read.
 *
 * Rotating the app's session secret makes every kept key unreadable; the
 * page then asks for it again.
 */

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { PURPOSES, chooseModel } from "@elixir-clan/engine";
import { ManageError } from "./service.mjs";

export const USES_PER_DAY = 20;
export const USE_KEEP_DAYS = 90;
const LEADERS = new Set(["leader", "coLeader"]);
const KEY_SHAPE = /^sk-ant-[A-Za-z0-9_-]{20,200}$/;

/** Seal and open a clan's key under a key derived from the app secret. */
export function sealer(secret) {
  const key = Buffer.from(
    hkdfSync("sha256", secret, "elixir-clan", "clan model key v1", 32),
  );
  return {
    seal(plain, aad) {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", key, iv);
      c.setAAD(Buffer.from(aad));
      const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
      return {
        v: 1,
        iv: iv.toString("base64"),
        tag: c.getAuthTag().toString("base64"),
        ct: ct.toString("base64"),
      };
    },
    /** The plain key, or null when it cannot be opened here. */
    open(box, aad) {
      try {
        const d = createDecipheriv(
          "aes-256-gcm",
          key,
          Buffer.from(box.iv, "base64"),
        );
        d.setAAD(Buffer.from(aad));
        d.setAuthTag(Buffer.from(box.tag, "base64"));
        return Buffer.concat([
          d.update(Buffer.from(box.ct, "base64")),
          d.final(),
        ]).toString("utf8");
      } catch {
        return null;
      }
    },
  };
}

const boundTo = (clanTag, playerTag) => `${clanTag}|${playerTag}`;

/** Anthropic's refusal of a key, in a leader's words. */
function refusedKey(r) {
  if (r.status === 401)
    return new ManageError(400, "key_refused", null, {
      message: "Anthropic did not accept this key.",
    });
  if (r.status === 403)
    return new ManageError(400, "key_refused", null, {
      message: "This key is not allowed to use Anthropic's API.",
    });
  if (r.status === 429)
    return new ManageError(429, "anthropic_busy", null, {
      message: "Anthropic asked us to slow down. Try again in a minute.",
    });
  return new ManageError(502, "anthropic_unavailable", null, {
    message: "Anthropic did not answer. Try again in a minute.",
  });
}

export function createModelService({
  ledger,
  anthropic,
  secret,
  /** (token, clanTag) → the clans_roster answer, or null */
  rosterFor,
  now = () => Date.now(),
}) {
  if (!secret) throw new Error("the model service needs the app secret");
  const box = sealer(secret);
  const isLeader = (who) => LEADERS.has(who.role);
  const requireLeader = (who) => {
    if (!isLeader(who)) throw new ManageError(403, "leaders_only");
  };
  const iso = () => new Date(now()).toISOString();

  /** Is the person who added the key still a leader here? null: unknown. */
  async function ownerLeads(clanTag, stored, token) {
    const roster = token ? await rosterFor(token, clanTag) : null;
    if (!roster) return null;
    const m = (roster.members ?? []).find(
      (x) => x.player_tag === stored.set_by,
    );
    return Boolean(m && LEADERS.has(m.role));
  }

  return {
    /** Cheap, for pages that offer a use: is there a key, and is it good? */
    async summary(clanTag) {
      const stored = await ledger.modelKey(clanTag);
      return {
        set: Boolean(stored),
        refused: Boolean(stored?.refused_at),
        model: stored?.model ?? null,
      };
    },

    /** What leaders see about the key: never the key. */
    async status(clanTag, who, token) {
      requireLeader(who);
      const stored = await ledger.modelKey(clanTag);
      const t = now();
      const today = new Date(t).toISOString().slice(0, 10);
      const month = today.slice(0, 7);
      const calls = await ledger.modelCalls(clanTag, month);
      const base = {
        clan_tag: clanTag,
        purposes: PURPOSES,
        per_day: USES_PER_DAY,
        keep_days: USE_KEEP_DAYS,
        uses: {
          today: calls.filter((c) => c.at.startsWith(today)).length,
          month: {
            count: calls.length,
            input_tokens: calls.reduce((s, c) => s + (c.input_tokens ?? 0), 0),
            output_tokens: calls.reduce(
              (s, c) => s + (c.output_tokens ?? 0),
              0,
            ),
          },
          recent: calls
            .slice(-10)
            .reverse()
            .map((c) => ({
              at: c.at,
              by: c.by,
              by_name: c.by_name ?? null,
              purpose: c.purpose,
              model: c.model,
              ok: c.ok,
              code: c.code ?? null,
              input_tokens: c.input_tokens ?? null,
              output_tokens: c.output_tokens ?? null,
            })),
        },
      };
      if (!stored) return { ...base, set: false };
      const readable =
        box.open(stored.sealed, boundTo(clanTag, stored.set_by)) !== null;
      const leads = await ownerLeads(clanTag, stored, token);
      return {
        ...base,
        set: true,
        hint: stored.hint,
        set_by: stored.set_by,
        set_by_name: stored.set_by_name ?? null,
        set_at: stored.set_at,
        model: stored.model,
        models: stored.models ?? [],
        refused_at: stored.refused_at ?? null,
        readable,
        owner_leads: leads,
        usable: readable && !stored.refused_at && leads !== false,
      };
    },

    /** Add (or replace) the clan's key: checked with Anthropic first. */
    async setKey(clanTag, who, { key, model = null } = {}) {
      requireLeader(who);
      const k = String(key ?? "").trim();
      if (/^sk-ant-admin/.test(k))
        throw new ManageError(400, "admin_key", null, {
          message:
            "That is an Admin key. Add an API key from the Anthropic Console instead.",
        });
      if (!KEY_SHAPE.test(k))
        throw new ManageError(400, "not_a_key", null, {
          message: "An Anthropic API key starts with sk-ant-.",
        });
      const r = await anthropic.models(k);
      if (!r.ok) throw refusedKey(r);
      const models = r.models.filter((m) => /^claude-/.test(m.id));
      const chosen =
        model && models.some((m) => m.id === model)
          ? model
          : chooseModel(models.map((m) => m.id));
      if (!chosen)
        throw new ManageError(400, "no_models", null, {
          message: "This key cannot reach any Claude model.",
        });
      await ledger.saveModelKey(clanTag, {
        sealed: box.seal(k, boundTo(clanTag, who.player_tag)),
        hint: `sk-ant-…${k.slice(-4)}`,
        set_by: who.player_tag,
        set_by_name: who.name ?? null,
        set_at: iso(),
        model: chosen,
        models,
        refused_at: null,
      });
      return { ok: true, model: chosen };
    },

    /** Choose which of the key's models writes. */
    async setModel(clanTag, who, model) {
      requireLeader(who);
      const stored = await ledger.modelKey(clanTag);
      if (!stored) throw new ManageError(409, "no_model_key");
      if (!(stored.models ?? []).some((m) => m.id === model))
        throw new ManageError(400, "unknown_model", null, {
          message: "That model is not one this key can reach.",
        });
      await ledger.saveModelKey(clanTag, { ...stored, model });
      return { ok: true, model };
    },

    /** Remove the clan's key. Its uses stay on record. */
    async removeKey(clanTag, who) {
      requireLeader(who);
      await ledger.removeModelKey(clanTag);
    },

    /**
     * Words from the clan's model for one purpose: the engine's request
     * (`words.mjs`) on the clan's key. Returns the tool's input; the
     * caller checks it and a person edits it.
     */
    async write(clanTag, who, token, request) {
      requireLeader(who);
      if (!PURPOSES[request?.purpose])
        throw new ManageError(400, "unknown_purpose");
      const stored = await ledger.modelKey(clanTag);
      if (!stored) throw new ManageError(409, "no_model_key");
      if (stored.refused_at) throw new ManageError(409, "model_key_refused");
      const key = box.open(stored.sealed, boundTo(clanTag, stored.set_by));
      if (!key) throw new ManageError(409, "model_key_unreadable");
      if ((await ownerLeads(clanTag, stored, token)) === false)
        throw new ManageError(409, "model_key_owner_left", null, {
          set_by_name: stored.set_by_name ?? stored.set_by,
        });
      const today = iso().slice(0, 10);
      if ((await ledger.modelCalls(clanTag, today)).length >= USES_PER_DAY)
        throw new ManageError(429, "model_daily_limit", null, {
          per_day: USES_PER_DAY,
        });
      const r = await anthropic.write(key, {
        model: stored.model,
        system: request.system,
        prompt: request.prompt,
        tool: request.tool,
        max_tokens: request.max_tokens,
      });
      await ledger.addModelCall(clanTag, {
        at: iso(),
        by: who.player_tag,
        by_name: who.name ?? null,
        purpose: request.purpose,
        model: r.model ?? stored.model,
        ok: r.ok,
        status: r.status ?? null,
        code: r.ok ? null : (r.code ?? null),
        input_tokens: r.usage?.input_tokens ?? null,
        output_tokens: r.usage?.output_tokens ?? null,
        ttl: Math.floor(now() / 1000) + USE_KEEP_DAYS * 86400,
      });
      if (r.ok)
        return { input: r.input, model: r.model, usage: r.usage ?? null };
      if (r.status === 401 || r.status === 403) {
        await ledger.saveModelKey(clanTag, { ...stored, refused_at: iso() });
        throw new ManageError(409, "model_key_refused");
      }
      if (r.status === 404)
        throw new ManageError(409, "model_unavailable", null, {
          model: stored.model,
        });
      if (r.status === 429 || r.status === 529)
        throw new ManageError(429, "anthropic_busy", null, {
          message: "Anthropic is busy. Try again in a minute.",
        });
      throw new ManageError(502, "model_failed", null, {
        message: r.message ?? "The model did not answer.",
      });
    },
  };
}
