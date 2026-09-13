import { afterEach, describe, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Recruit } from "../src/views/Recruit.jsx";
import { manageApi } from "../src/api.js";
import { railItems, railKey } from "../src/components/Rail.jsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const poap = { clan_tag: "#J2RGCRVG", name: "POAP KINGS", role: "member" };
const view = (extra = {}) => ({
  clan_tag: "#J2RGCRVG",
  can_edit: false,
  pitch: {
    tagline: "Compete, belong, be remembered",
    about: "About us.",
    points: ["Serious about war"],
    looking_for: "Active players.",
    website_url: "https://poapkings.com",
    contact: "Request in game.",
  },
  pitch_version: 0,
  fields: {},
  facts: {
    name: "POAP KINGS",
    tag: "#J2RGCRVG",
    type: "inviteOnly",
    members: 47,
    open_slots: 3,
    required_trophies: 5000,
    clan_score: 61234,
    war_trophies: 3210,
    donations_per_week: 8400,
    top_trophies: [{ name: "King Thing", value: 9000 }],
    top_donors: [],
    source: "live",
  },
  facts_read_at: "2026-09-13T12:00:00Z",
  facts_cached: true,
  pending: null,
  copy: {
    message: "POAP KINGS is recruiting.",
    social: "Social.",
    email: { subject: "Join POAP KINGS", body: "Body." },
    discord:
      "**POAP KINGS (#J2RGCRVG): Compete Required Trophies: [5000]**\nbody",
    reddit: { title: "POAP KINGS #J2RGCRVG - Compete [5000]", body: "body" },
  },
  problems: [],
  versions: [],
  ...extra,
});

describe("recruit", () => {
  test("shows the facts, the pitch, and five channels a member can edit, reset and copy", async () => {
    vi.spyOn(manageApi, "recruit").mockResolvedValue({
      ok: true,
      status: 200,
      data: view(),
    });
    const write = vi.fn().mockResolvedValue();
    Object.assign(navigator, { clipboard: { writeText: write } });
    render(<Recruit clan={poap} />);
    expect(await screen.findByText(/47 of 50 · 3 open/)).toBeTruthy();
    expect(screen.getByText(/5,000 trophies · invite only/)).toBeTruthy();
    expect(screen.getByText("Compete, belong, be remembered")).toBeTruthy();
    const discord = screen.getByLabelText("Discord post");
    expect(discord.value).toMatch(/Required Trophies: \[5000\]/);
    expect(screen.getByLabelText("Reddit post").value).toMatch(
      /^Title: POAP KINGS #J2RGCRVG/,
    );
    fireEvent.change(discord, { target: { value: "my own words" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Copy the discord post" }),
    );
    await waitFor(() => expect(write).toHaveBeenCalledWith("my own words"));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByLabelText("Discord post").value).toMatch(
      /Required Trophies/,
    );
    expect(screen.queryByText("edit the pitch")).toBeNull();
  });

  test("a pending live read says so and the record stands in; a rule break is shown", async () => {
    vi.spyOn(manageApi, "recruit").mockResolvedValue({
      ok: true,
      status: 200,
      data: view({
        facts: {
          name: "POAP KINGS",
          members: 47,
          open_slots: 3,
          required_trophies: null,
          top_trophies: [],
          top_donors: [],
          source: "recorded",
        },
        pending: { retry_after_s: 30 },
        problems: ["reddit title must include [5000]"],
      }),
    });
    render(<Recruit clan={poap} />);
    expect(await screen.findByText(/fresh read queued/)).toBeTruthy();
    expect(screen.getByText(/not in the record yet/)).toBeTruthy();
    expect(screen.getByText(/breaks a rule: reddit title/)).toBeTruthy();
  });

  test("the rail offers Recruit to every member", () => {
    const me = {
      ok: true,
      selected: { clan_tag: "#J2RGCRVG", role: "member" },
      clans: [{}],
    };
    expect(railItems(me).map((r) => r.key)).toContain("recruit");
    expect(railKey("/clan/J2RGCRVG/recruit")).toBe("recruit");
  });
});
