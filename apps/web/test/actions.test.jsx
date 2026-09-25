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

describe("clan leader messages", () => {
  test("a promotion comes with its Clan Leader Message, counted against the game's limits and copyable", async () => {
    vi.spyOn(manageApi, "actions").mockResolvedValue(
      view({
        open: [
          {
            ...removal,
            card_id: "p1",
            type: "promotion",
            label: "Promote to Elder",
            channel: "leader_message",
            copy: null,
            message: {
              title: "Congrats, new Elder!",
              body: "Sleepy is now an Elder. Thank you for showing up for the clan.",
            },
            log: [],
          },
        ],
      }),
    );
    const write = vi.fn().mockResolvedValue();
    Object.assign(navigator, { clipboard: { writeText: write } });
    renderWithProviders(
      <Actions
        clan={clan}
        who={{ player_tag: "#20QQL8CCRU", role: "leader" }}
      />,
    );
    await waitFor(() => expect(screen.getByText("20/24")).toBeTruthy());
    expect(
      screen.getByText(/promote Sleepy, send this Clan Leader Message/),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "A title that runs far too long" },
    });
    expect(screen.getByText("30/24")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy the message" }));
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith(
        "Sleepy is now an Elder. Thank you for showing up for the clan.",
      ),
    );
  });

  test("an announcement is marked sent without a reason, with the words as edited", async () => {
    vi.spyOn(manageApi, "actions").mockResolvedValue(
      view({
        open: [
          {
            card_id: "r1",
            type: "rules_announcement",
            label: "Tell the clan how it runs",
            status: "proposed",
            can_act: true,
            audience: { kind: "leaders" },
            player_tag: null,
            raised_at: "2026-09-12T20:00:00Z",
            channel: "leader_message",
            copy: null,
            message: {
              title: "How our clan runs",
              body: "We now run the clan with Elixir Clan.",
            },
            evidence: { version: 1, changes: [] },
            log: [],
          },
        ],
      }),
    );
    const decide = vi
      .spyOn(manageApi, "decideAction")
      .mockResolvedValue({ ok: true, status: 200, data: {} });
    renderWithProviders(
      <Actions
        clan={clan}
        who={{ player_tag: "#20QQL8CCRU", role: "leader" }}
      />,
    );
    await waitFor(() => expect(screen.getByText("The clan")).toBeTruthy());
    // What is shared with Elixir is what the leader sent, as edited.
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Our rules" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sent" }));
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith("#2PQRJ8LV", "r1", {
        status: "done",
        reason: null,
        note: null,
        sent: {
          title: "Our rules",
          body: "We now run the clan with Elixir Clan.",
        },
      }),
    );
  });
});

describe("the clan's model on a Leader Message", () => {
  test("a leader drafts it in the clan's voice, sees what to check, and can put back what they had", async () => {
    vi.spyOn(manageApi, "actions").mockResolvedValue(
      view({
        model: { set: true, refused: false, model: "claude-sonnet-5" },
        open: [
          {
            card_id: "r1",
            type: "rules_announcement",
            label: "Tell the clan how it runs",
            status: "proposed",
            can_act: true,
            audience: { kind: "leaders" },
            player_tag: null,
            raised_at: "2026-09-12T20:00:00Z",
            channel: "leader_message",
            copy: null,
            message: {
              title: "How our clan runs",
              body: "We now run the clan with Elixir Clan.",
            },
            evidence: { version: 1, changes: [] },
            log: [],
          },
        ],
      }),
    );
    const draft = vi.spyOn(manageApi, "draftLeaderMessage").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        title: "Our way, in brief",
        body: "We run the clan with Elixir Clan now. Sign in to see where you stand.",
        warnings: [],
        model: "claude-sonnet-5",
      },
    });
    renderWithProviders(
      <Actions
        clan={clan}
        who={{ player_tag: "#20QQL8CCRU", role: "leader" }}
      />,
    );
    fireEvent.change(await screen.findByLabelText("What should it say?"), {
      target: { value: "warm" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Draft in our voice" }));
    await waitFor(() =>
      expect(draft).toHaveBeenCalledWith("#2PQRJ8LV", "r1", "warm"),
    );
    expect(await screen.findByDisplayValue("Our way, in brief")).toBeTruthy();
    expect(screen.getByText(/Drafted by claude-sonnet-5/)).toBeTruthy();
    fireEvent.click(screen.getByText("Put back what I had"));
    expect(await screen.findByDisplayValue("How our clan runs")).toBeTruthy();
  });

  test("without the clan's key, there is no draft button", async () => {
    vi.spyOn(manageApi, "actions").mockResolvedValue(
      view({
        open: [
          {
            card_id: "r1",
            type: "rules_announcement",
            label: "Tell the clan how it runs",
            status: "proposed",
            can_act: true,
            audience: { kind: "leaders" },
            player_tag: null,
            raised_at: "2026-09-12T20:00:00Z",
            channel: "leader_message",
            copy: null,
            message: { title: "How our clan runs", body: "Hello." },
            evidence: { version: 1, changes: [] },
            log: [],
          },
        ],
      }),
    );
    renderWithProviders(
      <Actions
        clan={clan}
        who={{ player_tag: "#20QQL8CCRU", role: "leader" }}
      />,
    );
    await screen.findByDisplayValue("How our clan runs");
    expect(
      screen.queryByRole("button", { name: "Draft in our voice" }),
    ).toBeNull();
  });
});

describe("you here", () => {
  test("a member sees their week, what the clan makes of it, and their time here", async () => {
    const { YouHere } = await import("../src/views/YouHere.jsx");
    vi.spyOn(manageApi, "memberView").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        clan_tag: "#2PQRJ8LV",
        clan_name: "Example Clan",
        as_of: "2026-09-12T19:58:00Z",
        freshness_seconds: 60,
        members: 24,
        min_members: 10,
        policy: { set: true, active: true },
        you: {
          player_tag: "#8QCV",
          name: "Sleepy",
          role: "member",
          this_week: {
            from: "2026-09-07T00:00:00Z",
            complete: false,
            battles: 10,
            ranked_battles: 2,
            donations: 100,
          },
          this_war_week: {
            season_id: 136,
            section_index: 0,
            open: true,
            decks: 8,
            decks_asked: null,
            points: 1600,
          },
          weeks: [
            {
              from: "2026-08-31T00:00:00Z",
              complete: true,
              battles: 20,
              ranked_battles: 0,
              donations: 200,
            },
            {
              from: "2026-09-07T00:00:00Z",
              complete: false,
              battles: 10,
              ranked_battles: 2,
              donations: 100,
            },
          ],
          war_weeks: [
            {
              season_id: 135,
              section_index: 4,
              is_colosseum: true,
              open: false,
              decks: 16,
              decks_asked: 16,
              points: 3200,
            },
          ],
          trophies: 7000,
          time_here: {
            joined_observed_at: "2026-08-20T00:00:00Z",
            tenure_known: true,
            days: 23,
            recording_since: "2026-05-01T00:00:00Z",
            events: [],
          },
        },
        clan: {
          version: 1,
          goals: ["war"],
          counted: ["war", "donations"],
          ranks_elder: true,
          status: "participating",
          evidence: "100% war decks over 4 war weeks",
          next: ["5 more days in the clan before Elder consideration."],
          minimums: {
            set: { war: 1 },
            met: { war: true },
            passes: true,
            unknown: false,
            rule: "any",
            window_weeks: 2,
          },
          tenure_min_days: 28,
          inactivity: null,
        },
        open_actions: 1,
        hold: null,
        trophies: [],
      },
    });
    renderWithProviders(<YouHere clan={clan} navigate={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText("How you are doing here")).toBeTruthy(),
    );
    expect(screen.getByText("Participating")).toBeTruthy();
    expect(screen.getByText(/5 more days in the clan/)).toBeTruthy();
    expect(screen.getByText(/23 of the 28 days/)).toBeTruthy();
    expect(screen.getByText(/1 action waiting for you/)).toBeTruthy();
    expect(screen.getByText(/8 this war week/)).toBeTruthy();
    expect(screen.getByText(/16 of 16/)).toBeTruthy();
    expect(screen.getByText(/Joined 2026-08-20: 23 days/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bcard\b/i);
  });
});
