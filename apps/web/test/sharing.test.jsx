import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { Sharing } from "../src/views/Sharing.jsx";
import { canShare } from "../src/App.jsx";
import { manageApi } from "../src/api.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const clan = { clan_tag: "#2PQRJ8LV", name: "Example Clan", role: "leader" };
const types = {
  departure_classified: {
    label: "Kicks and leaves",
    why: "When a leader answers a departure.",
    sees: "Everyone verified in the clan, and the clan's agent: the game already shows the clan who was kicked.",
  },
  role_change_made: {
    label: "Promotions and demotions",
    why: "When a leader completes a promotion or demotion.",
    sees: "Everyone verified in the clan.",
  },
};

describe("what Elixir Clan records in Elixir", () => {
  test("every kind is listed with who sees it; nothing to switch or save", async () => {
    vi.spyOn(manageApi, "sharing").mockResolvedValue({
      ok: true,
      status: 200,
      data: { clan_tag: "#2PQRJ8LV", types },
    });
    renderWithProviders(<Sharing clan={clan} />);
    expect(await screen.findByText("Kicks and leaves")).toBeTruthy();
    expect(screen.getByText("Promotions and demotions")).toBeTruthy();
    expect(screen.getByText(/the clan's agent/)).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("a sign-in may share only when its grant holds clans:attest", () => {
    expect(canShare({ scope: "cr:read clans:attest" })).toBe(true);
    expect(canShare({ scope: "cr:read" })).toBe(false);
    expect(canShare({ scope: null })).toBe(false);
    expect(canShare(null)).toBe(false);
  });
});
