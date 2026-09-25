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
  clan_tag: "#2PQRJ8LV",
  name: "Example Clan",
  acting_as: "#20QQL8CCRU",
  acting_as_name: "Ada",
  role: "leader",
  role_label: "Leader",
  your_tags: ["#20QQL8CCRU"],
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
    expect(parseClanPath("/clan/2PQRJ8LV")).toEqual({
      tag: "#2PQRJ8LV",
      section: "roster",
      tab: null,
    });
    expect(parseClanPath("/clan/2pqrj8lv/manage/board")).toEqual({
      tag: "#2PQRJ8LV",
      section: "manage",
      tab: "board",
    });
    expect(parseClanPath("/clan/2PQRJ8LV/standing")).toEqual({
      tag: "#2PQRJ8LV",
      section: "standing",
      tab: null,
    });
    // Elixir Clan publishes no public pages (Jamie, 2026-09-25).
    expect(parseClanPath("/clan/2PQRJ8LV/how-elder-works")).toBeNull();
    expect(parseClanPath("/clan/2PQRJ8LV/nope")).toBeNull();
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
            player_tag: "#20QQL8CCRU",
            name: "Ada",
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
        who={{ player_tag: "#20QQL8CCRU", role: "member" }}
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

describe("below 10 members", () => {
  test("Standing says clan management starts at 10 and why", async () => {
    vi.spyOn(manageApi, "standing").mockResolvedValue({
      ok: false,
      status: 409,
      data: { error: "too_few_members", members: 6, min_members: 10 },
    });
    renderWithProviders(
      <Standing clan={poap} who={{ player_tag: "#X", role: "member" }} />,
    );
    await waitFor(() =>
      expect(
        screen.getByText("Clan management starts at 10 members"),
      ).toBeTruthy(),
    );
    expect(screen.getByText(/This clan has 6\./)).toBeTruthy();
  });
});
