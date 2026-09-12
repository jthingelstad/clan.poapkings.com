import { afterEach, describe, expect, test } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { RosterTable, ClanHeader } from "../src/views/Clan.jsx";
import { Refused, REFUSALS } from "../src/views/Refused.jsx";
import { Landing } from "../src/views/Landing.jsx";
import { Disclaimer } from "../src/components/Disclaimer.jsx";
import { Clans } from "../src/views/Clans.jsx";
import { clanFromPath, clanPath } from "../src/App.jsx";

afterEach(cleanup);

const poap = {
  clan_tag: "#J2RGCRVG",
  name: "POAP KINGS",
  acting_as: "#20JJJ2CCRU",
  acting_as_name: "King Thing",
  role: "leader",
  role_label: "Leader",
  your_tags: ["#20JJJ2CCRU"],
};
const other = {
  clan_tag: "#PYLQ2",
  name: "Elsewhere",
  acting_as: "#8QCV",
  acting_as_name: "Big Thing",
  role: "member",
  role_label: "Member",
  your_tags: ["#8QCV"],
};
const me = {
  signed_in: true,
  ok: true,
  principal: {
    kind: "person",
    subject: { type: "player", tag: "#20JJJ2CCRU", name: "King Thing" },
  },
  primary: { player_tag: "#20JJJ2CCRU", name: "King Thing" },
  identities: [
    {
      player_tag: "#20JJJ2CCRU",
      name: "King Thing",
      is_primary: true,
      relationship: "primary",
      claim_status: "verified",
      clan_tag: "#J2RGCRVG",
      role: "leader",
      role_label: "Leader",
    },
  ],
  clans: [poap],
  selected: {
    clan_tag: "#J2RGCRVG",
    name: "POAP KINGS",
    player_tag: "#20JJJ2CCRU",
    player_name: "King Thing",
    role: "leader",
    role_label: "Leader",
    your_tags: ["#20JJJ2CCRU"],
  },
};

describe("the clan page", () => {
  test("header reads name · role · clan and says how current the roster is", () => {
    render(
      <ClanHeader
        clan={poap}
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

describe("choosing a clan", () => {
  test("the header chip becomes a menu of the other clans when there is more than one", () => {
    render(
      <ClanHeader
        clan={poap}
        roster={null}
        others={[other]}
        navigate={() => {}}
      />,
    );
    const button = screen.getByRole("button", { expanded: false });
    expect(button.textContent).toContain("King Thing");
    fireEvent.click(button);
    expect(screen.getByRole("menuitem", { name: /Elsewhere/ })).toBeTruthy();
    expect(
      screen
        .getByRole("menuitem", { name: /All your clans/ })
        .getAttribute("href"),
    ).toBe("/clans");
  });

  test("one clan: a plain chip, no menu", () => {
    render(
      <ClanHeader clan={poap} roster={null} others={[]} navigate={() => {}} />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("the chooser lists verified clans as cards and unverified alts greyed with a Verify link", () => {
    const two = {
      ...me,
      clans: [poap, other],
      identities: [
        ...me.identities,
        {
          player_tag: "#8QCV",
          name: "Big Thing",
          is_primary: false,
          relationship: "alt",
          claim_status: "verified",
          clan_tag: "#PYLQ2",
          role: "member",
          role_label: "Member",
        },
        {
          player_tag: "#22GG",
          name: "Third",
          is_primary: false,
          relationship: "alt",
          claim_status: "unverified",
          clan_tag: "#RRR",
          role: "member",
          role_label: "Member",
        },
      ],
    };
    const chosen = [];
    render(
      <Clans me={two} onSelect={(t) => chosen.push(t)} selecting={false} />,
    );
    const cards = screen.getAllByRole("button");
    expect(cards.map((c) => c.getAttribute("data-clan"))).toEqual([
      "#J2RGCRVG",
      "#PYLQ2",
    ]);
    expect(cards[0].getAttribute("aria-current")).toBe("true");
    expect(within(cards[1]).getByText("Member")).toBeTruthy();
    fireEvent.click(cards[1]);
    expect(chosen).toEqual(["#PYLQ2"]);
    expect(screen.getByText("Third")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /Verify in Elixir/ })
        .getAttribute("href"),
    ).toContain("/account/verify");
    expect(screen.queryByText("#RRR", { exact: false })).toBeTruthy();
  });

  test("clan paths carry the tag without its #, and only your clans resolve", () => {
    expect(clanPath("#J2RGCRVG")).toBe("/clan/J2RGCRVG");
    expect(clanFromPath("/clan/J2RGCRVG", [poap, other])).toBe(poap);
    expect(clanFromPath("/clan/j2rgcrvg/", [poap])).toBe(poap);
    expect(clanFromPath("/clan/PYLQ2", [poap])).toBeNull();
    expect(clanFromPath("/clan", [poap])).toBeNull();
    expect(clanFromPath("/clans", [poap])).toBeNull();
  });

  test("the roster marks every one of your tags in a clan", () => {
    const members = [
      {
        player_tag: "#20JJJ2CCRU",
        name: "King Thing",
        role: "member",
        role_label: "Member",
        you: true,
      },
      {
        player_tag: "#8QCV",
        name: "Big Thing",
        role: "coLeader",
        role_label: "Co-leader",
        you: true,
      },
      {
        player_tag: "#X",
        name: "Someone",
        role: "member",
        role_label: "Member",
        you: false,
      },
    ];
    const { container } = render(<RosterTable members={members} now={0} />);
    expect(container.querySelectorAll("tr[data-you='true']").length).toBe(2);
  });
});
