/**
 * The morning evaluation (2026-09-25, the doors plan's door 1), one clan
 * per invocation (Jamie, 2026-09-26: "one clan per function call... and
 * stagger them so that we don't clobber the backend"). EventBridge invokes
 * the evaluate function with `{"scheduled":"evaluate"}` every two minutes
 * through the morning hour; each invocation claims the next clan on the
 * ledger's list (a policy saved or evaluated) not yet run today
 * (`morning#<clan>`, a conditional write, so two invocations never take the
 * same clan) and evaluates that one on Elixir Clan's own integration key
 * (`clans:read`, JSON API 2.3.0): actions wait for leaders, a closed
 * season's awards are granted, the standings go to Elixir, and each person
 * who can act on something new is emailed through Elixir (door 2). A clan
 * gets the function's whole time limit to itself, and Elixir sees one clan's
 * reads every two minutes rather than every clan's at once. No person's
 * token is stored or used. Each clan's run writes ONE log line; an
 * invocation with nothing left to do writes none. Without a key it does
 * nothing and says so.
 */

export function createScheduledRun({
  ledger,
  manage,
  awards = null,
  integrationKey,
  now = () => Date.now(),
  log = console,
}) {
  /** The next clan not yet run today, claimed; null when none is left. */
  async function claimNext(day, at) {
    for (const clan of await ledger.scheduledClans())
      if (await ledger.claimMorning(clan, day, at)) return clan;
    return null;
  }

  async function evaluate(clan) {
    try {
      const m = await manage.evaluateOnSchedule(clan, integrationKey);
      // Awards and standings are their own step: a failure there is
      // reported and never keeps the actions' email from going out.
      const a = awards
        ? await awards.evaluateOnSchedule(clan, integrationKey).catch((e) => ({
            awards_error: e?.code ?? String(e?.message ?? e).slice(0, 120),
          }))
        : null;
      // Then tell the people who can act on something new (door 2).
      // A mail failure is reported and never undoes the evaluation.
      const mail = manage.mailActionsWaiting
        ? await manage.mailActionsWaiting(clan, integrationKey).catch((e) => ({
            mail_error: e?.code ?? String(e?.message ?? e).slice(0, 120),
          }))
        : null;
      return { clan, ok: true, ...m, ...(a ?? {}), ...(mail ?? {}) };
    } catch (e) {
      // A clan without a policy or below 10 members is skipped as on a
      // visit; anything else is a failure worth reading.
      return {
        clan,
        ok: false,
        code: e?.code ?? "error",
        ...(e?.code ? {} : { error: String(e?.message ?? e).slice(0, 200) }),
      };
    }
  }

  return async function run() {
    const started = now();
    const at = new Date(started).toISOString();
    if (!integrationKey) {
      log.warn?.(
        JSON.stringify({
          at,
          level: "warn",
          scheduled: "evaluate",
          skipped: "no_integration_key",
        }),
      );
      return { skipped: "no_integration_key" };
    }
    const clan = await claimNext(at.slice(0, 10), at);
    if (!clan) return { scheduled: "evaluate", due: 0 };
    const result = await evaluate(clan);
    const failed =
      !result.ok && !["no_policy", "too_few_members"].includes(result.code);
    const line = {
      at: new Date(now()).toISOString(),
      // A clan evaluated but with a step that failed (standings, awards,
      // mail) is worth reading too.
      level:
        failed ||
        result.standings_failed ||
        result.awards_error ||
        result.mail_error
          ? "warn"
          : "info",
      scheduled: "evaluate",
      ms: now() - started,
      ...result,
    };
    (line.level === "warn" ? log.warn : log.info)?.(JSON.stringify(line));
    return line;
  };
}
