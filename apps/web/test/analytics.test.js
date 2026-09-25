import { describe, expect, test } from "vitest";
import { analyticsLocation, routeLabel } from "../src/analytics.js";

describe("analytics", () => {
  test("pages collapse the clan and the item into attributes", () => {
    const o = "https://clan.poapkings.com";
    expect(analyticsLocation("/", o)).toEqual({ path: "/", url: `${o}/` });
    expect(analyticsLocation("/clan/2PQRJ8LV", o)).toEqual({
      path: "/clan",
      url: `${o}/clan?clan=%232PQRJ8LV`,
    });
    expect(analyticsLocation("/clan/2pqrj8lv/manage/board", o).url).toBe(
      `${o}/clan/manage/board?clan=%232PQRJ8LV`,
    );
    expect(analyticsLocation("/feedback/abc123", o).url).toBe(
      `${o}/feedback?id=abc123`,
    );
    expect(analyticsLocation("/maintain/feedback/abc123", o).url).toBe(
      `${o}/maintain/feedback?id=abc123`,
    );
    expect(analyticsLocation("/you/away", o).path).toBe("/you/away");
  });

  test("route labels match the server's own", () => {
    expect(routeLabel("GET", "/api/clans/2PQRJ8LV/manage?refresh=1")).toBe(
      "GET /api/clans/*/manage",
    );
    expect(routeLabel("POST", "/api/clans/2PQRJ8LV/cards/abc/decide")).toBe(
      "POST /api/clans/*/cards/*/decide",
    );
    expect(routeLabel("GET", "/api/feedback/abc")).toBe("GET /api/feedback/*");
  });
});
