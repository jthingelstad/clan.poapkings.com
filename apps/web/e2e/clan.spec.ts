import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { HOW_ELDER_WORKS, mockApi, signedIn } from "./fixtures.ts";

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
  await page.goto("/clan/J2RGCRVG");
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("link", { name: "Sign in with Elixir" }).first(),
  ).toBeVisible();
  await expect(page.locator(".rail")).toHaveCount(0);
  await accessible(page, "landing");
});

test("the public page needs no sign-in", async ({ page }) => {
  await mockApi(page, {
    "GET /api/me": [401, { error: "signed_out" }],
    "GET /api/clans/J2RGCRVG/how-elder-works": [200, HOW_ELDER_WORKS],
  });
  await page.goto("/clan/J2RGCRVG/how-elder-works");
  await expect(page).toHaveURL(/how-elder-works$/);
  await rendered(page);
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
    await page.getByText("POAP KINGS").first().click();
    await expect(page).toHaveURL(/\/clan\/J2RGCRVG$/);
    await expect(page.getByText("King Levy")).toBeVisible();
    await expect(page.getByText("Co-leader").first()).toBeVisible();
    // The rail now carries the clan: Manage for a leader, the tag aside.
    await expect(rail.getByRole("link", { name: /^Inbox/ })).toBeVisible();
    await expect(rail).toContainText("#J2RGCRVG");
    await rendered(page);
    await accessible(page, "clan page");

    // Standing, through the rail.
    await rail.getByRole("link", { name: /^Standing/ }).click();
    await expect(page).toHaveURL(/\/standing$/);
    await expect(
      page.getByRole("heading", { name: "Elder standing" }),
    ).toBeVisible();
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
    await page.goto("/clan/GJ09RJP8");
    await expect(page).toHaveURL(/\/clan\/GJ09RJP8$/);
    const rail = page.locator(".rail");
    await expect(rail).toContainText("Elixir Kings");
    // A member: no Manage group.
    await expect(rail.getByRole("link", { name: /^Inbox/ })).toHaveCount(0);
  });

  test("@narrow the rail is a disclosure above the content", async ({
    page,
  }) => {
    await page.goto("/clan/J2RGCRVG");
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
