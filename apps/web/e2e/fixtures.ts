import type { Page, Route } from "@playwright/test";

const POAP = {
  clan_tag: "#J2RGCRVG",
  name: "POAP KINGS",
  role: "leader",
  role_label: "Leader",
  acting_as: "#20JJJ2CCRU",
  acting_as_name: "King Thing",
  player_name: "King Thing",
  verified: true,
  your_tags: ["#20JJJ2CCRU"],
};
const KINGS = {
  clan_tag: "#GJ09RJP8",
  name: "Elixir Kings",
  role: "member",
  role_label: "Member",
  acting_as: "#VJQV8G8RL",
  acting_as_name: "thingles",
  player_name: "thingles",
  verified: true,
  your_tags: ["#VJQV8G8RL"],
};

/** A signed-in leader of POAP KINGS who also holds a player in Elixir
 *  Kings, with nothing selected yet - the chooser's case. */
export const ME = {
  signed_in: true,
  ok: true,
  principal: {
    kind: "person",
    subject: { type: "player", tag: "#20JJJ2CCRU", name: "King Thing" },
  },
  primary: { player_tag: "#20JJJ2CCRU", name: "King Thing" },
  identities: [
    {
      player_tag: "#20JJJ2CCRU",
      name: "King Thing",
      is_primary: true,
      relationship: "primary",
      claim_status: "verified",
      clan_tag: "#J2RGCRVG",
      role: "leader",
      role_label: "Leader",
    },
  ],
  clans: [POAP, KINGS],
  selected: null as typeof POAP | null,
  open_cards: 2,
  feedback_unseen: 1,
  maintainer: false,
};

export const ROSTER = {
  clan_tag: "#J2RGCRVG",
  member_count: 3,
  cached_at: "2026-09-12T17:55:00Z",
  meta: { freshness_seconds: 300, as_of: "2026-09-12T17:55:00Z" },
  notes: [],
  members: [
    {
      player_tag: "#20JJJ2CCRU",
      name: "King Thing",
      role: "leader",
      role_label: "Leader",
      trophies: 8000,
      donations_this_week: 40,
      last_seen_in_game: "2026-09-12T17:00:00Z",
      last_recorded_battle: "2026-09-12T16:40:00Z",
      you: true,
    },
    {
      player_tag: "#U8RYG9Y2U",
      name: "King Levy",
      role: "coLeader",
      role_label: "Co-leader",
      trophies: 7600,
      donations_this_week: 12,
      last_seen_in_game: "2026-09-12T15:00:00Z",
      last_recorded_battle: null,
      you: false,
    },
    {
      player_tag: "#M1",
      name: "Zed",
      role: "member",
      role_label: "Member",
      trophies: 5000,
      donations_this_week: 0,
      last_seen_in_game: "2026-09-10T15:00:00Z",
      last_recorded_battle: null,
      you: false,
    },
  ],
};

type Answer =
  [status: number, body: unknown] | ((route: Route) => [number, unknown]);

/** Route every /api/* and /auth/* call to a fixture. An unlisted call
 *  answers 404 JSON so a page can say "could not load" rather than hang. */
export async function mockApi(page: Page, routes: Record<string, Answer>) {
  await page.route("**/{api,auth}/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const key = `${req.method()} ${url.pathname}`;
    const answer =
      routes[key] ?? routes[`${req.method()} ${url.pathname}${url.search}`];
    const [status, body] =
      typeof answer === "function"
        ? answer(route)
        : (answer ?? [404, { error: "unmocked", key }]);
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

/** Signed in, with the reads the rail's pages make. `select` is stateful:
 *  picking a clan changes what /api/me answers, as the Lambda does. */
export function signedIn(
  overrides: Record<string, Answer> = {},
): Record<string, Answer> {
  let me = { ...ME };
  return {
    "GET /api/me": () => [200, me],
    "POST /api/select": (route) => {
      const { clan_tag } = route.request().postDataJSON();
      me = {
        ...me,
        selected: me.clans.find((c) => c.clan_tag === clan_tag) ?? null,
      };
      return [200, me];
    },
    "GET /api/roster": [200, ROSTER],
    "GET /api/clans/J2RGCRVG/standing": [
      200,
      {
        as_of: "2026-09-12T17:55:00Z",
        freshness_seconds: 300,
        enabled: true,
        rows: [
          {
            player_tag: "#U8RYG9Y2U",
            name: "King Levy",
            status: "elder",
            evidence: "war 4/4",
          },
        ],
        you: {
          status: "elder",
          evidence: "war 4/4, ranked 12",
          next: [],
          inactivity: false,
        },
      },
    ],
    "GET /api/feedback": [200, { feedback: [] }],
    "POST /api/feedback": [200, { feedback_id: "abc123" }],
    "GET /api/clans/J2RGCRVG/me/away": [200, { away: null }],
    ...overrides,
  };
}
