/** The clock vocabulary Elixir uses, so "4m ago" means the same thing on
 *  both sites. Relative deltas only; an absolute wall-clock time is a
 *  timezone question this page does not need to ask. */

export function secsSince(ts, now = Date.now()) {
  return ts ? Math.max(0, (now - Date.parse(ts)) / 1000) : null;
}

/** Coarse relative time from an age in seconds. */
export function agoSeconds(s) {
  if (s == null || Number.isNaN(s)) return "never";
  if (s < 1) return "just now";
  if (s < 90) return `${Math.round(s)}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function ago(ts, now = Date.now()) {
  return ts ? agoSeconds(secsSince(ts, now)) : "never";
}

export function freshCls(seconds) {
  if (seconds == null) return "freshness freshness--never";
  if (seconds < 900) return "freshness freshness--live";
  if (seconds < 86400) return "freshness freshness--stale";
  return "freshness";
}
