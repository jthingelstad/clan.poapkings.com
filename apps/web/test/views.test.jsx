import { afterEach, describe, expect, test } from "vitest";

afterEach(cleanup);
import { cleanup, render, screen, within } from "@testing-library/react";
import { RosterTable, ClanHeader } from "../src/views/Clan.jsx";
import { Refused, REFUSALS } from "../src/views/Refused.jsx";
import { Landing } from "../src/views/Landing.jsx";
import { Disclaimer } from "../src/components/Disclaimer.jsx";

const me = {
  signed_in: true,
  ok: true,
  principal: {
    kind: "person",
    subject: { type: "player", tag: "#20JJJ2CCRU", name: "King Thing" },
  },
  player: {
    player_tag: "#20JJJ2CCRU",
    name: "King Thing",
    role: "leader",
    role_label: "Leader",
  },
  clan: { clan_tag: "#J2RGCRVG", name: "POAP KINGS" },
};

describe("the clan page", () => {
  test("header reads name · role · clan and says how current the roster is", () => {
    render(
      <ClanHeader
        me={me}
        roster={{
          name: "POAP KINGS",
          meta: { freshness_seconds: 120, as_of: "2026-09-12T18:00:00Z" },
        }}
      />,
    );
    const chip = screen
      .getByText("King Thing", { exact: false })
      .closest(".chip");
    expect(chip.textContent).toContain("King Thing");
    expect(within(chip).getByText("Leader")).toBeTruthy();
    expect(chip.textContent).toContain("POAP KINGS");
    expect(screen.getByText(/as of 2m ago/)).toBeTruthy();
  });

  test("a full clan is grouped by role with your row marked and the API's coLeader spelled Co-leader", () => {
    const now = Date.parse("2026-09-12T18:00:00Z");
    const members = [
      {
        player_tag: "#20JJJ2CCRU",
        name: "King Thing",
        role: "leader",
        role_label: "Leader",
        trophies: 8000,
        donations_this_week: 40,
        you: true,
        last_seen_in_game: "2026-09-12T17:00:00Z",
        last_recorded_battle: null,
      },
      {
        player_tag: "#C1",
        name: "Bo",
        role: "coLeader",
        role_label: "Co-leader",
        trophies: 8500,
        donations_this_week: 5,
        you: false,
      },
      {
        player_tag: "#E1",
        name: "Amy",
        role: "elder",
        role_label: "Elder",
        trophies: null,
        donations_this_week: 0,
        you: false,
      },
      {
        player_tag: "#M1",
        name: "Zed",
        role: "member",
        role_label: "Member",
        trophies: 9000,
        donations_this_week: 10,
        you: false,
      },
    ];
    const { container } = render(<RosterTable members={members} now={now} />);
    const labels = [...container.querySelectorAll("td.label")].map(
      (td) => td.textContent,
    );
    expect(labels).toEqual([
      "Leader · 1",
      "Co-leaders · 1",
      "Elders · 1",
      "Members · 1",
    ]);
    const you = container.querySelector("tr[data-you='true']");
    expect(you.textContent).toContain("★");
    expect(you.textContent).toContain("King Thing");
    expect(container.querySelectorAll("tr[data-you='true']").length).toBe(1);
    expect(screen.getByText("Co-leader")).toBeTruthy();
    expect(screen.queryByText("coLeader")).toBeNull();
    expect(you.textContent).toContain("60m ago");
    // A null trophy count is a dash, never a zero.
    const amy = screen.getByText("Amy").closest("tr");
    const cells = [...amy.querySelectorAll("td")].map((td) => td.textContent);
    expect(cells[2]).toBe("—"); // trophies unknown
    expect(cells[3]).toBe("0"); // donations really zero
  });

  test("an empty clan renders no rows and no groups", () => {
    const { container } = render(<RosterTable members={[]} />);
    expect(container.querySelectorAll("tbody").length).toBe(0);
    expect(container.querySelector("table")).toBeTruthy();
  });
});

describe("the gate pages", () => {
  test.each(Object.keys(REFUSALS))(
    "%s says what to do and links to it",
    (reason) => {
      render(<Refused reason={reason} me={me} onRecheck={() => {}} />);
      const page = REFUSALS[reason];
      expect(screen.getByRole("heading", { name: page.title })).toBeTruthy();
      const link = screen.getByRole("link", { name: `${page.link[1]} ›` });
      expect(link.getAttribute("href")).toBe(page.link[0]);
    },
  );

  test("the four refusals point at four different Elixir places", () => {
    const hrefs = Object.values(REFUSALS).map((p) => p.link[0]);
    expect(new Set(hrefs).size).toBe(4);
    expect(REFUSALS.no_primary_player.link[0]).toContain("/account/tracking");
    expect(REFUSALS.unverified.link[0]).toContain("/account/verify");
  });

  test("an agent's grant offers a fresh sign-in, the others offer a re-check", () => {
    render(<Refused reason="not_a_person" me={me} onRecheck={() => {}} />);
    expect(
      screen.getByRole("link", { name: "Sign in again" }).getAttribute("href"),
    ).toBe("/auth/login");
    cleanup();
    render(<Refused reason="unverified" me={me} onRecheck={() => {}} />);
    expect(screen.getByRole("button", { name: /check again/i })).toBeTruthy();
  });
});

describe("the landing page", () => {
  test("names both prerequisites before the button", () => {
    render(<Landing />);
    expect(screen.getByText(/An Elixir account/)).toBeTruthy();
    expect(screen.getByText(/A verified player/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Request access/ }).getAttribute("href"),
    ).toContain("elixir.poapkings.com");
    expect(
      screen
        .getByRole("link", { name: "Sign in with Elixir" })
        .getAttribute("href"),
    ).toBe("/auth/login");
    expect(screen.getByText("cr:read")).toBeTruthy();
  });

  test("a sign-in error is explained", () => {
    render(<Landing error="state_mismatch" />);
    expect(screen.getByRole("alert").textContent).toMatch(
      /did not start in this browser/,
    );
  });
});

test("the disclaimer is Supercell's fan-content note", () => {
  render(<Disclaimer />);
  expect(screen.getByText(/not endorsed by Supercell/)).toBeTruthy();
  expect(screen.getByRole("link", { name: /fan-content-policy/ })).toBeTruthy();
});
