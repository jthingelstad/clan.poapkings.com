import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { Policy } from "../src/views/Policy.jsx";
import { manageApi } from "../src/api.js";
import { FIELDS, GROUPS, TABS, defaults } from "@elixir-clan/engine";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const clan = { clan_tag: "#2PQRJ8LV", name: "Example Clan", role: "leader" };
const view = {
  can_edit: true,
  set: false,
  members: 24,
  min_members: 10,
  big_enough: true,
  current: { set: false, values: defaults(), version: 0 },
  tabs: TABS,
  groups: GROUPS,
  fields: FIELDS,
  versions: [],
};
const open = (name) =>
  fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${name}`) }));
const render = async (data = view) => {
  vi.spyOn(manageApi, "policy").mockResolvedValue({
    ok: true,
    status: 200,
    data,
  });
  renderWithProviders(<Policy clan={clan} />);
  await screen.findByRole("tablist", { name: "Policy" });
};

describe("policy: tabs along the top", () => {
  test("one tab at a time, each category switched on or off; a preset fills every tab", async () => {
    const save = vi
      .spyOn(manageApi, "savePolicy")
      .mockResolvedValue({ ok: true, status: 200, data: { version: 1 } });
    await render();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^About/),
        expect.stringMatching(/^Clan Wars/),
        expect.stringMatching(/^Elder/),
        expect.stringMatching(/^Inactivity/),
      ]),
    );
    expect(screen.getByRole("tab", { name: /^Clan Wars, off/ })).toBeTruthy();
    // Nothing from another tab is on the page.
    expect(screen.queryByLabelText(/War rate window/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "A war clan" }));
    expect(screen.getByRole("tab", { name: /^Clan Wars, on/ })).toBeTruthy();
    expect(screen.getByLabelText(/How strict/).value).toBe("strict");
    open("Clan Wars");
    expect(screen.getByLabelText("Count Clan Wars").checked).toBe(true);
    expect(screen.getByLabelText(/Minimum war decks/).value).toBe("24");
    expect(screen.queryByLabelText(/How strict/)).toBeNull();
    open("Elder");
    expect(screen.getByLabelText(/Elders are chosen/).value).toBe("categories");
    fireEvent.click(
      screen.getByRole("button", { name: "Save this clan's policy" }),
    );
    await waitFor(() => expect(save).toHaveBeenCalled());
    const [, values] = save.mock.calls[0];
    expect(values.war_enabled).toBe(true);
    expect(values.donations_enabled).toBe(true);
    expect(values.removal_enabled).toBe(true);
    expect("goal_war" in values).toBe(false);
  });

  test("turning a tab on shows its settings, filled from how strict the clan is", async () => {
    await render();
    open("Donations");
    expect(screen.getByText(/Off: this clan does not use it/)).toBeTruthy();
    expect(screen.queryByLabelText(/Minimum donations/)).toBeNull();
    fireEvent.click(screen.getByLabelText("Count donations"));
    expect(screen.getByLabelText(/Minimum donations/).value).toBe("40");
    expect(screen.getByLabelText(/Donation window/).value).toBe("4");
    expect(
      screen.getByRole("tab", { name: /^Donations, on, changed/ }),
    ).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Count donations"));
    expect(screen.queryByLabelText(/Minimum donations/)).toBeNull();
  });

  test("a social clan chooses Elders by hand and counts nothing", async () => {
    await render();
    fireEvent.click(screen.getByRole("button", { name: "A social clan" }));
    expect(screen.getByLabelText(/Playing together/).checked).toBe(true);
    expect(screen.getByRole("tab", { name: /^Elder, by hand/ })).toBeTruthy();
    open("Clan Wars");
    expect(screen.getByLabelText("Count Clan Wars").checked).toBe(false);
  });

  test("a refused save opens the tab that holds the problem", async () => {
    vi.spyOn(manageApi, "savePolicy").mockResolvedValue({
      ok: false,
      status: 400,
      data: {
        error: "invalid_policy",
        errors: { at_risk_days: "At risk cannot come before getting quiet." },
      },
    });
    await render();
    fireEvent.click(screen.getByRole("button", { name: "A war clan" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Save this clan's policy" }),
    );
    expect(
      await screen.findByText("At risk cannot come before getting quiet."),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("tab", { name: /^Inactivity/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });
});
