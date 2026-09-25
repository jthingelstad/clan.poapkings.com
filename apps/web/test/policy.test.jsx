import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { Policy } from "../src/views/Policy.jsx";
import { manageApi } from "../src/api.js";
import { FIELDS, GROUPS, defaults } from "@elixir-clan/engine";

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
  groups: GROUPS,
  fields: FIELDS,
  versions: [],
};

describe("policy: what the clan is for", () => {
  test("a preset fills every setting from goals and a posture, for the leader to tune and save", async () => {
    vi.spyOn(manageApi, "policy").mockResolvedValue({
      ok: true,
      status: 200,
      data: view,
    });
    const save = vi
      .spyOn(manageApi, "savePolicy")
      .mockResolvedValue({ ok: true, status: 200, data: { version: 1 } });
    renderWithProviders(<Policy clan={clan} />);
    await waitFor(() =>
      expect(screen.getByText("Start from what the clan is for")).toBeTruthy(),
    );
    // Nothing is counted before a starting point is picked.
    expect(screen.queryByLabelText(/War rate window/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "A war clan" }));
    expect(screen.getByLabelText(/Count Clan Wars/).checked).toBe(true);
    expect(screen.getByLabelText(/Count donations/).checked).toBe(true);
    expect(screen.getByLabelText(/Elders are chosen/).value).toBe("categories");
    expect(screen.getByLabelText(/How strict/).value).toBe("strict");
    fireEvent.click(
      screen.getByRole("button", { name: "Save this clan's policy" }),
    );
    await waitFor(() => expect(save).toHaveBeenCalled());
    const [, values] = save.mock.calls[0];
    expect(values.goal_war).toBe(true);
    expect(values.goal_donations).toBe(true);
    expect(values.war_enabled).toBe(true);
    expect(values.removal_enabled).toBe(true);
  });

  test("a social clan chooses Elders by hand and counts nothing", async () => {
    vi.spyOn(manageApi, "policy").mockResolvedValue({
      ok: true,
      status: 200,
      data: view,
    });
    renderWithProviders(<Policy clan={clan} />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "A social clan" }),
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "A social clan" }));
    expect(screen.getByLabelText(/Elders are chosen/).value).toBe("manual");
    expect(screen.getByLabelText(/Count Clan Wars/).checked).toBe(false);
    expect(screen.getByLabelText(/Playing together/).checked).toBe(true);
  });
});
