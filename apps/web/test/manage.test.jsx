import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { parseClanPath } from "../src/App.jsx";
import { Standing } from "../src/views/Standing.jsx";
import { Manage } from "../src/views/Manage.jsx";
import { manageApi } from "../src/api.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const poap = {
  clan_tag: "#J2RGCRVG",
  name: "POAP KINGS",
  acting_as: "#20JJJ2CCRU",
  acting_as_name: "King Thing",
  role: "leader",
  role_label: "Leader",
  your_tags: ["#20JJJ2CCRU"],
};

test("the board shows every held or unknown reason, including simultaneous dimensions", async () => {
  const reasons = [
    "Promotion: tenure unknown because the join predates the record.",
    "Removal held: no recorded battle or observed join anchors the clock.",
  ];
  vi.spyOn(manageApi, "manage").mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      evaluated_at: "2026-09-13T16:00:00Z",
      policy_version: 0,
      boundaries: [],
      band: {
        roster_size: 1,
        open_slots: 49,
        current_elders: 0,
        floor: 0,
        ceil: 0,
        target: 0,
        ranked_population: 1,
      },
      board: [
        {
          player_tag: "#HELD",
          name: "Held member",
          role: "member",
          bucket: "held",
          judgment: {
            promotion: "unknown",
            demotion: "not_applicable",
            removal: "held",
          },
          judgment_reasons: reasons,
          promotion: { state: "none" },
          removal: { state: "none", days_idle: null },
        },
      ],
    },
  });
  renderWithProviders(
    <Manage
      clan={poap}
      tab="board"
      who={{ player_tag: poap.acting_as, role: "leader" }}
    />,
  );
  await waitFor(() => expect(screen.getByText("Held member")).toBeTruthy());
  expect(screen.getByText(reasons.join(" "))).toBeTruthy();
});

describe("clan paths", () => {
  test("parse the tag, the section and the manage tab", () => {
    expect(parseClanPath("/clan/J2RGCRVG")).toEqual({
      tag: "#J2RGCRVG",
      section: "roster",
      tab: null,
    });
    expect(parseClanPath("/clan/j2rgcrvg/manage/board")).toEqual({
      tag: "#J2RGCRVG",
      section: "manage",
      tab: "board",
    });
    expect(parseClanPath("/clan/J2RGCRVG/standing")).toEqual({
      tag: "#J2RGCRVG",
      section: "standing",
      tab: null,
    });
    // Elixir Clan publishes no public pages (Jamie, 2026-09-25).
    expect(parseClanPath("/clan/J2RGCRVG/how-elder-works")).toBeNull();
    expect(parseClanPath("/clan/J2RGCRVG/nope")).toBeNull();
  });
});

describe("standing", () => {
  test("groups members by status with evidence in a player's terms and marks you", async () => {
    vi.spyOn(manageApi, "standing").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        policy_version: 1,
        ranks_elder: true,
        how: [
          {
            key: "elder",
            title: "Elder",
            lines: ["Elder is earned by participation: Clan Wars 100%."],
          },
        ],
        as_of: "2026-09-12T18:00:00Z",
        freshness_seconds: 60,
        rows: [
          {
            player_tag: "#20JJJ2CCRU",
            name: "King Thing",
            role: "member",
            status: "rising",
            evidence: "100% war decks over 4 war weeks, ~200 donations a week",
          },
          {
            player_tag: "#8QCV",
            name: "Amy",
            role: "elder",
            status: "holding",
            evidence: "75% war decks over 4 war weeks",
          },
        ],
        you: {
          status: "rising",
          evidence: "100% war decks over 4 war weeks",
          next: ["Play the war decks you are asked for."],
          inactivity: null,
          days_idle: 0.5,
          hold: null,
        },
      },
    });
    renderWithProviders(
      <Standing
        clan={poap}
        who={{ player_tag: "#20JJJ2CCRU", role: "member" }}
      />,
    );
    await waitFor(() => expect(screen.getByText("Amy")).toBeTruthy());
    expect(screen.getByText(/Holding Elder · 1/)).toBeTruthy();
    expect(screen.getByText(/Rising · 1/)).toBeTruthy();
    expect(
      screen.getByText(/Play the war decks you are asked for/),
    ).toBeTruthy();
    expect(screen.getByText("How it works here")).toBeTruthy();
    expect(screen.getByText(/Clan Wars 100%/)).toBeTruthy();
    expect(document.querySelector("tr[data-you='true']")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(
      /\b(score|percentile|rank)\b/i,
    );
  });

  test("a clan with no policy yet says so", async () => {
    vi.spyOn(manageApi, "standing").mockResolvedValue({
      ok: false,
      status: 409,
      data: { error: "no_policy" },
    });
    renderWithProviders(
      <Standing clan={poap} who={{ player_tag: "#X", role: "member" }} />,
    );
    await waitFor(() => expect(screen.getByText("No policy yet")).toBeTruthy());
  });

  test("a policy that keeps standing to leaders still shows how the clan runs", async () => {
    vi.spyOn(manageApi, "standing").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        policy_version: 2,
        ranks_elder: false,
        how: [
          { key: "elder", title: "Elder", lines: ["Leaders choose Elders."] },
        ],
        rows: null,
        you: null,
      },
    });
    renderWithProviders(
      <Standing clan={poap} who={{ player_tag: "#X", role: "member" }} />,
    );
    await waitFor(() =>
      expect(screen.getByText("Leaders choose Elders.")).toBeTruthy(),
    );
    expect(document.body.textContent).not.toMatch(/Holding Elder/);
  });
});
