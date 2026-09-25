import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { Actions } from "../src/views/Actions.jsx";
import { manageApi } from "../src/api.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const clan = { clan_tag: "#2PQRJ8LV", name: "Example Clan", role: "leader" };
const removal = {
  card_id: "a1",
  type: "removal",
  label: "Remove from the clan",
  status: "proposed",
  can_act: true,
  audience: { kind: "leaders" },
  player_tag: "#8QCV",
  player_name: "Sleepy",
  role_at_raise: "member",
  raised_at: "2026-09-12T20:00:00Z",
  policy_version: 1,
  copy: "Sleepy was removed for inactivity (20 days without a battle).",
  evidence: {
    as_of: "2026-09-12T19:58:00Z",
    rationale: {
      headline: "20 battle-free days: at risk at 5, an action at 8.",
    },
    facts: [],
  },
  log: [
    {
      entry_id: "e1",
      kind: "raised",
      at: "2026-09-12T20:00:00Z",
      by: { system: "elixir-clan" },
      text: "20 battle-free days: at risk at 5, an action at 8.",
      detail: {
        policy_version: 1,
        clauses: ["at_risk_days", "confirm_days"],
        facts: ["Last battle: 20 days ago (record)"],
        prior: [
          {
            card_id: "a0",
            status: "declined",
            raised_at: "2026-09-01T00:00:00Z",
            closed_at: "2026-09-02T00:00:00Z",
            reason: "knows_the_member",
          },
        ],
      },
    },
  ],
};
const view = (extra = {}) => ({
  ok: true,
  status: 200,
  data: {
    clan_tag: "#2PQRJ8LV",
    as_of: "2026-09-12T19:58:00Z",
    freshness_seconds: 60,
    policy_version: 1,
    open: [removal],
    recent: [],
    decline_reasons: ["not_now", "knows_the_member", "other"],
    ...extra,
  },
});

describe("actions", () => {
  test("an action shows what raised it, its earlier history, and can be completed and commented on", async () => {
    vi.spyOn(manageApi, "actions").mockResolvedValue(view());
    const decide = vi
      .spyOn(manageApi, "decideAction")
      .mockResolvedValue({ ok: true, status: 200, data: {} });
    const comment = vi
      .spyOn(manageApi, "commentAction")
      .mockResolvedValue({ ok: true, status: 200, data: {} });
    renderWithProviders(
      <Actions
        clan={clan}
        who={{ player_tag: "#20QQL8CCRU", role: "leader" }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("Remove from the clan · 1")).toBeTruthy(),
    );
    expect(screen.getByText(/Log · 1 entry/)).toBeTruthy();
    expect(
      screen.getByText(/Earlier: declined 2026-09-02 \(knows the member\)/),
    ).toBeTruthy();
    expect(
      screen.getByText(/policy v1: at_risk_days, confirm_days/),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Comment"), {
      target: { value: "Messaged them first." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(comment).toHaveBeenCalledWith(
        "#2PQRJ8LV",
        "a1",
        "Messaged them first.",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith("#2PQRJ8LV", "a1", {
        status: "done",
        reason: null,
        note: null,
      }),
    );
    expect(document.body.textContent).not.toMatch(/\bcard\b/i);
  });

  test("a member's own away question offers to mark away or say no", async () => {
    vi.spyOn(manageApi, "actions").mockResolvedValue(
      view({
        open: [
          {
            ...removal,
            card_id: "a2",
            type: "away",
            label: "Going to be away?",
            audience: { kind: "member", player_tag: "#8QCV" },
            copy: null,
            evidence: { days_idle: 6.2, away_max_days: 30 },
            log: [],
          },
        ],
      }),
    );
    const navigate = vi.fn();
    renderWithProviders(
      <Actions
        clan={{ ...clan, role: "member" }}
        who={{ player_tag: "#8QCV", role: "member" }}
        navigate={navigate}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/You have not played in 6 days/)).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("link", { name: "Mark me away" }));
    expect(navigate).toHaveBeenCalledWith("/you/away");
    expect(screen.getByRole("button", { name: "I’m not away" })).toBeTruthy();
  });

  test("nothing waiting says so", async () => {
    vi.spyOn(manageApi, "actions").mockResolvedValue(view({ open: [] }));
    renderWithProviders(
      <Actions clan={clan} who={{ player_tag: "#X", role: "member" }} />,
    );
    await waitFor(() =>
      expect(screen.getByText("Nothing waiting for you")).toBeTruthy(),
    );
  });
});
