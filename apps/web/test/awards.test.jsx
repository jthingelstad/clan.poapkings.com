import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { Awards } from "../src/views/Awards.jsx";
import { manageApi } from "../src/api.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const poap = { clan_tag: "#J2RGCRVG", name: "POAP KINGS", role: "leader" };
const view = () => ({
  clan_tag: "#J2RGCRVG",
  can_edit: true,
  can_grant: ["free_pass"],
  evaluated_at: "2026-09-12T20:00:00Z",
  as_of: "2026-09-12T19:58:00Z",
  freshness_seconds: 120,
  config_version: 0,
  members: [
    { player_tag: "#20JJJ2CCRU", name: "King Thing", role: "leader" },
    { player_tag: "#U8RYG9Y2U", name: "King Levy", role: "coLeader" },
  ],
  kinds: {
    season_points_podium: {
      title: "Season points podium",
      rule: "r",
      params: {},
    },
    leaders_pick: { title: "Leaders' pick", rule: "r", params: {} },
  },
  versions: [],
  config: {
    publish: false,
    awards: [
      {
        id: "war_champ",
        kind: "season_points_podium",
        name: "War Champ",
        description: "d",
        enabled: true,
        params: { podium: 3, tiebreak: "donations" },
      },
      {
        id: "free_pass",
        kind: "leaders_pick",
        name: "Free Pass",
        description: "d",
        enabled: true,
        params: { granted_by: "leaders" },
      },
    ],
  },
  grants: [
    {
      season_id: 135,
      award_id: "war_champ",
      kind: "season_points_podium",
      name: "War Champ",
      rank: 1,
      player_tag: "#20JJJ2CCRU",
      player_name: "King Thing",
      metric_value: 16000,
      metric_unit: "points",
      manual: false,
      granted_at: "2026-09-08T00:00:00Z",
    },
  ],
  seasons: [
    {
      season_id: 136,
      closed: false,
      complete: true,
      weeks: 1,
      awards: [
        {
          award_id: "war_champ",
          kind: "season_points_podium",
          name: "War Champ",
          state: "live",
          rule: "r",
          rows: [
            {
              player_tag: "#U8RYG9Y2U",
              name: "King Levy",
              points: 1600,
              donations: 100,
              rank: 1,
              official_rank: 1,
              tied: false,
              on_podium: true,
            },
          ],
        },
        {
          award_id: "free_pass",
          kind: "leaders_pick",
          name: "Free Pass",
          state: "manual",
          rule: "r",
          rows: [],
        },
      ],
    },
    {
      season_id: 135,
      closed: true,
      closed_at: "2026-09-07T09:34:00Z",
      complete: true,
      weeks: 5,
      awards: [
        {
          award_id: "war_champ",
          kind: "season_points_podium",
          name: "War Champ",
          state: "closed",
          rule: "r",
          rows: [
            {
              player_tag: "#20JJJ2CCRU",
              name: "King Thing",
              points: 16000,
              donations: 200,
              rank: 1,
              official_rank: 1,
              tied: false,
              on_podium: true,
            },
          ],
        },
        {
          award_id: "free_pass",
          kind: "leaders_pick",
          name: "Free Pass",
          state: "manual",
          rule: "r",
          rows: [],
        },
      ],
    },
  ],
});

describe("awards", () => {
  test("shows the live race as provisional, the closed season's grants, and grants a pick by hand from the roster", async () => {
    vi.spyOn(manageApi, "awards").mockResolvedValue({
      ok: true,
      status: 200,
      data: view(),
    });
    const grant = vi
      .spyOn(manageApi, "grantAward")
      .mockResolvedValue({ ok: true, status: 200, data: {} });
    renderWithProviders(<Awards clan={poap} />);
    expect(await screen.findByText(/Season 136 · in progress/)).toBeTruthy();
    expect(screen.getByText(/Provisional/)).toBeTruthy();
    expect(screen.getByText(/Season 135 · closed 2026-09-07/)).toBeTruthy();
    expect(screen.getAllByText("granted").length).toBe(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Grant Free Pass for season 135" }),
    );
    fireEvent.change(screen.getByLabelText("Member"), {
      target: { value: "#U8RYG9Y2U" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Why/), {
      target: { value: "rotation" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Grant Free Pass" }));
    await waitFor(() => expect(grant).toHaveBeenCalled());
    expect(grant.mock.calls[0][1]).toEqual({
      award_id: "free_pass",
      player_tag: "#U8RYG9Y2U",
      player_name: "King Levy",
      season_id: 135,
      note: "rotation",
    });
  });

  test("the editor renames an award and saves a new version", async () => {
    vi.spyOn(manageApi, "awards").mockResolvedValue({
      ok: true,
      status: 200,
      data: view(),
    });
    const save = vi
      .spyOn(manageApi, "saveAwards")
      .mockResolvedValue({ ok: true, status: 200, data: { version: 1 } });
    renderWithProviders(<Awards clan={poap} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "edit the awards" }),
    );
    const name = screen.getAllByLabelText("Name")[0];
    fireEvent.change(name, { target: { value: "Boat Captain" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Save as a new version" }),
    );
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][1].awards[0].name).toBe("Boat Captain");
  });

  test("an elder sees the page read-only; a member is refused", async () => {
    vi.spyOn(manageApi, "awards").mockResolvedValue({
      ok: true,
      status: 200,
      data: { ...view(), can_edit: false, can_grant: [] },
    });
    renderWithProviders(<Awards clan={{ ...poap, role: "elder" }} />);
    expect(await screen.findByText(/Season 135/)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "edit the awards" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Grant Free Pass/ }),
    ).toBeNull();
    cleanup();
    vi.spyOn(manageApi, "awards").mockResolvedValue({
      ok: false,
      status: 403,
      data: { error: "elders_only" },
    });
    renderWithProviders(<Awards clan={{ ...poap, role: "member" }} />);
    expect(await screen.findByText(/for the leaders and elders/)).toBeTruthy();
  });
});
