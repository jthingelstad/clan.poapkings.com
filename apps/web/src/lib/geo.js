/** The place lists in the browser: the engine's `createGeo`, loading the
 *  country index when the map opens and one country's file when a place
 *  in it is picked (Vite splits each into its own chunk). */
import { createGeo } from "@elixir-clan/engine";

export const geo = createGeo({
  loadCountries: () =>
    import("../../../../services/engine/geo/countries.json").then(
      (m) => m.default,
    ),
  loadCountry: (code) =>
    import(`../../../../services/engine/geo/${code}.json`).then(
      (m) => m.default,
    ),
});

/** The local time at a place, "3:12 PM", and how far that is from the
 *  reader's own clock ("2 h ahead"), from the IANA zone alone. */
export function localTime(tz, at = new Date()) {
  const time = new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
  const offset = (zone) => {
    const name =
      new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        timeZoneName: "longOffset",
      })
        .formatToParts(at)
        .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
    return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  };
  const diff = offset(tz) + at.getTimezoneOffset();
  const hours = Math.round((diff / 60) * 2) / 2;
  const away =
    hours === 0
      ? "your time"
      : `${Math.abs(hours)} h ${hours > 0 ? "ahead" : "behind"}`;
  return { time, away };
}

/** A place in words, most specific first. */
export const placeLabel = (p) =>
  [p.city_name, p.region_name, p.country_name].filter(Boolean).join(", ");
