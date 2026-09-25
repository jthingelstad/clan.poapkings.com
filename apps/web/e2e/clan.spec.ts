import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, signedIn } from "./fixtures.ts";
import { FIELDS, GROUPS, TABS, policyFromGoals } from "@elixir-clan/engine";

/** A saved policy as the editor reads it: a war clan, version 1. */
const POLICY_VIEW = {
  can_edit: true,
  set: true,
  members: 40,
  min_members: 10,
  big_enough: true,
  current: {
    set: true,
    version: 1,
    values: policyFromGoals(["war", "donations"], "standard"),
    saved_at: "2026-09-20T12:00:00Z",
    saved_by: "#20QQL8CCRU",
    saved_by_name: "Ada",
  },
  tabs: TABS,
  groups: GROUPS,
  fields: FIELDS,
  versions: [
    {
      version: 1,
      saved_at: "2026-09-20T12:00:00Z",
      saved_by: "#20QQL8CCRU",
      saved_by_name: "Ada",
      note: null,
    },
  ],
};

/** Nothing serious or critical, on every page a journey lands on. */
async function accessible(page: Page, name: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const serious = results.violations.filter((v) =>
    ["serious", "critical"].includes(v.impact ?? ""),
  );
  expect(
    serious.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    ),
    `${name}: accessibility`,
  ).toEqual([]);
}

async function rendered(page: Page) {
  await expect(page.locator("main")).not.toContainText("failed to render");
}

test("signed out: the landing, the way in on the bar, and a clan path sent home", async ({
  page,
}) => {
  await mockApi(page, { "GET /api/me": [401, { error: "signed_out" }] });
  await page.goto("/clan/2PQRJ8LV");
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("link", { name: "Sign in with Elixir" }).first(),
  ).toBeVisible();
  await expect(page.locator(".rail")).toHaveCount(0);
  await accessible(page, "landing");
});

test.describe("signed in", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, signedIn());
  });

  test("choose a clan, read its roster, walk the rail, file feedback", async ({
    page,
  }) => {
    await page.goto("/");
    // Nothing selected: the chooser.
    await expect(page).toHaveURL(/\/clans$/);
    await expect(
      page.getByRole("heading", { name: "Your clans" }),
    ).toBeVisible();
    const rail = page.locator(".rail");
    await expect(rail.getByRole("link", { name: /Feedback/ })).toBeVisible();
    await expect(rail.getByRole("img", { name: /new repl/ })).toBeVisible();
    await accessible(page, "chooser");

    // Picking one is remembered and lands on its page.
    await page.getByText("Example Clan").first().click();
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV$/);
    await expect(page.getByText("Ben")).toBeVisible();
    await expect(page.getByText("Co-leader").first()).toBeVisible();
    // The rail now carries the clan: Manage for a leader, the tag aside.
    await expect(rail.getByRole("link", { name: /^Actions/ })).toBeVisible();
    await expect(rail.getByRole("link", { name: /^Board/ })).toBeVisible();
    await expect(rail).toContainText("#2PQRJ8LV");
    await rendered(page);
    await accessible(page, "clan page");

    // Standing, through the rail.
    await rail.getByRole("link", { name: /^Standing/ }).click();
    await expect(page).toHaveURL(/\/standing$/);
    await expect(page.getByRole("heading", { name: "Standing" })).toBeVisible();
    await expect(page.getByText("How it works here")).toBeVisible();
    await rendered(page);

    // Feedback: compose and send.
    await rail.getByRole("link", { name: /^Feedback/ }).click();
    await expect(page).toHaveURL(/\/feedback$/);
    await page.getByRole("button", { name: "Send feedback" }).click();
    await page.getByLabel("Message").fill("The rail is where we are going.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await rendered(page);
    await accessible(page, "feedback");
  });

  test("arriving at another of your clans by URL selects it", async ({
    page,
  }) => {
    await page.goto("/clan/GQ08RJPL");
    await expect(page).toHaveURL(/\/clan\/GQ08RJPL$/);
    const rail = page.locator(".rail");
    await expect(rail).toContainText("Second Clan");
    // A member: no Manage group.
    await expect(rail.getByRole("link", { name: /^Board/ })).toHaveCount(0);
  });

  test("a clan with no policy yet: only the roster, Recruit, Scout, the policy editor and clan settings", async ({
    page,
  }) => {
    await mockApi(page, signedIn({}, { policy: { set: false } }));
    await page.goto("/clan/2PQRJ8LV");
    const rail = page.locator(".rail");
    await expect(rail.getByRole("link", { name: /^Policy/ })).toBeVisible();
    await expect(rail.getByRole("link", { name: /^Scout/ })).toBeVisible();
    await expect(rail.getByRole("link", { name: /^Recruit/ })).toBeVisible();
    await expect(rail.getByRole("link", { name: /^Settings/ })).toBeVisible();
    for (const name of [
      /^Actions/,
      /^Board/,
      /^Standing/,
      /^Trophies/,
      /^Away/,
    ])
      await expect(rail.getByRole("link", { name })).toHaveCount(0);
  });

  test("a clan below 10 members is a statistics view: the policy editor says so", async ({
    page,
  }) => {
    await mockApi(
      page,
      signedIn(
        {
          "GET /api/clans/2PQRJ8LV/policy": [
            200,
            {
              can_edit: true,
              set: false,
              members: 6,
              min_members: 10,
              big_enough: false,
              current: { set: false, values: {}, version: 0 },
              groups: [],
              fields: {},
              versions: [],
            },
          ],
        },
        { policy: { set: false, active: false, members: 6 } },
      ),
    );
    await page.goto("/clan/2PQRJ8LV");
    const rail = page.locator(".rail");
    for (const name of [/^Actions/, /^Board/, /^Standing/, /^Trophies/])
      await expect(rail.getByRole("link", { name })).toHaveCount(0);
    await rail.getByRole("link", { name: /^Policy/ }).click();
    await expect(page).toHaveURL(/\/manage\/policy$/);
    await expect(
      page.getByText("Clan management starts at 10 members"),
    ).toBeVisible();
    await expect(page.getByText(/This clan has 6\./)).toBeVisible();
  });

  test("the policy editor is tabs along the top: one at a time, each switched on or off", async ({
    page,
  }) => {
    await mockApi(
      page,
      signedIn({ "GET /api/clans/2PQRJ8LV/policy": [200, POLICY_VIEW] }),
    );
    await page.goto("/clan/2PQRJ8LV");
    await page
      .locator(".rail")
      .getByRole("link", { name: /^Policy/ })
      .click();
    const tabs = page.getByRole("tablist", { name: "Policy" });
    await expect(
      tabs.getByRole("tab", { name: /^Clan Wars, on/ }),
    ).toBeVisible();
    await expect(
      tabs.getByRole("tab", { name: /^Ranked play, off/ }),
    ).toBeVisible();
    // About first; nothing from another tab on the page.
    await expect(page.getByLabel(/War rate window/)).toHaveCount(0);
    await tabs.getByRole("tab", { name: /^Clan Wars/ }).click();
    await expect(page.getByLabel(/Minimum war decks/)).toHaveValue("8");
    await tabs.getByRole("tab", { name: /^Ranked play/ }).click();
    await expect(
      page.getByText(/Off: this clan does not use it/),
    ).toBeVisible();
    await page.getByLabel("Count ranked play").check();
    await expect(page.getByLabel(/Minimum ranked battles/)).toHaveValue("5");
    await expect(
      tabs.getByRole("tab", { name: /^Ranked play, on, changed/ }),
    ).toBeVisible();
    await expect(
      page.getByText(/settings? changed: Count ranked play/),
    ).toBeVisible();
    await accessible(page, "policy tabs");
  });

  test("clan settings hold the clan's own model, for leaders", async ({
    page,
  }) => {
    await mockApi(
      page,
      signedIn({
        "GET /api/clans/2PQRJ8LV/model": [
          200,
          {
            clan_tag: "#2PQRJ8LV",
            purposes: { recruit_pitch: { label: "Recruiting pitch" } },
            per_day: 20,
            keep_days: 90,
            uses: {
              today: 0,
              month: { count: 0, input_tokens: 0, output_tokens: 0 },
              recent: [],
            },
            set: false,
          },
        ],
        "GET /api/clans/2PQRJ8LV/sharing": [
          200,
          {
            clan_tag: "#2PQRJ8LV",
            types: {
              departure_classified: {
                label: "Kicks and leaves",
                why: "When a leader answers a departure.",
                sees: "The clan's leaders and co-leaders only.",
              },
            },
            values: { departure_classified: false },
            saved_at: null,
          },
        ],
      }),
    );
    await page.goto("/clan/2PQRJ8LV");
    await page
      .locator(".rail")
      .getByRole("link", { name: /^Settings/ })
      .click();
    await expect(page).toHaveURL(/\/manage\/settings$/);
    await expect(
      page.getByRole("heading", { name: "Clan settings" }),
    ).toBeVisible();
    await expect(page.getByText("The clan’s own model")).toBeVisible();
    await expect(page.getByText("Share with Elixir")).toBeVisible();
    await expect(page.getByLabel("Kicks and leaves")).not.toBeChecked();
    await expect(page.getByLabel("Add the clan's key")).toHaveAttribute(
      "type",
      "password",
    );
    // The model's old address lands on settings.
    await page.goto("/clan/2PQRJ8LV/manage/model");
    await expect(
      page.getByRole("heading", { name: "Clan settings" }),
    ).toBeVisible();
    await accessible(page, "clan settings");
  });

  test("actions are a short list; each has its own address, with its log open", async ({
    page,
  }) => {
    const removal = {
      card_id: "a1",
      number: 37,
      type: "removal",
      label: "Remove from the clan",
      status: "proposed",
      can_act: true,
      audience: { kind: "leaders" },
      player_tag: "#8QCV",
      player_name: "Sleepy",
      role_at_raise: "member",
      raised_at: "2026-09-12T20:00:00Z",
      copy: "Sleepy was removed for inactivity.",
      evidence: { rationale: { headline: "20 battle-free days." }, facts: [] },
      log: [
        {
          entry_id: "e1",
          kind: "raised",
          at: "2026-09-12T20:00:00Z",
          by: { system: "elixir-clan" },
          text: "20 battle-free days.",
        },
        {
          entry_id: "e2",
          kind: "comment",
          at: "2026-09-13T08:00:00Z",
          by: { tag: "#UQ8LP2R9C", name: "Ben", role: "coLeader" },
          text: "I messaged them yesterday.",
        },
      ],
    };
    await mockApi(
      page,
      signedIn({
        "GET /api/clans/2PQRJ8LV/actions": [
          200,
          {
            clan_tag: "#2PQRJ8LV",
            as_of: "2026-09-13T09:00:00Z",
            open: [removal],
            recent: [],
            decline_reasons: ["not_now", "other"],
          },
        ],
        "GET /api/clans/2PQRJ8LV/actions/37": [
          200,
          {
            clan_tag: "#2PQRJ8LV",
            action: removal,
            decline_reasons: ["not_now", "other"],
          },
        ],
        "GET /api/clans/2PQRJ8LV/actions/99": [404, { error: "no_action" }],
      }),
    );
    await page.goto("/clan/2PQRJ8LV");
    const rail = page.locator(".rail");
    await rail.getByRole("link", { name: /^Actions/ }).click();
    await expect(page).toHaveURL(/\/actions$/);
    const row = page.getByRole("link", { name: /#37.*Remove from the clan/ });
    await expect(row).toContainText("1 comment");
    await expect(page.getByRole("button", { name: "Complete" })).toHaveCount(0);
    await accessible(page, "actions list");
    await row.click();
    await expect(page).toHaveURL(/\/actions\/37$/);
    await expect(
      page.getByRole("heading", { name: "Action #37" }),
    ).toBeVisible();
    await expect(page.getByText("I messaged them yesterday.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Complete" })).toBeVisible();
    await expect(rail.getByRole("link", { name: /^Actions/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await rendered(page);
    await accessible(page, "an action's page");
    // The address works on its own, sent to someone.
    await page.goto("/clan/2PQRJ8LV/actions/37");
    await expect(
      page.getByRole("heading", { name: "Action #37" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "‹ All actions" }).click();
    await expect(page).toHaveURL(/\/actions$/);
    await page.goto("/clan/2PQRJ8LV/actions/99");
    await expect(page.getByText("No action #99 here")).toBeVisible();
  });

  test("@narrow the rail is a disclosure above the content", async ({
    page,
  }) => {
    await page.goto("/clan/2PQRJ8LV");
    const toggle = page.locator(".rail__toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).toContainText("Clan");
    await expect(
      page.getByRole("navigation", { name: "Sections" }),
    ).toHaveCount(0);
    await toggle.click();
    await page
      .getByRole("navigation", { name: "Sections" })
      .getByRole("link", { name: /^Standing/ })
      .click();
    await expect(page).toHaveURL(/\/standing$/);
    await expect(
      page.getByRole("navigation", { name: "Sections" }),
    ).toHaveCount(0);
    await accessible(page, "narrow standing");
  });
});
