/**
 * Places for the clan map (Social, Jamie 2026-09-26): a country, its region
 * (state, province) and optionally a city, picked from GeoNames' lists
 * (`services/engine/geo`, built by scripts/geo.mjs), never typed and never
 * a location the device reports. A place resolves to where its pin goes and
 * its time zone: a city's own, a region's middle and its largest city's
 * zone, a country's the same.
 *
 * Pure: the data comes through the two loaders, so the browser can load a
 * country's file when it is picked and the API can read it from disk.
 */

const CODE = /^[A-Z]{2}$/;

export function createGeo({ loadCountries, loadCountry }) {
  let index = null;
  const cache = new Map();

  async function countries() {
    index ??= (await loadCountries()).countries.map(
      ([code, name, lat, lng, tz]) => ({ code, name, lat, lng, tz }),
    );
    return index;
  }

  /** One country's regions and cities (the regions empty where the data
   *  names none), with their pins and time zones. */
  async function country(code) {
    if (!CODE.test(String(code ?? ""))) return null;
    if (!(await countries()).some((c) => c.code === code)) return null;
    if (!cache.has(code)) {
      const raw = await loadCountry(code);
      cache.set(code, {
        regions: raw.regions.map(([rc, name, lat, lng, tz]) => ({
          code: rc,
          name,
          lat,
          lng,
          tz: raw.tz[tz],
        })),
        cities: raw.cities.map(([id, name, region, lat, lng, tz]) => ({
          id,
          name,
          region,
          lat,
          lng,
          tz: raw.tz[tz],
        })),
      });
    }
    return cache.get(code);
  }

  /**
   * A picked place, checked against the lists: `{ country, region, city }`
   * (codes and a GeoNames id). A country with regions needs one; the city
   * is optional and must be in that region. Returns the place as it is
   * shown and pinned, or `{ error, field }` in words a person can act on.
   */
  async function resolve(input) {
    const code = String(input?.country ?? "").toUpperCase();
    const c = (await countries()).find((x) => x.code === code);
    if (!c) return { error: "Pick a country from the list.", field: "country" };
    const data = await country(code);
    let region = null;
    if (data.regions.length) {
      region = data.regions.find((r) => r.code === String(input?.region ?? ""));
      if (!region)
        return {
          error: "Pick a state or region from the list.",
          field: "region",
        };
    }
    let city = null;
    if (
      input?.city !== undefined &&
      input?.city !== null &&
      input?.city !== ""
    ) {
      city = data.cities.find((x) => x.id === Number(input.city));
      if (!city || (region && city.region !== region.code))
        return {
          error: "Pick a city from the list, or leave it out.",
          field: "city",
        };
    }
    const pin = city ?? region ?? c;
    return {
      country: c.code,
      country_name: c.name,
      region: region?.code ?? null,
      region_name: region?.name ?? null,
      city: city?.id ?? null,
      city_name: city?.name ?? null,
      precision: city ? "city" : region ? "region" : "country",
      lat: pin.lat,
      lng: pin.lng,
      tz: pin.tz,
    };
  }

  return { countries, country, resolve };
}
