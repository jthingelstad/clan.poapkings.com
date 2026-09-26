import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { api, manageApi } from "../src/api.js";

// Leaflet draws on a laid-out page; the test's document has no layout.
// Everything it is asked to do is recorded instead.
const drawn = [];
vi.mock("leaflet", () => {
  const chain = (kind, args) => {
    const self = {
      addTo: () => (drawn.push([kind, ...args]), self),
      bindPopup: () => self,
      setView: () => self,
      clearLayers: () =>
        drawn.splice(0, drawn.length, ...drawn.filter(([k]) => k !== "pin")),
      fitBounds: () => self,
      remove: () => {},
    };
    return self;
  };
  const L = {
    map: () => chain("map", []),
    tileLayer: (url) => chain("tiles", [url]),
    layerGroup: () => chain("group", []),
    circleMarker: (at) => chain("pin", [at]),
    latLngBounds: (points) => points,
  };
  return { default: L };
});
vi.mock("leaflet/dist/leaflet.css", () => ({}));

const { ClanMap } = await import("../src/views/ClanMap.jsx");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  drawn.splice(0);
});

const clan = { clan_tag: "#2PQRJ8LV", name: "Example Clan", role: "member" };
const austin = {
  country: "US",
  country_name: "United States",
  region: "TX",
  region_name: "Texas",
  city: 4671654,
  city_name: "Austin",
  precision: "city",
  lat: 30.27,
  lng: -97.74,
  tz: "America/Chicago",
};
const mapBody = (entries) => ({
  clan_tag: "#2PQRJ8LV",
  members: 12,
  on_map: entries.length,
  entries,
  yours: null,
  attribution:
    "Places from GeoNames (geonames.org, CC BY 4.0). Map © OpenStreetMap contributors.",
});

describe("clan map", () => {
  test("members on the map by country, with local time; you are asked to add yourself", async () => {
    vi.spyOn(manageApi, "map").mockResolvedValue({
      ok: true,
      status: 200,
      data: mapBody([
        {
          player_tag: "#8QCV",
          name: "Ben",
          role: "member",
          role_label: "Member",
          you: false,
          place: austin,
        },
      ]),
    });
    vi.spyOn(api, "myPlace").mockResolvedValue({
      ok: true,
      status: 200,
      data: { place: null },
    });
    renderWithProviders(<ClanMap clan={clan} />);
    await screen.findByText(/1 of 12 members on the map/);
    expect(screen.getByText(/United States · 1/)).toBeTruthy();
    expect(screen.getByText(/Ben · Member · Austin, Texas ·/)).toBeTruthy();
    await screen.findByText("Add yourself to the map");
    expect(screen.getByText(/OpenStreetMap contributors/)).toBeTruthy();
    await waitFor(() =>
      expect(drawn.some(([kind]) => kind === "pin")).toBe(true),
    );
    expect(drawn.find(([kind]) => kind === "tiles")?.[1]).toMatch(
      /tile\.openstreetmap\.org/,
    );
  });

  test("the picker offers the country's regions, then its cities, and saves the ids", async () => {
    vi.spyOn(manageApi, "map").mockResolvedValue({
      ok: true,
      status: 200,
      data: mapBody([]),
    });
    vi.spyOn(api, "myPlace").mockResolvedValue({
      ok: true,
      status: 200,
      data: { place: null },
    });
    const saved = vi
      .spyOn(api, "setMyPlace")
      .mockResolvedValue({ ok: true, status: 200, data: { place: austin } });
    renderWithProviders(<ClanMap clan={clan} />);
    const country = await screen.findByLabelText("Country");
    await waitFor(() =>
      expect(country.querySelectorAll("option").length).toBeGreaterThan(200),
    );
    fireEvent.change(country, { target: { value: "US" } });
    const region = await screen.findByLabelText("State or region");
    fireEvent.change(region, { target: { value: "TX" } });
    const city = await screen.findByLabelText(/City/);
    fireEvent.change(city, { target: { value: "4671654" } });
    fireEvent.click(screen.getByText("Add me"));
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith({
        country: "US",
        region: "TX",
        city: 4671654,
      }),
    );
  });

  test("turned off by the clan's leaders, the map says so", async () => {
    vi.spyOn(manageApi, "map").mockResolvedValue({
      ok: false,
      status: 409,
      data: { error: "social_off" },
    });
    vi.spyOn(api, "myPlace").mockResolvedValue({
      ok: true,
      status: 200,
      data: { place: null },
    });
    renderWithProviders(<ClanMap clan={clan} />);
    await screen.findByText(/turned its social features off/);
  });
});
