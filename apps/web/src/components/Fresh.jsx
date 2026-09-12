import { useState } from "react";
import { agoSeconds, freshCls, secsSince } from "../lib/time.js";

/** How current a number is, the way Elixir says it: "as of 4m ago" in a
 *  freshness pill whose colour is the age. `seconds` is the tool's own
 *  meta.freshness_seconds when it has one; `ts` is a fallback instant. */
export function Fresh({ ts, seconds, label = "as of" }) {
  const [now] = useState(() => Date.now());
  const age = seconds ?? secsSince(ts, now);
  if (age == null)
    return <span className="freshness freshness--never">never polled</span>;
  return (
    <span className={freshCls(age)} title={ts ?? undefined}>
      {label} {agoSeconds(age)}
    </span>
  );
}
