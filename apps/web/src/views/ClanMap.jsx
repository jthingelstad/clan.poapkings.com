import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "../api.js";
import { keys, useClanMap, useInvalidate, useMyPlace } from "../lib/queries.js";
import { geo, localTime, placeLabel } from "../lib/geo.js";
import { trackEvent } from "../analytics.js";

/**
 * The clan map (Social, Jamie 2026-09-26): where the clan plays from.
 * A member adds a place picked from the lists (a country, its region and,
 * if they like, a city: never an address, never the device's location)
 * and sees everyone else who has, with each one's local time. Only the
 * clan's signed-in members see it, and it stays in Elixir Clan.
 */
export function ClanMap({ clan }) {
  const { state } = useClanMap(clan.clan_tag);
  const now = useMinute();
  const d = state.data;
  if (state.forbidden || state.signedOut) return null;
  if (state.error === "social_off")
    return (
      <Page clan={clan}>
        <p className="page__lede">
          This clan&rsquo;s leaders have turned its social features off.
        </p>
      </Page>
    );
  if (state.error)
    return (
      <Page clan={clan}>
        <p className="page-head__note">
          Elixir Clan did not answer. Try again in a minute.
        </p>
      </Page>
    );
  if (!d) return <p className="page__lede">Reading…</p>;
  return (
    <Page clan={clan}>
      <p className="page__lede m-0">
        Where the clan plays from, and what time it is there. Add your city or
        region to appear; only signed-in members of {clan.name ?? clan.clan_tag}{" "}
        see this, and it stays here.
      </p>
      <YourPlace clan={clan} />
      {d.not_recorded ? (
        <p className="page-head__note">
          Elixir isn&rsquo;t recording this clan yet, so there is no roster to
          place.
        </p>
      ) : (
        <>
          <p className="page-head__note m-0">
            {d.on_map} of {d.members} members on the map
          </p>
          <MapView entries={d.entries} />
          <People entries={d.entries} now={now} />
          <p className="page-head__note m-0">{d.attribution}</p>
        </>
      )}
    </Page>
  );
}

function Page({ clan, children }) {
  return (
    <div className="grid gap-4">
      <div className="page-head">
        <h1 className="page__title">Clan map</h1>
        <span className="page-head__note">{clan.name ?? clan.clan_tag}</span>
      </div>
      {children}
    </div>
  );
}

/** The clock the local times read, ticking each minute. */
function useMinute() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** A token's color, for Leaflet's vector layers (they take values). */
const token = (name, fallback) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
  fallback;

function MapView({ entries }) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  useEffect(() => {
    map.current = L.map(el.current, { worldCopyJump: true }).setView(
      [20, 0],
      2,
    );
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 12,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => map.current.remove();
  }, []);
  useEffect(() => {
    if (!layer.current) return;
    layer.current.clearLayers();
    // One pin per place: members who picked the same one share it.
    const byPin = new Map();
    for (const e of entries) {
      const k = `${e.place.lat},${e.place.lng}`;
      if (!byPin.has(k)) byPin.set(k, []);
      byPin.get(k).push(e);
    }
    const accent = token("--color-accent", "#3b82f6");
    const deep = token("--color-accent-deep", "#1d4ed8");
    const gold = token("--color-gold", "#f5b301");
    for (const group of byPin.values()) {
      const { lat, lng, tz } = group[0].place;
      const you = group.some((e) => e.you);
      const pin = L.circleMarker([lat, lng], {
        radius: 7 + Math.min(group.length, 6) * 2,
        color: deep,
        weight: 2,
        fillColor: you ? gold : accent,
        fillOpacity: 0.85,
      });
      // Built when opened, so the local time is now's, and from text
      // nodes: names are the players', never markup.
      pin.bindPopup(() => {
        const box = document.createElement("div");
        const head = document.createElement("strong");
        head.textContent = `${placeLabel(group[0].place)} · ${localTime(tz).time}`;
        box.appendChild(head);
        for (const e of group) {
          const line = document.createElement("div");
          line.textContent = `${e.name ?? e.player_tag}${e.you ? " (you)" : ""}`;
          box.appendChild(line);
        }
        return box;
      });
      pin.addTo(layer.current);
    }
    if (entries.length)
      map.current.fitBounds(
        L.latLngBounds(entries.map((e) => [e.place.lat, e.place.lng])),
        { padding: [40, 40], maxZoom: 6 },
      );
  }, [entries]);
  return (
    <div
      ref={el}
      className="isolate h-[420px] rounded-panel border border-line"
      aria-label="Map of where the clan's members play from"
    />
  );
}

/** Everyone on the map, by country and place, with their local time. */
function People({ entries, now }) {
  const byCountry = useMemo(() => {
    const out = new Map();
    for (const e of [...entries].sort(
      (a, b) =>
        a.place.country_name.localeCompare(b.place.country_name) ||
        placeLabel(a.place).localeCompare(placeLabel(b.place)) ||
        String(a.name).localeCompare(String(b.name)),
    )) {
      if (!out.has(e.place.country_name)) out.set(e.place.country_name, []);
      out.get(e.place.country_name).push(e);
    }
    return [...out];
  }, [entries]);
  if (!entries.length)
    return (
      <p className="page-head__note m-0">
        Nobody has added a place yet. Be the first.
      </p>
    );
  return (
    <div className="panel">
      <div className="panel__body grid gap-3">
        {byCountry.map(([country, people]) => (
          <div key={country} className="grid gap-1">
            <span className="font-semibold">
              {country} · {people.length}
            </span>
            {people.map((e) => {
              const t = localTime(e.place.tz, now);
              return (
                <span key={e.player_tag} className="page-head__note">
                  {e.name ?? e.player_tag}
                  {e.you ? " (you)" : ""} · {e.role_label ?? e.role} ·{" "}
                  {[e.place.city_name, e.place.region_name]
                    .filter(Boolean)
                    .join(", ") || e.place.country_name}{" "}
                  · {t.time} ({t.away})
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Your place: picked from the lists, set or removed by you alone. */
function YourPlace({ clan }) {
  const { data } = useMyPlace();
  const invalidate = useInvalidate();
  const [editing, setEditing] = useState(false);
  const place = data?.place ?? null;
  const done = () => {
    invalidate(keys.place);
    invalidate(keys.map(clan.clan_tag));
    setEditing(false);
  };
  if (data === undefined) return null;
  if (place && !editing)
    return (
      <div className="panel">
        <div className="panel__body flex flex-wrap items-center gap-3">
          <span>
            You&rsquo;re on the map at <strong>{placeLabel(place)}</strong>
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => setEditing(true)}
          >
            Change
          </button>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              await api.clearMyPlace();
              trackEvent("clan.place_cleared");
              done();
            }}
          >
            Remove me
          </button>
        </div>
      </div>
    );
  return (
    <PlacePicker
      initial={place}
      onCancel={place ? () => setEditing(false) : null}
      onSaved={(saved) => {
        trackEvent("clan.place_set", saved.precision);
        done();
      }}
    />
  );
}

function PlacePicker({ initial, onCancel, onSaved }) {
  const [countries, setCountries] = useState([]);
  const [country, setCountry] = useState(initial?.country ?? "");
  const [data, setData] = useState(null);
  const [region, setRegion] = useState(initial?.region ?? "");
  const [city, setCity] = useState(initial?.city ? String(initial.city) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    geo.countries().then(setCountries);
  }, []);
  useEffect(() => {
    setData(null);
    if (country) geo.country(country).then(setData);
  }, [country]);
  const cities = useMemo(
    () =>
      (data?.cities ?? []).filter((c) =>
        data?.regions.length ? c.region === region : true,
      ),
    [data, region],
  );
  const needsRegion = Boolean(data?.regions.length);
  return (
    <form
      className="panel"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const r = await api.setMyPlace({
          country,
          region: needsRegion ? region : null,
          city: city ? Number(city) : null,
        });
        setBusy(false);
        if (!r.ok) return setError(r.data?.message ?? "That did not work.");
        onSaved(r.data.place);
      }}
    >
      <div className="panel__head">
        <span>{initial ? "Change your place" : "Add yourself to the map"}</span>
      </div>
      <div className="panel__body grid gap-2">
        <p className="page-head__note m-0">
          A city or just a region, from the list. It shows in every clan
          you&rsquo;re in, to its members only, and you can remove it any time.
        </p>
        <label className="field-label" htmlFor="place-country">
          Country
        </label>
        <select
          id="place-country"
          className="input"
          value={country}
          onChange={(e) => {
            setCountry(e.target.value);
            setRegion("");
            setCity("");
          }}
        >
          <option value="">Choose…</option>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
        {needsRegion ? (
          <>
            <label className="field-label" htmlFor="place-region">
              State or region
            </label>
            <select
              id="place-region"
              className="input"
              value={region}
              onChange={(e) => {
                setRegion(e.target.value);
                setCity("");
              }}
            >
              <option value="">Choose…</option>
              {data.regions.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {data && (!needsRegion || region) ? (
          <>
            <label className="field-label" htmlFor="place-city">
              City <span className="page-head__note">(optional)</span>
            </label>
            <select
              id="place-city"
              className="input"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            >
              <option value="">
                {needsRegion ? "Just the region" : "Just the country"}
              </option>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {error ? <p className="field-error">{error}</p> : null}
        <div className="flex gap-2">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={busy || !country || (needsRegion && !region)}
          >
            {initial ? "Save" : "Add me"}
          </button>
          {onCancel ? (
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
          ) : null}
        </div>
      </div>
    </form>
  );
}
