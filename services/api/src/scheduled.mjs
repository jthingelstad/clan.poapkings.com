/**
 * The morning evaluation (2026-09-25, the doors plan's door 1). EventBridge
 * invokes the function daily with `{"scheduled":"evaluate"}`; every clan on
 * the ledger's list (a policy saved or evaluated) is evaluated on Elixir
 * Clan's own integration key (`clans:read`, JSON API 2.3.0), so actions
 * wait for leaders and a closed season's awards are granted without anyone
 * visiting. No person's token is stored or used. One clan's failure never
 * stops the rest; the run ends with ONE log line saying what happened to
 * each clan. Without a key it does nothing and says so.
 */

export function createScheduledRun({
  ledger,
  manage,
  awards = null,
  integrationKey,
  now = () => Date.now(),
  log = console,
}) {
  return async function run() {
    const started = now();
    if (!integrationKey) {
      log.warn?.(
        JSON.stringify({
          at: new Date(started).toISOString(),
          level: "warn",
          scheduled: "evaluate",
          skipped: "no_integration_key",
        }),
      );
      return { skipped: "no_integration_key" };
    }
    const clans = await ledger.scheduledClans();
    const results = [];
    for (const clan of clans) {
      try {
        const m = await manage.evaluateOnSchedule(clan, integrationKey);
        const a = awards
          ? await awards.evaluateOnSchedule(clan, integrationKey)
          : null;
        results.push({ clan, ok: true, ...m, ...(a ?? {}) });
      } catch (e) {
        // A clan without a policy or below 10 members is skipped as on a
        // visit; anything else is a failure worth reading.
        results.push({
          clan,
          ok: false,
          code: e?.code ?? "error",
          ...(e?.code ? {} : { error: String(e?.message ?? e).slice(0, 200) }),
        });
      }
    }
    const failed = results.filter(
      (r) => !r.ok && !["no_policy", "too_few_members"].includes(r.code),
    );
    const summary = {
      at: new Date(now()).toISOString(),
      level: failed.length ? "warn" : "info",
      scheduled: "evaluate",
      clans: clans.length,
      evaluated: results.filter((r) => r.ok).length,
      failed: failed.length,
      ms: now() - started,
      results,
    };
    (failed.length ? log.warn : log.info)?.(JSON.stringify(summary));
    return summary;
  };
}
