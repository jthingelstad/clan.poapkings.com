/**
 * The place lists on the API side (`createGeo`, the engine's): read from
 * disk, one country's file when a place in it is checked. In the Lambda
 * the files sit beside the bundle (`geo/`, copied by infra/scripts/
 * build.mjs); from source they are the engine's.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGeo } from "@elixir-clan/engine";

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = [path.join(here, "geo"), path.join(here, "../../engine/geo")].find(
  (d) => existsSync(path.join(d, "countries.json")),
);

const read = (name) =>
  JSON.parse(readFileSync(path.join(DIR, `${name}.json`), "utf8"));

export function diskGeo() {
  if (!DIR)
    throw new Error("geo data not found beside the bundle or the engine");
  return createGeo({
    loadCountries: async () => read("countries"),
    loadCountry: async (code) => read(code),
  });
}
