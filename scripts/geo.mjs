#!/usr/bin/env node
/**
 * The places a member can pick for the clan map (Social, 2026-09-26),
 * built from GeoNames (CC BY 4.0, https://www.geonames.org): countries,
 * their first-level regions (state, province) and every city of 5,000
 * people or more, each with its coordinates and time zone.
 *
 *   node scripts/geo.mjs <dir with countryInfo.txt, admin1CodesASCII.txt, cities5000.txt>
 *
 * Writes services/engine/geo/countries.json and one <CC>.json per country.
 * Host-run and committed, like the card snapshot elsewhere in the family:
 * the build never reaches GeoNames. A region's pin is the middle of its
 * cities (so a member who names only a region is never pinned to a city
 * they did not pick), its time zone its largest city's; a country's the
 * same over its cities.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = process.argv[2];
if (!src) {
  console.error("usage: node scripts/geo.mjs <geonames dump dir>");
  process.exit(1);
}
const out = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../services/engine/geo",
);
const rows = (file) =>
  readFileSync(path.join(src, file), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("\t"));
const round = (x) => Math.round(Number(x) * 100) / 100;

const countryName = new Map(rows("countryInfo.txt").map((r) => [r[0], r[4]]));
const regionName = new Map(
  rows("admin1CodesASCII.txt").map((r) => [r[0], r[1]]),
);

// geonameid, name, asciiname, alternates, lat, lng, class, code, country,
// cc2, admin1, admin2, admin3, admin4, population, elevation, dem, tz, date
const byCountry = new Map();
for (const r of rows("cities5000.txt")) {
  const cc = r[8];
  if (!countryName.has(cc)) continue;
  const city = {
    id: Number(r[0]),
    name: r[1],
    region: r[10] && regionName.has(`${cc}.${r[10]}`) ? r[10] : null,
    lat: round(r[4]),
    lng: round(r[5]),
    pop: Number(r[14]) || 0,
    tz: r[17],
  };
  if (!city.tz) continue;
  if (!byCountry.has(cc)) byCountry.set(cc, []);
  byCountry.get(cc).push(city);
}

/** The middle of some cities and the largest one's time zone. */
function centre(cities) {
  const lat = cities.reduce((s, c) => s + c.lat, 0) / cities.length;
  const lng = cities.reduce((s, c) => s + c.lng, 0) / cities.length;
  const largest = cities.reduce((a, c) => (c.pop > a.pop ? c : a));
  return { lat: round(lat), lng: round(lng), tz: largest.tz };
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const countries = [];
let cityCount = 0;
for (const [cc, cities] of [...byCountry].sort()) {
  const tzs = [...new Set(cities.map((c) => c.tz))].sort();
  const tzIndex = new Map(tzs.map((t, i) => [t, i]));
  const regions = [];
  const inRegion = new Map();
  for (const c of cities)
    if (c.region) {
      if (!inRegion.has(c.region)) inRegion.set(c.region, []);
      inRegion.get(c.region).push(c);
    }
  for (const [code, list] of inRegion) {
    const m = centre(list);
    regions.push([
      code,
      regionName.get(`${cc}.${code}`),
      m.lat,
      m.lng,
      tzIndex.get(m.tz),
    ]);
  }
  regions.sort((a, b) => a[1].localeCompare(b[1]));
  const listed = cities
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name) || b.pop - a.pop)
    .map((c) => [c.id, c.name, c.region, c.lat, c.lng, tzIndex.get(c.tz)]);
  cityCount += listed.length;
  writeFileSync(
    path.join(out, `${cc}.json`),
    JSON.stringify({ tz: tzs, regions, cities: listed }),
  );
  const m = centre(cities);
  countries.push([cc, countryName.get(cc), m.lat, m.lng, m.tz]);
}
countries.sort((a, b) => a[1].localeCompare(b[1]));
writeFileSync(
  path.join(out, "countries.json"),
  JSON.stringify({
    source:
      "GeoNames (https://www.geonames.org), CC BY 4.0: countryInfo, admin1CodesASCII, cities5000",
    countries,
  }),
);
console.log(`${countries.length} countries, ${cityCount} cities -> ${out}`);
