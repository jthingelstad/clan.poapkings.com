/**
 * Tinylytics, loaded client-side, the way Elixir's console loads it
 * (apps/web/src/analytics.js there; this file is that one, adapted).
 * Site J4GMM7Mti-Quk1gfx6zQ (Jamie, 2026-09-12). The CSP allows
 * tinylytics.app for script, connect and img and nothing else third-party.
 *
 * Two jobs, kept separate as Elixir learned to: the EMBED records the
 * document load; the ROUTE BRIDGE records pushState navigation as virtual
 * hits, because this SPA loads one document and then moves without
 * reloading. localhost never tracks. Nothing here is a secret and nothing
 * personal is sent: a CR tag is a public game identifier, and even that
 * rides as a query attribute, never as the path, so the report reads as
 * pages and not as one row per clan.
 */
const SITE_ID = "J4GMM7Mti-Quk1gfx6zQ";
const LOCAL = ["localhost", "127.0.0.1", "::1"];

export function loadTinylytics() {
  if (LOCAL.includes(window.location.hostname)) return;
  bridgeRouteChanges();
  const script = document.createElement("script");
  script.defer = true;
  script.src = `https://tinylytics.app/embed/${SITE_ID}/min.js?hits&countries&events&beacon`;
  document.body.appendChild(script);
}

/**
 * The page a path is, for the report. `/clan/J2RGCRVG/manage/board` is the
 * page `/clan/manage/board` of clan J2RGCRVG; `/feedback/abc123` is the page
 * `/feedback` of item abc123. Query strings (`?error=`) never ride along.
 */
export function analyticsLocation(
  pathname = window.location.pathname,
  origin = window.location.origin,
) {
  const segments = pathname.split("/").filter(Boolean);
  const url = new URL("/", origin);
  let page = "/";
  if (segments[0] === "clan" && segments[1]) {
    page = `/clan${segments.length > 2 ? `/${segments.slice(2).join("/")}` : ""}`;
    url.searchParams.set("clan", `#${segments[1].toUpperCase()}`);
  } else if (
    (segments[0] === "feedback" && segments[1]) ||
    (segments[0] === "maintain" && segments[1] === "feedback" && segments[2])
  ) {
    const id = segments.pop();
    page = `/${segments.join("/")}`;
    url.searchParams.set("id", id);
  } else if (segments.length) {
    page = `/${segments.join("/")}`;
  }
  url.pathname = page;
  return { path: page, url: url.toString() };
}

function bridgeRouteChanges() {
  let last = analyticsLocation();
  const send = () => {
    const next = analyticsLocation();
    if (next.url === last?.url) return;
    const referrer = last ? last.url : document.referrer;
    last = next;
    try {
      if (typeof navigator.sendBeacon !== "function") return;
      const collector = new URL(`https://tinylytics.app/collector/${SITE_ID}`);
      collector.searchParams.set("url", next.url);
      collector.searchParams.set("path", next.path);
      collector.searchParams.set("referrer", referrer);
      navigator.sendBeacon(collector.toString());
    } catch {
      // Analytics is best-effort and must never interrupt navigation.
    }
  };
  const original = history.pushState.bind(history);
  history.pushState = (...args) => {
    original(...args);
    send();
  };
  window.addEventListener("popstate", send);
}

/**
 * A product event, as Tinylytics counts them: a click on a
 * data-tinylytics-event node, so a programmatic event is a hidden node
 * clicked once. `value` is a bounded label (a card type and status, a
 * category, a route key), never free text, a tag or a URL. The taxonomy is
 * in AGENTS.md; add there when adding here.
 */
export function trackEvent(event, value) {
  try {
    if (LOCAL.includes(window.location.hostname)) return;
    const node = document.createElement("button");
    node.type = "button";
    node.hidden = true;
    node.setAttribute("data-tinylytics-event", event);
    if (value) node.setAttribute("data-tinylytics-event-value", value);
    document.body.appendChild(node);
    node.click();
    node.remove();
  } catch {
    // Never turn one failure into two.
  }
}

/** The route key a failure reports: method and path with ids and tags as
 *  `*`, the same key the server's own line uses. */
export function routeLabel(method, path) {
  const generic = path
    .replace(/^\/api\/clans\/[0-9A-Za-z]+/, "/api/clans/*")
    .replace(/\/(cards|notes|holds|members)\/[^/]+/g, "/$1/*")
    .replace(/\/awards\/grants\/.+$/, "/awards/grants/*")
    .replace(/^(\/api\/(?:maintain\/)?feedback)\/[^/]+$/, "$1/*")
    .replace(/\?.*$/, "");
  return `${method} ${generic}`;
}
