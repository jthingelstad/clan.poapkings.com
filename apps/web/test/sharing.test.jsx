import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { Sharing } from "../src/views/Sharing.jsx";
import { manageApi } from "../src/api.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const clan = { clan_tag: "#2PQRJ8LV", name: "Example Clan", role: "leader" };
const types = {
  departure_classified: {
    label: "Kicks and leaves",
    why: "When a leader answers a departure.",
    sees: "Everyone verified in the clan, and the clan's agent: the game already shows the clan who was kicked.",
  },
  role_change_made: {
    label: "Promotions and demotions",
    why: "When a leader completes a promotion or demotion.",
    sees: "Everyone verified in the clan.",
  },
};

describe("share with Elixir", () => {
  test("every kind starts off; a leader turns one on and saves", async () => {
    vi.spyOn(manageApi, "sharing").mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        clan_tag: "#2PQRJ8LV",
        types,
        values: { departure_classified: false, role_change_made: false },
        saved_at: null,
      },
    });
    const save = vi
      .spyOn(manageApi, "saveSharing")
      .mockResolvedValue({ ok: true, status: 200, data: {} });
    renderWithProviders(<Sharing clan={clan} />);
    const kicks = await screen.findByLabelText("Kicks and leaves");
    expect(kicks.checked).toBe(false);
    expect(screen.getByText(/the clan's agent/)).toBeTruthy();
    const button = screen.getByRole("button", {
      name: "Save what the clan shares",
    });
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Promotions and demotions"));
    fireEvent.click(button);
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith("#2PQRJ8LV", {
        departure_classified: false,
        role_change_made: true,
      }),
    );
  });
});
