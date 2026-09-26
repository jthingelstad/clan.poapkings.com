import type { Page, Route } from "@playwright/test";

const FIRST = {
  clan_tag: "#2PQRJ8LV",
  name: "Example Clan",
  role: "leader",
  role_label: "Leader",
  acting_as: "#20QQL8CCRU",
  acting_as_name: "Ada",
  player_name: "Ada",
  verified: true,
  your_tags: ["#20QQL8CCRU"],
};
const SECOND = {
  clan_tag: "#GQ08RJPL",
  name: "Second Clan",
  role: "member",
  role_label: "Member",
  acting_as: "#VLQV8C8RP",
  acting_as_name: "Ada's alt",
  player_name: "Ada's alt",
  verified: true,
  your_tags: ["#VLQV8C8RP"],
};

/** A signed-in leader of Example Clan who also holds a player in Elixir
 *  Kings, with nothing selected yet - the chooser's case. */
export const ME = {
  signed_in: true,
  ok: true,
  // A sign-in since 2026-09-25 holds clans:attest; without it every page
  // asks the person to sign in again (App.jsx canShare).
  scope: "cr:read clans:attest",
  principal: {
    kind: "person",
    subject: { type: "player", tag: "#20QQL8CCRU", name: "Ada" },
  },
  primary: { player_tag: "#20QQL8CCRU", name: "Ada" },
  identities: [
    {
      player_tag: "#20QQL8CCRU",
      name: "Ada",
      is_primary: true,
      relationship: "primary",
      claim_status: "verified",
      clan_tag: "#2PQRJ8LV",
      role: "leader",
      role_label: "Leader",
    },
  ],
  clans: [FIRST, SECOND],
  selected: null as typeof FIRST | null,
  open_actions: 2,
  feedback_unseen: 1,
  maintainer: false,
  // The selected clan's policy: saved, ranking Elder, tracking inactivity.
  policy: {
    set: true,
    active: true,
    members: 12,
    min_members: 10,
    version: 1,
    ranks_elder: true,
    removal: true,
    away: true,
    members_see_standing: true,
  },
};

export const ROSTER = {
  clan_tag: "#2PQRJ8LV",
  member_count: 3,
  cached_at: "2026-09-12T17:55:00Z",
  meta: { freshness_seconds: 300, as_of: "2026-09-12T17:55:00Z" },
  notes: [],
  members: [
    {
      player_tag: "#20QQL8CCRU",
      name: "Ada",
      role: "leader",
      role_label: "Leader",
      trophies: 8000,
      donations_this_week: 40,
      last_seen_in_game: "2026-09-12T17:00:00Z",
      last_recorded_battle: "2026-09-12T16:40:00Z",
      you: true,
    },
    {
      player_tag: "#UQ8LP2R9C",
      name: "Ben",
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
  { policy = ME.policy }: { policy?: Record<string, unknown> } = {},
): Record<string, Answer> {
  let me = { ...ME, policy };
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
    "GET /api/clans/2PQRJ8LV/standing": [
      200,
      {
        as_of: "2026-09-12T17:55:00Z",
        freshness_seconds: 300,
        policy_version: 1,
        ranks_elder: true,
        how: [
          {
            key: "elder",
            title: "Elder",
            lines: ["Elder is earned by participation: Clan Wars 100%."],
          },
        ],
        rows: [
          {
            player_tag: "#UQ8LP2R9C",
            name: "Ben",
            status: "holding",
            evidence: "100% war decks over 4 war weeks",
          },
        ],
        you: {
          status: null,
          evidence: "100% war decks over 4 war weeks",
          next: [],
          inactivity: null,
        },
      },
    ],
    "GET /api/feedback": [200, { feedback: [] }],
    "POST /api/feedback": [200, { feedback_id: "abc123" }],
    "GET /api/clans/2PQRJ8LV/me/away": [200, { away: null }],
    ...overrides,
  };
}
