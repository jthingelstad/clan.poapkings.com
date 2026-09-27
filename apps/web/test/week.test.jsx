import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { weeklyReport } from "@elixir-clan/engine";
import { renderWithProviders } from "./helpers.jsx";
import { Week } from "../src/views/Week.jsx";
import { manageApi } from "../src/api.js";
import { analyticsLocation } from "../src/analytics.js";
import { railKey } from "../src/lib/rail.js";
import {
  member,
  participation,
  NOW,
  EXAMPLE_POLICY,
} from "../../../services/engine/test/fixture.mjs";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const clan = { clan_tag: "#2PQRJ8LV", name: "Example Clan", role: "member" };
const part = participation([
  member("#A", { name: "Ada" }),
  member("#B", { name: "Bo", war: [16, 16, 16, 16, 10, 0] }),
  member("#C", {
    name: "Cy",
    war: [0, 0, 0, 0, 0, 0],
    donations: [0, 0, 0, 0, 0, 0],
  }),
]);
const roster = {
  recent_events: [
    {
      type: "member_joined",
      at: "2026-08-20T00:00:00Z",
      detail: { player_tag: "#Z", name: "Zed" },
    },
    {
      type: "member_left",
      at: "2026-09-02T00:00:00Z",
      detail: { player_tag: "#L", name: "Lu", role_at_departure: "member" },
    },
    {
      type: "role_changed",
      at: "2026-09-03T00:00:00Z",
      detail: {
        player_tag: "#A",
        name: "Ada",
        role_before: "member",
        role_after: "elder",
      },
    },
  ],
};
const answer = (policy, data = {}) => ({
  ok: true,
  status: 200,
  data: {
    clan_tag: "#2PQRJ8LV",
    clan_name: "Example Clan",
    as_of: NOW.toISOString(),
    freshness_seconds: 60,
    policy: { set: Boolean(policy), active: Boolean(policy) },
    ...weeklyReport(part, { roster, policy, now: NOW }),
    ...data,
  },
});

describe("the week in the clan", () => {
  test("what the clan counts is highlighted; everyone who took part is named, nobody else", async () => {
    vi.spyOn(manageApi, "week").mockResolvedValue(answer(EXAMPLE_POLICY));
    renderWithProviders(<Week clan={clan} week={null} navigate={vi.fn()} />);
    await screen.findByText(/Highlighted: what this clan counts/);
    expect(
      screen.getByText(/Clan Wars, Ranked play and Donations/),
    ).toBeTruthy();
    const war = screen.getByRole("list", { name: "Clan Wars: who took part" });
    expect(war.textContent).toMatch(/Ada · 16 ✓/);
    expect(war.textContent).toMatch(/Bo · 10/);
    expect(war.textContent).not.toMatch(/Cy/);
    expect(screen.getByText(/1 member played every deck asked/)).toBeTruthy();
    // Who came and went: departed, never kicked or left.
    expect(screen.getByText("Departed")).toBeTruthy();
    expect(screen.getByText(/Ada to Elder/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bkick/i);
    expect(document.body.textContent).not.toMatch(/\bcard\b/i);
    // The week so far, on the latest week.
    expect(screen.getByText(/This week so far/)).toBeTruthy();
  });

  test("with no policy the busiest areas lead, and the rest fold under 'Also this week'", async () => {
    vi.spyOn(manageApi, "week").mockResolvedValue(answer(null));
    renderWithProviders(<Week clan={clan} week={null} navigate={vi.fn()} />);
    await screen.findByText(/where the clan was busiest/);
    expect(screen.getByText(/have not set up how it runs/)).toBeTruthy();
    expect(screen.getByText("Also this week")).toBeTruthy();
  });

  test("earlier weeks are one click away; a week that has not closed says so", async () => {
    const navigate = vi.fn();
    vi.spyOn(manageApi, "week").mockResolvedValue(answer(null));
    renderWithProviders(<Week clan={clan} week={null} navigate={navigate} />);
    const back = await screen.findByText(/← Week of/);
    fireEvent.click(back);
    expect(navigate).toHaveBeenCalledWith("/clan/2PQRJ8LV/week/2026-w35");
    cleanup();
    vi.spyOn(manageApi, "week").mockResolvedValue({
      ok: false,
      status: 404,
      data: { error: "no_week" },
    });
    renderWithProviders(
      <Week clan={clan} week="2026-W37" navigate={vi.fn()} />,
    );
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /has not closed yet/,
      ),
    );
  });

  test("its address is on the rail and collapses in analytics", () => {
    expect(railKey("/clan/2PQRJ8LV/week")).toBe("week");
    expect(railKey("/clan/2PQRJ8LV/week/2026-w36")).toBe("week");
    expect(
      analyticsLocation("/clan/2PQRJ8LV/week/2026-w36", "https://clan.test")
        .path,
    ).toBe("/clan/week");
  });
});
