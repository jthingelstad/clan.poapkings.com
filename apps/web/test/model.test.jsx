import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { Model } from "../src/views/Model.jsx";
import { Recruit } from "../src/views/Recruit.jsx";
import { manageApi } from "../src/api.js";
import { railItems, railKey } from "../src/lib/rail.js";
import { PITCH_FIELDS } from "@elixir-clan/engine";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const leaderClan = {
  clan_tag: "#2PQRJ8LV",
  name: "Example Clan",
  role: "leader",
};
const TYPED = `sk-ant-api03-${"t".repeat(40)}`;

const status = (extra = {}) => ({
  clan_tag: "#2PQRJ8LV",
  purposes: { recruit_pitch: { label: "Recruiting pitch" } },
  per_day: 20,
  keep_days: 90,
  uses: {
    today: 2,
    month: { count: 5, input_tokens: 3500, output_tokens: 900 },
    recent: [
      {
        at: "2026-09-25T11:00:00Z",
        by: "#20QQL8CCRU",
        by_name: "Ada",
        purpose: "recruit_pitch",
        model: "claude-sonnet-5",
        ok: true,
        input_tokens: 700,
        output_tokens: 180,
      },
    ],
  },
  set: true,
  hint: "sk-ant-…WXYZ",
  set_by: "#20QQL8CCRU",
  set_by_name: "Ada",
  set_at: "2026-09-25T10:00:00Z",
  model: "claude-sonnet-5",
  models: [
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
  ],
  refused_at: null,
  readable: true,
  owner_leads: true,
  usable: true,
  ...extra,
});

describe("the clan's model", () => {
  test("shows the key by its last four only, the model and the uses; a typed key leaves the page on submit", async () => {
    vi.spyOn(manageApi, "model").mockResolvedValue({
      ok: true,
      status: 200,
      data: status(),
    });
    const set = vi
      .spyOn(manageApi, "setModelKey")
      .mockResolvedValue({ ok: true, status: 200, data: { ok: true } });
    renderWithProviders(<Model clan={leaderClan} />);
    expect(await screen.findByText("sk-ant-…WXYZ")).toBeTruthy();
    expect(screen.getByText("in use")).toBeTruthy();
    expect(screen.getByText("2 of 20 uses")).toBeTruthy();
    expect(screen.getByLabelText("Model").value).toBe("claude-sonnet-5");
    expect(screen.getByText("Recruiting pitch")).toBeTruthy();
    const input = screen.getByPlaceholderText("sk-ant-…");
    expect(input.type).toBe("password");
    fireEvent.change(input, { target: { value: `  ${TYPED} ` } });
    fireEvent.click(screen.getByRole("button", { name: "Check and save" }));
    await waitFor(() => expect(set).toHaveBeenCalledWith("#2PQRJ8LV", TYPED));
    await waitFor(() => expect(input.value).toBe(""));
  });

  test("says why a key is not in use", async () => {
    vi.spyOn(manageApi, "model").mockResolvedValue({
      ok: true,
      status: 200,
      data: status({ owner_leads: false, usable: false }),
    });
    renderWithProviders(<Model clan={leaderClan} />);
    expect(await screen.findByText("not in use")).toBeTruthy();
    expect(
      screen.getByText(/Ada added this key and no longer leads/),
    ).toBeTruthy();
    expect(screen.getByText("Replace it with a key of yours")).toBeTruthy();
  });

  test("a leader drafts the pitch with it; the words fill the editor, checks are shown, and what they had comes back", async () => {
    const pitch = {
      tagline: "Old tagline",
      about: "Old about.",
      points: ["Old point"],
      looking_for: "Old look.",
      website_url: "https://example.org",
      contact: "Request in game.",
    };
    vi.spyOn(manageApi, "recruit").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        clan_tag: "#2PQRJ8LV",
        can_edit: true,
        model: { set: true, refused: false, model: "claude-sonnet-5" },
        pitch,
        pitch_version: 1,
        fields: PITCH_FIELDS,
        facts: { name: "Example Clan", members: 40, open_slots: 10 },
        facts_read_at: "2026-09-25T11:00:00Z",
        pending: null,
        copy: null,
        suggested: null,
        problems: [],
        versions: [],
      },
    });
    const draft = vi.spyOn(manageApi, "draftPitch").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        draft: {
          ...pitch,
          tagline: "War first, friends always",
          points: ["Four decks every war day", "Top 3 here"],
        },
        errors: {},
        checks: [
          "Check before saving: 3 was not in anything the model was told about the clan.",
        ],
        model: "claude-sonnet-5",
      },
    });
    renderWithProviders(<Recruit clan={leaderClan} />);
    fireEvent.click(await screen.findByText("edit the pitch"));
    fireEvent.change(screen.getByLabelText("What should it stress?"), {
      target: { value: "war days" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Draft it" }));
    await waitFor(() =>
      expect(draft).toHaveBeenCalledWith("#2PQRJ8LV", "war days"),
    );
    expect(
      await screen.findByDisplayValue("War first, friends always"),
    ).toBeTruthy();
    expect(
      screen.getByText(/3 was not in anything the model was told/),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("Put back what I had"));
    expect(await screen.findByDisplayValue("Old tagline")).toBeTruthy();
  });

  test("without a key, the editor points a leader to add one", async () => {
    vi.spyOn(manageApi, "recruit").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        clan_tag: "#2PQRJ8LV",
        can_edit: true,
        model: { set: false, refused: false, model: null },
        pitch: { tagline: "", about: "", points: [], looking_for: "" },
        pitch_version: 0,
        fields: PITCH_FIELDS,
        facts: null,
        pending: null,
        copy: null,
        suggested: null,
        problems: [],
        versions: [],
      },
    });
    const navigate = vi.fn();
    renderWithProviders(<Recruit clan={leaderClan} navigate={navigate} />);
    fireEvent.click(await screen.findByText("write the pitch"));
    fireEvent.click(screen.getByText("Add the clan's key"));
    expect(navigate).toHaveBeenCalledWith("/clan/2PQRJ8LV/manage/model");
    expect(screen.queryByRole("button", { name: "Draft it" })).toBeNull();
  });

  test("the rail offers Model to leaders, with or without a policy, and to no one else", () => {
    const me = (role, policy) => ({
      ok: true,
      selected: { clan_tag: "#2PQRJ8LV", role },
      clans: [{}],
      policy,
    });
    const keys = (m) => railItems(m).map((r) => r.key);
    expect(keys(me("leader", { set: false }))).toContain("model");
    expect(keys(me("coLeader", { set: true, active: true }))).toContain(
      "model",
    );
    expect(keys(me("elder", { set: true, active: true }))).not.toContain(
      "model",
    );
    expect(keys(me("member", { set: false }))).not.toContain("model");
    expect(railKey("/clan/2PQRJ8LV/manage/model")).toBe("model");
  });
});
