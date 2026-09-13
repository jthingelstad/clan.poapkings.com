import { afterEach, describe, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Feedback, FeedbackItem } from "../src/views/Feedback.jsx";
import { MaintainItem } from "../src/views/Maintain.jsx";
import { Rail, railItems, railKey } from "../src/components/Rail.jsx";
import { feedbackApi } from "../src/api.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const me = {
  signed_in: true,
  ok: true,
  selected: { clan_tag: "#J2RGCRVG", role: "member" },
  clans: [{ clan_tag: "#J2RGCRVG" }],
  primary: { name: "Amy" },
  feedback_unseen: 2,
  maintainer: false,
};

describe("feedback", () => {
  test("files a note with the page and clan attached, then lists it", async () => {
    const file = vi
      .spyOn(feedbackApi, "file")
      .mockResolvedValue({ ok: true, status: 200, data: {} });
    const list = vi
      .spyOn(feedbackApi, "list")
      .mockResolvedValueOnce({ ok: true, status: 200, data: { feedback: [] } })
      .mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          feedback: [
            {
              feedback_id: "abc123",
              category: "judgment",
              message: "The clock is wrong.\nMore.",
              status: "new",
              response: null,
              created_at: "2026-09-12T19:00:00Z",
            },
          ],
        },
      });
    render(
      <Feedback me={me} navigate={vi.fn()} from="/clan/J2RGCRVG/standing" />,
    );
    expect(await screen.findByText("Nothing filed yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "judgment" },
    });
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "The clock is wrong." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(file).toHaveBeenCalled());
    expect(file.mock.calls[0][0]).toEqual({
      message: "The clock is wrong.",
      category: "judgment",
      context: {
        path: "/clan/J2RGCRVG/standing",
        clan_tag: "#J2RGCRVG",
        role: "member",
      },
    });
    expect(await screen.findByText("fb_abc123")).toBeTruthy();
    expect(screen.getByText("The clock is wrong.")).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(2);
  });

  test("a record renders the note and the reply as Markdown", async () => {
    vi.spyOn(feedbackApi, "item").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        feedback_id: "abc123",
        category: "bug",
        message: "**bold** and <script>alert(1)</script>",
        status: "done",
        response: "Fixed in the *fourth* push.",
        responded_at: "2026-09-13T10:00:00Z",
        created_at: "2026-09-12T19:00:00Z",
        shipped_in: "fourth push",
      },
    });
    const { container } = render(
      <FeedbackItem id="abc123" navigate={vi.fn()} />,
    );
    expect(await screen.findByText("fb_abc123")).toBeTruthy();
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("em")?.textContent).toBe("fourth");
    expect(screen.getByText("shipped: fourth push")).toBeTruthy();
  });

  test("the maintainer answers with a status and a reply", async () => {
    vi.spyOn(feedbackApi, "queue").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        feedback: [
          {
            feedback_id: "abc123",
            person_tag: "#8QCV",
            person_name: "Amy",
            category: "feature",
            message: "Scout should show clan history.",
            status: "new",
            context: {
              path: "/clan/J2RGCRVG/manage/scout",
              clan_tag: "#J2RGCRVG",
              role: "elder",
            },
            created_at: "2026-09-12T19:00:00Z",
          },
        ],
      },
    });
    const decide = vi
      .spyOn(feedbackApi, "decide")
      .mockResolvedValue({ ok: true, status: 200, data: {} });
    render(<MaintainItem id="abc123" navigate={vi.fn()} />);
    expect(
      await screen.findByText("Scout should show clan history."),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Reply/), {
      target: { value: "On the list." },
    });
    fireEvent.click(screen.getByRole("button", { name: "planned + reply" }));
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith("abc123", {
        status: "planned",
        response: "On the list.",
      }),
    );
  });

  test("the rail marks unseen replies and shows Maintain only to the maintainer", () => {
    render(<Rail me={me} navigate={vi.fn()} path="/you" narrow={false} />);
    expect(screen.getByLabelText("2 new replies")).toBeTruthy();
    expect(screen.queryByText("Feedback queue")).toBeNull();
    cleanup();
    render(
      <Rail
        me={{ ...me, maintainer: true, feedback_unseen: 0 }}
        navigate={vi.fn()}
        path="/maintain/feedback"
        narrow={false}
      />,
    );
    expect(screen.getByText("Feedback queue")).toBeTruthy();
    expect(screen.queryByLabelText(/new/)).toBeNull();
  });

  test("the rail offers Manage to leaders, Awards and Scout to elders, and neither to members", () => {
    const keys = (role) =>
      railItems({ ...me, selected: { ...me.selected, role } }).map(
        (r) => r.key,
      );
    expect(keys("leader")).toEqual([
      "clan",
      "standing",
      "recruit",
      "inbox",
      "board",
      "history",
      "policy",
      "awards",
      "scout",
      "you",
      "away",
      "feedback",
    ]);
    expect(keys("elder")).toEqual([
      "clan",
      "standing",
      "recruit",
      "awards",
      "scout",
      "you",
      "away",
      "feedback",
    ]);
    expect(keys("member")).toEqual([
      "clan",
      "standing",
      "recruit",
      "you",
      "away",
      "feedback",
    ]);
    expect(railItems({ ...me, clans: [{}, {}] })[0].key).toBe("clans");
    expect(railKey("/clan/J2RGCRVG")).toBe("clan");
    expect(railKey("/clan/J2RGCRVG/manage")).toBe("inbox");
    expect(railKey("/clan/J2RGCRVG/manage/awards")).toBe("awards");
    expect(railKey("/you/away")).toBe("away");
    expect(railKey("/feedback/abc")).toBe("feedback");
  });
});
