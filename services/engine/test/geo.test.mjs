/**
 * The clan map's place lists (scripts/geo.mjs, GeoNames): every country
 * file reads, every place has a pin and a time zone the browser can show,
 * and a picked place resolves the way the map draws it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGeo } from "../src/geo.mjs";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../geo");
const read = (name) =>
  JSON.parse(readFileSync(path.join(DIR, `${name}.json`), "utf8"));
const geo = createGeo({
  loadCountries: async () => read("countries"),
  loadCountry: async (code) => read(code),
});

test("every country file reads, with pins in range and time zones the browser knows", async () => {
  const countries = await geo.countries();
  assert.ok(countries.length > 200);
  const files = readdirSync(DIR).filter((f) => f !== "countries.json");
  assert.equal(files.length, countries.length);
  const zones = new Set();
  for (const c of countries) {
    const data = await geo.country(c.code);
    assert.ok(data.cities.length > 0, c.code);
    for (const p of [c, ...data.regions, ...data.cities]) {
      assert.ok(Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180, p.name);
      zones.add(p.tz);
    }
  }
  for (const tz of zones)
    assert.doesNotThrow(
      () => new Intl.DateTimeFormat("en", { timeZone: tz }),
      tz,
    );
});

test("a place resolves to its pin: the city's own, else the region's middle, never a city not picked", async () => {
  const city = await geo.resolve({
    country: "US",
    region: "TX",
    city: 4671654,
  });
  assert.equal(city.city_name, "Austin");
  assert.equal(city.tz, "America/Chicago");
  const region = await geo.resolve({ country: "us", region: "TX" });
  assert.equal(region.precision, "region");
  assert.equal(region.city, null);
  assert.notDeepEqual([region.lat, region.lng], [city.lat, city.lng]);
  assert.match(
    (await geo.resolve({ country: "US", region: "TX", city: 5128581 })).error,
    /city/,
  );
  assert.equal((await geo.resolve({ country: "US" })).field, "region");
  assert.equal((await geo.resolve({})).field, "country");
});
