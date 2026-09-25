import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { SpreadWord } from "../src/components/SpreadWord.jsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const clan = (role) => ({
  clan_tag: "#2PQRJ8LV",
  name: "Example Clan",
  role,
});
const roster = (n) => ({ name: "Example Clan", member_count: n, members: [] });
const me = (policy) => ({ policy });

describe("spread the word", () => {
  test("a member of a clan with no policy invites the leaders, with a chat line and the link", async () => {
    const write = vi.fn().mockResolvedValue();
    Object.assign(navigator, { clipboard: { writeText: write } });
    renderWithProviders(
      <SpreadWord
        me={me({ set: false, active: false })}
        clan={clan("member")}
        roster={roster(24)}
      />,
    );
    expect(screen.getByText("Invite your leaders")).toBeTruthy();
    expect(screen.getByText(/each with its own log/)).toBeTruthy();
    const [line] = screen.getAllByRole("button", {
      name: "Copy for clan chat",
    });
    fireEvent.click(line);
    await waitFor(() => expect(write).toHaveBeenCalled());
    const text = write.mock.calls[0][0];
    expect(text).toMatch(/^Leaders: I use Elixir Clan/);
    expect(text).toMatch(/Example Clan/);
    expect(text.length).toBeLessThanOrEqual(200);
    expect(text).not.toMatch(/https?:|&|\+\d/);
  });

  test("a leader of a clan with no policy is sent to set it up", () => {
    renderWithProviders(
      <SpreadWord
        me={me({ set: false, active: false })}
        clan={clan("coLeader")}
        roster={roster(24)}
        navigate={vi.fn()}
      />,
    );
    expect(screen.getByText("Set up how the clan runs")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Set up the policy" }),
    ).toBeTruthy();
  });

  test("below 10 members the card points at Recruit, for everyone", () => {
    renderWithProviders(
      <SpreadWord
        me={me({ set: false, active: false })}
        clan={clan("leader")}
        roster={roster(6)}
      />,
    );
    expect(
      screen.getByText("Clan management starts at 10 members"),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Recruit ›" })).toBeTruthy();
  });

  test("with an active policy, anyone can bring clanmates in", () => {
    renderWithProviders(
      <SpreadWord
        me={me({ set: true, active: true })}
        clan={clan("member")}
        roster={roster(30)}
      />,
    );
    expect(screen.getByText("Bring your clanmates")).toBeTruthy();
  });
});
