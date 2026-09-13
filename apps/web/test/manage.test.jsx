import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { parseClanPath } from "../src/App.jsx";
import { Standing } from "../src/views/Standing.jsx";
import { HowElderWorks } from "../src/views/HowElderWorks.jsx";
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
    expect(parseClanPath("/clan/J2RGCRVG/how-elder-works")).toEqual({
      tag: "#J2RGCRVG",
      section: "how-elder-works",
      tab: null,
    });
    expect(parseClanPath("/clan/J2RGCRVG/nope")).toBeNull();
  });
});

describe("standing", () => {
  test("groups members by status with evidence in a player's terms and marks you", async () => {
    vi.spyOn(manageApi, "standing").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        enabled: true,
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
          next: ["Finish every war day: four decks scores far more than two."],
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
    expect(screen.getByText(/Finish every war day/)).toBeTruthy();
    expect(document.querySelector("tr[data-you='true']")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(
      /\b(score|percentile|rank)\b/i,
    );
  });

  test("a private standing says so", async () => {
    vi.spyOn(manageApi, "standing").mockResolvedValue({
      ok: false,
      status: 403,
      data: { error: "standing_private" },
    });
    renderWithProviders(
      <Standing clan={poap} who={{ player_tag: "#X", role: "member" }} />,
    );
    await waitFor(() =>
      expect(screen.getByText(/keep standing private/)).toBeTruthy(),
    );
  });
});

describe("how elder works", () => {
  test("renders the clan's numbers, in the policy's voice, without internals", async () => {
    vi.spyOn(manageApi, "howElderWorks").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        clan_tag: "#J2RGCRVG",
        version: 2,
        groups: [],
        fields: {},
        values: {
          elder_management_enabled: true,
          removal_enabled: true,
          tenure_min_days: 28,
          floor_window_weeks: 2,
          floor_war_days: 1,
          floor_ranked_battles: 5,
          war_rate_window_weeks: 4,
          ranked_window_weeks: 4,
          donation_window_weeks: 4,
          band_floor_share: 0.2,
          band_ceiling_share: 0.3,
          promote_qualifying_weeks: 3,
          demote_abandoned_weeks: 2,
          demote_outranked_weeks: 3,
          at_risk_days: 5,
          confirm_days: 3,
          contribution_grace_max_days: 4,
        },
      },
    });
    renderWithProviders(<HowElderWorks tag="#J2RGCRVG" />);
    await waitFor(() =>
      expect(screen.getByText(/At least 28 days in the clan/)).toBeTruthy(),
    );
    expect(screen.getByText(/Between 20% and 30% of the roster/)).toBeTruthy();
    expect(screen.getByText(/8 days proposes a removal/)).toBeTruthy();
    expect(screen.getByText(/Policy version 2/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(
      /percentile|median|swap margin/i,
    );
  });
});
