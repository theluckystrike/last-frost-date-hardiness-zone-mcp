// Pure core for last-frost-date-hardiness-zone-mcp. The only I/O is keyless reads done through an injected fetchText.
//
// Sources (public, no key):
//   USDA Plant Hardiness Zone by ZIP code (2023 map), served as static JSON:  https://phzmapi.org/<zip>.json
//     fields zone ("6a"), temperature_range ("-10 to -5", average annual extreme minimum in F), coordinates {lat, lon}
//   Open-Meteo geocoding:            https://geocoding-api.open-meteo.com/v1/search?name=<place>
//   Open-Meteo historical weather:   https://archive-api.open-meteo.com/v1/archive  (ERA5 reanalysis, daily temperature_2m_min)
//   Open-Meteo forecast:             https://api.open-meteo.com/v1/forecast         (daily temperature_2m_min, up to 16 days)
//
// Frost dates are computed here from 30 complete seasons of modelled daily minimum 2 m air temperature.
// They are not NOAA station climate normals and can differ from a nearby station, most in valleys, on coasts and in mountains.
import type { FetchText } from './types.js';

export const REPO = 'last-frost-date-hardiness-zone-mcp';
export const SITE = 'https://www.mcpstamp.com';
export const UTM = `utm_source=mcp&utm_medium=${REPO}`;
export const more = () => `${SITE}/servers/?${UTM}`;

export const SOURCE_ZONE = 'USDA Plant Hardiness Zone Map (2023) by ZIP code, via phzmapi.org. Official map: planthardiness.ars.usda.gov.';
export const SOURCE_FROST = 'Computed from Open-Meteo historical weather (ERA5 reanalysis, daily minimum 2 m air temperature, 30 complete seasons). Modelled grid values, not NOAA station normals.';
export const SOURCE_FORECAST = 'Open-Meteo forecast API (daily minimum 2 m air temperature, national weather service models).';
export const SOURCE_PLANTING = 'Planting windows are common US extension-service rules of thumb (weeks before or after the median last spring frost and first fall frost), not variety-specific advice. Frost dates as in frost_dates.';

export class InputError extends Error {}
export class UpstreamError extends Error {}

const DAY = 86400000;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
export const cToF = (c: number) => r1(c * 9 / 5 + 32);
export const fToC = (f: number) => (f - 32) * 5 / 9;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}
export const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY);
export const monthDay = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
const weekday = (date: string) => WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];

// ---------- hardiness zone ----------

export interface Zone {
  zip: string; zone: string; zone_number: number; half: 'a' | 'b' | null;
  min_temp_range_f: string; min_temp_low_f: number | null; min_temp_high_f: number | null;
  min_temp_low_c: number | null; min_temp_high_c: number | null; latitude: number; longitude: number;
}

export function normalizeZip(zip: unknown): string {
  // A ZIP passed as a number loses its leading zeros (05401 -> 5401).
  const s = typeof zip === 'number' && Number.isInteger(zip) && zip > 0 && zip < 100000 ? String(zip).padStart(5, '0') : String(zip ?? '').trim();
  const m = /^(\d{5})(-\d{4})?$/.exec(s);
  if (!m) throw new InputError(`"${s}" is not a US ZIP code. Use 5 digits, for example 80202.`);
  return m[1];
}

export async function fetchZone(f: FetchText, zipIn: unknown): Promise<Zone> {
  const zip = normalizeZip(zipIn);
  let body: string;
  try {
    body = await f(`https://phzmapi.org/${zip}.json`, { cacheTtl: 86400 * 7, timeoutMs: 15000 });
  } catch (e) {
    if (/HTTP 404/.test((e as Error).message)) throw new InputError(`ZIP ${zip} is not in the USDA hardiness zone data (it may be a PO box or unused ZIP). Try a nearby residential ZIP.`);
    throw e;
  }
  let d: any;
  try { d = JSON.parse(body); } catch { throw new UpstreamError('phzmapi.org returned something that is not JSON'); }
  const zone = String(d?.zone ?? '').trim();
  const zm = /^(\d{1,2})([ab])?$/.exec(zone);
  if (!zm) throw new UpstreamError(`phzmapi.org returned no zone for ZIP ${zip}`);
  const range = String(d?.temperature_range ?? '').trim();
  const rm = /^(-?\d+(?:\.\d+)?)\s*to\s*(-?\d+(?:\.\d+)?)$/.exec(range);
  const lo = rm ? Number(rm[1]) : null;
  const hi = rm ? Number(rm[2]) : null;
  const lat = Number(d?.coordinates?.lat);
  const lon = Number(d?.coordinates?.lon);
  return {
    zip, zone, zone_number: Number(zm[1]), half: (zm[2] as 'a' | 'b' | undefined) ?? null,
    min_temp_range_f: range, min_temp_low_f: lo, min_temp_high_f: hi,
    min_temp_low_c: lo === null ? null : r1(fToC(lo)), min_temp_high_c: hi === null ? null : r1(fToC(hi)),
    latitude: lat, longitude: lon,
  };
}

export async function hardinessZone(f: FetchText, a: { zip?: unknown }, now = new Date()) {
  const z = await fetchZone(f, a.zip);
  const c = z.min_temp_low_c !== null && z.min_temp_high_c !== null ? ` (${z.min_temp_low_c} to ${z.min_temp_high_c} C)` : '';
  return {
    summary: `ZIP ${z.zip} is USDA plant hardiness zone ${z.zone} (2023 map): the average coldest winter night is ${z.min_temp_range_f} F${c}. ` +
      `Perennials, shrubs and trees rated for zone ${z.zone_number} or a lower number should survive the winter there.`,
    ...z,
    map: 'USDA Plant Hardiness Zone Map 2023 (30-year average of the coldest winter night, 1991-2020)',
    meaning: 'Each zone is a 10 F band of average annual extreme minimum temperature; a and b are 5 F halves (a is colder). Zones say nothing about frost dates or summer heat.',
    as_of: '2023 USDA map',
    source: SOURCE_ZONE,
    more: more(),
  };
}

// ---------- places ----------

export interface Place {
  name: string; latitude: number; longitude: number; zip: string | null; zone: Zone | null;
  admin1: string | null; country_code: string | null; matched_qualifier: boolean | null;
  /** Other geocoder matches when the name alone was ambiguous (no state or country given). */
  alternatives?: string[];
}

const STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico',
};
const COUNTRY_ALIASES: Record<string, string> = { usa: 'us', 'united states': 'us', uk: 'gb', 'united kingdom': 'gb', england: 'gb', scotland: 'gb', wales: 'gb' };

export interface PlaceInput { location?: unknown; latitude?: unknown; longitude?: unknown }

function checkLatLon(lat: number, lon: number) {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new InputError(`latitude ${lat} is out of range (-90 to 90).`);
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new InputError(`longitude ${lon} is out of range (-180 to 180).`);
}

export async function resolvePlace(f: FetchText, a: PlaceInput): Promise<Place> {
  if (a.latitude !== undefined && a.latitude !== null && a.longitude !== undefined && a.longitude !== null) {
    const lat = Number(a.latitude), lon = Number(a.longitude);
    checkLatLon(lat, lon);
    return { name: `${r4(lat)}, ${r4(lon)}`, latitude: lat, longitude: lon, zip: null, zone: null, admin1: null, country_code: null, matched_qualifier: null };
  }
  const loc = String(a.location ?? '').trim();
  if (!loc) throw new InputError('give a location: a US ZIP code, a place such as "Burlington, VT", or latitude and longitude.');
  if (/^\d{5}(-\d{4})?$/.test(loc)) {
    const zone = await fetchZone(f, loc);
    if (!Number.isFinite(zone.latitude) || !Number.isFinite(zone.longitude)) throw new UpstreamError(`no coordinates for ZIP ${zone.zip}`);
    return { name: `ZIP ${zone.zip}`, latitude: zone.latitude, longitude: zone.longitude, zip: zone.zip, zone, admin1: null, country_code: 'US', matched_qualifier: null };
  }
  const ll = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(loc);
  if (ll) {
    const lat = Number(ll[1]), lon = Number(ll[2]);
    checkLatLon(lat, lon);
    return { name: `${r4(lat)}, ${r4(lon)}`, latitude: lat, longitude: lon, zip: null, zone: null, admin1: null, country_code: null, matched_qualifier: null };
  }
  const parts = loc.split(',').map((s) => s.trim()).filter(Boolean);
  const name = parts[0];
  const quals = parts.slice(1).map((q) => q.toLowerCase());
  const body = await f(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=en&format=json`, { cacheTtl: 86400 * 7, timeoutMs: 15000 });
  let d: any;
  try { d = JSON.parse(body); } catch { throw new UpstreamError('the Open-Meteo geocoder returned something that is not JSON'); }
  const results: any[] = Array.isArray(d?.results) ? d.results : [];
  if (!results.length) throw new InputError(`no place called "${name}" was found. Try "City, State", a US ZIP code, or latitude and longitude.`);
  const matches = (r: any, q: string): boolean => {
    const admin = String(r.admin1 ?? '').toLowerCase();
    const country = String(r.country ?? '').toLowerCase();
    const cc = String(r.country_code ?? '').toLowerCase();
    const st = STATES[q.toUpperCase()];
    if (st && cc === 'us' && admin === st.toLowerCase()) return true;
    if (COUNTRY_ALIASES[q] && cc === COUNTRY_ALIASES[q]) return true;
    return q === admin || q === country || q === cc || (q.length > 3 && (admin.startsWith(q) || country.startsWith(q)));
  };
  let pick = results[0];
  let matched: boolean | null = null;
  if (quals.length) {
    const hit = results.find((r) => quals.every((q) => matches(r, q))) ?? results.find((r) => quals.some((q) => matches(r, q)));
    matched = Boolean(hit);
    if (hit) pick = hit;
  }
  const lat = Number(pick.latitude), lon = Number(pick.longitude);
  checkLatLon(lat, lon);
  const labelOf = (r: any) => [r.name, r.admin1, r.country_code].filter((x: unknown) => x).join(', ');
  const label = labelOf(pick);
  const alternatives = quals.length ? [] : results.filter((r) => r !== pick).slice(0, 4).map(labelOf);
  return {
    name: label, latitude: lat, longitude: lon, zip: null, zone: null, admin1: pick.admin1 ?? null, country_code: pick.country_code ?? null, matched_qualifier: matched,
    ...(alternatives.length ? { alternatives } : {}),
  };
}

// ---------- frost climatology ----------

export interface Daily { times: string[]; mins: (number | null)[]; timezone: string; grid_latitude: number; grid_longitude: number; elevation_m: number | null }

// Open-Meteo counts a request for more than 2 weeks of data as several API calls (about 800 for 31 years of one variable), so the
// 30-season record is read with a URL that changes only once a year (it ends on the last day of the last complete season) and with
// coordinates rounded to 0.05 degree (at most about 3 km, finer than the model grid), and is cached for 30 days. Only the current, incomplete season is read with a daily-changing URL.
export const NORMAL_SEASONS = 30;
export const ARCHIVE_LAG_DAYS = 2;
export const NORMALS_TTL = 86400 * 30;
const grid = (n: number) => Math.round(n * 20) / 20;

/** Last day of the last frost season complete on or before asOf: Dec 31 (northern) or Jul 14 (southern hemisphere). */
export function lastSeasonEnd(asOf: string, south: boolean): string {
  const y = Number(asOf.slice(0, 4));
  const md = south ? '07-14' : '12-31';
  return `${y}-${md}` <= asOf ? `${y}-${md}` : `${y - 1}-${md}`;
}

/** Date ranges of the two archive reads: the stable normals record and the current season so far (null when it has not started). */
export function archiveRanges(now: Date, south: boolean): { normals: [string, string]; recent: [string, string] | null } {
  const asOf = addDays(now.toISOString().slice(0, 10), -ARCHIVE_LAG_DAYS);
  const end = lastSeasonEnd(asOf, south);
  const start = `${Number(end.slice(0, 4)) - NORMAL_SEASONS}-07-01`;
  const rs = addDays(end, 1);
  return { normals: [start, end], recent: rs <= asOf ? [rs, asOf] : null };
}

export function archiveUrl(lat: number, lon: number, start: string, end: string): string {
  return `https://archive-api.open-meteo.com/v1/archive?latitude=${grid(lat)}&longitude=${grid(lon)}&start_date=${start}&end_date=${end}&daily=temperature_2m_min&timezone=auto`;
}

export function parseDaily(body: string, what: string): Daily {
  let d: any;
  try { d = JSON.parse(body); } catch { throw new UpstreamError(`${what} returned something that is not JSON`); }
  if (d?.error) throw new UpstreamError(`${what} answered with an error: ${String(d.reason ?? '').slice(0, 200)}`);
  const times = d?.daily?.time;
  const mins = d?.daily?.temperature_2m_min;
  if (!Array.isArray(times) || !Array.isArray(mins) || times.length !== mins.length || !times.length) throw new UpstreamError(`${what} returned no daily minimum temperatures`);
  const out: Daily = {
    times: times.map(String),
    mins: mins.map((v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)),
    timezone: String(d.timezone ?? 'GMT'),
    grid_latitude: Number(d.latitude), grid_longitude: Number(d.longitude),
    elevation_m: Number.isFinite(Number(d.elevation)) ? Number(d.elevation) : null,
  };
  // The newest days can still be empty; do not report data through a day that has none.
  while (out.times.length > 1 && out.mins[out.mins.length - 1] === null) { out.times.pop(); out.mins.pop(); }
  return out;
}

export async function fetchArchive(f: FetchText, p: Place, now: Date): Promise<Daily> {
  const south = p.latitude < 0;
  const r = archiveRanges(now, south);
  const what = 'the Open-Meteo historical weather API';
  const [nb, rb] = await Promise.all([
    f(archiveUrl(p.latitude, p.longitude, r.normals[0], r.normals[1]), { cacheTtl: NORMALS_TTL, timeoutMs: 30000 }),
    r.recent ? f(archiveUrl(p.latitude, p.longitude, r.recent[0], r.recent[1]), { cacheTtl: 21600, timeoutMs: 20000 }) : Promise.resolve(null),
  ]);
  const normals = parseDaily(nb, what);
  if (rb === null) return normals;
  // The current season is a bonus; when it fails the normals still answer.
  const recent = ((): Daily | null => { try { return parseDaily(rb, what); } catch { return null; } })();
  if (!recent) return normals;
  const last = normals.times[normals.times.length - 1];
  const keep = recent.times.map((t, i) => i).filter((i) => recent.times[i] > last);
  return { ...normals, times: normals.times.concat(keep.map((i) => recent.times[i])), mins: normals.mins.concat(keep.map((i) => recent.mins[i])) };
}

export interface Season {
  season: number; anchor: string; spring_start: string; fall_end: string;
  last_spring: string | null; first_fall: string | null; spring_complete: boolean; fall_complete: boolean;
}

/**
 * Splits the record into frost seasons around midsummer. Northern hemisphere: spring is Jan 1 to Jul 14 and fall is Jul 15 to Dec 31
 * of the same year. Southern hemisphere: season Y runs from Jul 15 of Y-1 (spring) through midsummer Jan 15 of Y to Jul 14 of Y (fall).
 */
export function seasons(daily: Pick<Daily, 'times' | 'mins'>, thresholdC: number, south: boolean): Season[] {
  const { times, mins } = daily;
  const first = times[0], last = times[times.length - 1];
  const frost: string[] = [];
  for (let i = 0; i < times.length; i++) { const v = mins[i]; if (v !== null && v <= thresholdC + 1e-9) frost.push(times[i]); }
  const out: Season[] = [];
  // A southern season is named for the year it ends in, so the season in progress after Jul 15 belongs to next year.
  for (let y = Number(first.slice(0, 4)); y <= Number(last.slice(0, 4)) + (south ? 1 : 0); y++) {
    const spring_start = south ? `${y - 1}-07-15` : `${y}-01-01`;
    const anchor = south ? `${y}-01-15` : `${y}-07-15`;
    const fall_end = south ? `${y}-07-14` : `${y}-12-31`;
    let ls: string | null = null, ff: string | null = null;
    for (const t of frost) {
      if (t >= spring_start && t < anchor) ls = t;
      else if (t >= anchor && t <= fall_end && ff === null) ff = t;
    }
    out.push({
      season: y, anchor, spring_start, fall_end, last_spring: ls, first_fall: ff,
      spring_complete: first <= spring_start && last >= addDays(anchor, -1),
      fall_complete: first <= anchor && last >= fall_end,
    });
  }
  return out;
}

/** Nearest-rank quantile of an ascending list (q=0.5 of 30 values is the 15th). */
export function nearestRank(sorted: number[], q: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i];
}

export interface FrostStats {
  threshold_f: number; seasons_counted: number; first_season: number; last_season: number; south: boolean;
  spring: { median: number | null; one_in_ten: number | null; later_than_one_in_ten: number; no_frost: number; earliest: string | null; latest: string | null };
  fall: { median: number | null; one_in_ten: number | null; earlier_than_one_in_ten: number; no_frost: number; earliest: string | null; latest: string | null };
  growing_season_days_median: number;
  recent: Season[];
}

export function frostStats(daily: Pick<Daily, 'times' | 'mins'>, thresholdF: number, south: boolean, years = 30): FrostStats {
  const all = seasons(daily, fToC(thresholdF), south);
  const done = all.filter((s) => s.spring_complete && s.fall_complete).slice(-years);
  if (done.length < 10) throw new UpstreamError(`only ${done.length} complete seasons of data; at least 10 are needed`);
  const sp = done.map((s) => (s.last_spring ? dayDiff(s.last_spring, s.anchor) : -Infinity)).sort((a, b) => a - b);
  const fa = done.map((s) => (s.first_fall ? dayDiff(s.first_fall, s.anchor) : Infinity)).sort((a, b) => a - b);
  const lens = done.map((s) => {
    const a = s.last_spring ? dayDiff(s.last_spring, s.anchor) : dayDiff(s.spring_start, s.anchor) - 1;
    const b = s.first_fall ? dayDiff(s.first_fall, s.anchor) : dayDiff(s.fall_end, s.anchor) + 1;
    return b - a - 1;
  }).sort((a, b) => a - b);
  const fin = (n: number) => (Number.isFinite(n) ? n : null);
  const spMed = nearestRank(sp, 0.5), sp90 = nearestRank(sp, 0.9);
  // 1 year in 10: the date with 10% of seasons strictly beyond it, the same rule for spring (later) and fall (earlier).
  const faMed = nearestRank(fa, 0.5), fa10 = fa[Math.min(fa.length - 1, Math.ceil(0.1 * fa.length))];
  const byOffset = (key: 'last_spring' | 'first_fall', pickMax: boolean): string | null => {
    let best: string | null = null, bestOff = 0;
    for (const s of done) {
      const d = s[key];
      if (!d) continue;
      const o = dayDiff(d, s.anchor);
      if (best === null || (pickMax ? o > bestOff : o < bestOff)) { best = d; bestOff = o; }
    }
    return best;
  };
  return {
    threshold_f: thresholdF, seasons_counted: done.length, first_season: done[0].season, last_season: done[done.length - 1].season, south,
    spring: {
      median: fin(spMed), one_in_ten: fin(sp90), later_than_one_in_ten: sp.filter((x) => x > sp90).length,
      no_frost: sp.filter((x) => x === -Infinity).length, earliest: byOffset('last_spring', false), latest: byOffset('last_spring', true),
    },
    fall: {
      median: fin(faMed), one_in_ten: fin(fa10), earlier_than_one_in_ten: fa.filter((x) => x < fa10).length,
      no_frost: fa.filter((x) => x === Infinity).length, earliest: byOffset('first_fall', false), latest: byOffset('first_fall', true),
    },
    growing_season_days_median: nearestRank(lens, 0.5),
    recent: all.filter((s) => s.spring_start <= daily.times[daily.times.length - 1]).slice(-2),
  };
}

/** Turns a day offset from midsummer into a calendar date in a reference year (no leap day), returned as "MM-DD". */
export function offsetToMmdd(offset: number, south: boolean): string {
  return addDays(south ? '2026-01-15' : '2025-07-15', offset).slice(5);
}
export const mmddText = (mmdd: string) => `${MONTHS[Number(mmdd.slice(0, 2)) - 1]} ${Number(mmdd.slice(3, 5))}`;
const offText = (o: number | null, south: boolean) => (o === null ? null : mmddText(offsetToMmdd(o, south)));

export const THRESHOLDS = [36, 32, 28] as const;
export function thresholdOf(t: unknown): number {
  if (t === undefined || t === null) return 32;
  const n = Number(t);
  if (!(THRESHOLDS as readonly number[]).includes(n)) throw new InputError(`threshold_f must be 36, 32 or 28 (got ${t}).`);
  return n;
}

function placeOut(p: Place, d: Daily) {
  return {
    name: p.name, latitude: p.latitude, longitude: p.longitude, zip: p.zip, timezone: d.timezone,
    grid_latitude: d.grid_latitude, grid_longitude: d.grid_longitude, grid_elevation_m: d.elevation_m,
    ...(p.matched_qualifier === false ? { warning: 'The state or country you gave did not match any geocoder result; this is the best name match. Pass a ZIP code or latitude and longitude to be sure.' } : {}),
    ...(p.alternatives?.length ? { other_places_with_this_name: p.alternatives, hint: 'Add a state or country ("Burlington, VT") or pass a ZIP code if this is the wrong place.' } : {}),
  };
}

const zoneOut = (z: Zone | null) => (z ? { zone: z.zone, min_temp_range_f: z.min_temp_range_f } : null);

export async function frostDates(f: FetchText, a: PlaceInput & { threshold_f?: unknown }, now = new Date()) {
  const th = thresholdOf(a.threshold_f);
  const p = await resolvePlace(f, a);
  const daily = await fetchArchive(f, p, now);
  const south = p.latitude < 0;
  const s = frostStats(daily, th, south);
  const dataThrough = daily.times[daily.times.length - 1];
  const period = `${s.first_season}-${s.last_season}`;
  const n = s.seasons_counted;
  const spMed = offText(s.spring.median, south), sp90 = offText(s.spring.one_in_ten, south);
  const faMed = offText(s.fall.median, south), fa10 = offText(s.fall.one_in_ten, south);
  const recent = s.recent.map((r) => ({
    season: south ? `${r.season - 1}-${r.season}` : String(r.season),
    last_spring_frost: r.last_spring ?? (r.spring_complete ? 'none' : `none through ${dataThrough}`),
    first_fall_frost: r.first_fall ?? (r.fall_complete ? 'none' : `none yet through ${dataThrough}`),
  }));
  let headline: string;
  if (s.spring.no_frost === n && s.fall.no_frost === n) {
    headline = `No night at or below ${th} F in any of the ${n} seasons ${period}: frost-free at this threshold.`;
  } else if (spMed === null || faMed === null) {
    headline = `Frost at or below ${th} F is uncommon: no spring frost in ${s.spring.no_frost} and no fall frost in ${s.fall.no_frost} of ${n} seasons (${period}), so a median frost date does not exist.` +
      (sp90 ? ` In 1 year in 10 the last spring frost is later than ${sp90}.` : '') + (fa10 ? ` In 1 year in 10 the first fall frost comes before ${fa10}.` : '');
  } else {
    headline = `Median last spring frost (${th} F) ${spMed}; 1 year in 10 later than ${sp90}. Median first fall frost ${faMed}; 1 year in 10 earlier than ${fa10}. ` +
      `Median growing season ${s.growing_season_days_median} days (${n} seasons, ${period}).`;
  }
  const last = recent[recent.length - 1];
  const summary = `${p.name}${p.zone ? ` (USDA zone ${p.zone.zone})` : ''}: ${headline}` +
    (last ? ` Season ${last.season}: last spring frost ${last.last_spring_frost}, first fall frost ${last.first_fall_frost}.` : '');
  return {
    summary,
    place: placeOut(p, daily),
    hardiness_zone: zoneOut(p.zone),
    threshold_f: th, threshold_c: r1(fToC(th)),
    hemisphere: south ? 'southern' : 'northern',
    normals_period: period, seasons_counted: n,
    last_spring_frost: {
      median: spMed, median_mmdd: s.spring.median === null ? null : offsetToMmdd(s.spring.median, south),
      one_in_ten_years_later_than: sp90, seasons_later_than_that: s.spring.later_than_one_in_ten,
      seasons_with_no_spring_frost: s.spring.no_frost, earliest_on_record: s.spring.earliest, latest_on_record: s.spring.latest,
    },
    first_fall_frost: {
      median: faMed, median_mmdd: s.fall.median === null ? null : offsetToMmdd(s.fall.median, south),
      one_in_ten_years_earlier_than: fa10, seasons_earlier_than_that: s.fall.earlier_than_one_in_ten,
      seasons_with_no_fall_frost: s.fall.no_frost, earliest_on_record: s.fall.earliest, latest_on_record: s.fall.latest,
    },
    growing_season_days_median: s.growing_season_days_median,
    recent_seasons: recent,
    method: `A frost day is a day whose modelled minimum 2 m air temperature is at or below ${th} F. Median and 1-in-10 dates are nearest-rank quantiles over the ${n} most recent complete seasons. ` +
      'Plants can frost at 33 to 36 F air temperature on clear calm nights; use threshold_f 36 for tender plants and 28 for a hard freeze.',
    as_of: dataThrough,
    source: SOURCE_FROST,
    more: more(),
  };
}

// ---------- frost forecast ----------

export function forecastUrl(lat: number, lon: number, days: number): string {
  return `https://api.open-meteo.com/v1/forecast?latitude=${r4(lat)}&longitude=${r4(lon)}&daily=temperature_2m_min&forecast_days=${days}&timezone=auto`;
}

export function frostCategory(lowF: number): string {
  if (lowF <= 24) return 'hard freeze';
  if (lowF <= 28) return 'freeze';
  if (lowF <= 32) return 'frost or light freeze';
  return 'frost possible on clear calm nights';
}

export async function frostForecast(f: FetchText, a: PlaceInput & { days?: unknown }, now = new Date()) {
  const days = a.days === undefined || a.days === null ? 16 : Number(a.days);
  if (!Number.isInteger(days) || days < 1 || days > 16) throw new InputError('days must be a whole number from 1 to 16.');
  const p = await resolvePlace(f, a);
  const d = parseDaily(await f(forecastUrl(p.latitude, p.longitude, days), { cacheTtl: 1800, timeoutMs: 15000 }), 'the Open-Meteo forecast API');
  const all = d.times.map((t, i) => ({ date: t, mins: d.mins[i] })).filter((x): x is { date: string; mins: number } => x.mins !== null)
    .map((x) => ({ date: x.date, weekday: weekday(x.date), low_f: cToF(x.mins), low_c: r1(x.mins) }));
  if (!all.length) throw new UpstreamError('the forecast had no daily minimum temperatures');
  const cold = all.filter((x) => x.low_f <= 36).map((x) => ({ ...x, category: frostCategory(x.low_f) }));
  const freeze = cold.filter((x) => x.low_f <= 32);
  const lowest = all.reduce((m, x) => (x.low_f < m.low_f ? x : m), all[0]);
  const fmt = (x: { date: string; weekday: string; low_f: number }) => `${x.weekday.slice(0, 3)} ${x.date} ${x.low_f} F`;
  let summary: string;
  if (!cold.length) summary = `${p.name}: no night at or below 36 F in the next ${all.length} days (${all[0].date} to ${all[all.length - 1].date}); lowest ${fmt(lowest)}.`;
  else {
    summary = `${p.name}, next ${all.length} days: ${freeze.length} night${freeze.length === 1 ? '' : 's'} at or below 32 F and ${cold.length - freeze.length} more between 32 and 36 F. ` +
      (freeze.length ? `First at or below 32 F: ${fmt(freeze[0])}. ` : `First frost-risk night: ${fmt(cold[0])}. `) + `Lowest: ${fmt(lowest)}. ` +
      `Cold nights: ${cold.slice(0, 8).map(fmt).join('; ')}${cold.length > 8 ? '; ...' : ''}.`;
  }
  return {
    summary,
    place: placeOut(p, d),
    days: all.length,
    nights_at_or_below_32f: freeze.length,
    nights_at_or_below_36f: cold.length,
    first_freeze: freeze[0] ?? null,
    lowest,
    cold_nights: cold,
    forecast: all,
    note: 'Each value is the forecast minimum for that local calendar day, usually just before sunrise. Forecasts beyond 7 days are uncertain.',
    as_of: now.toISOString(),
    source: SOURCE_FORECAST,
    more: more(),
  };
}

// ---------- planting calendar ----------

type Win = [number, number];
export interface Crop {
  id: string; name: string; aliases: string[]; type: 'warm' | 'cool';
  /** Offsets in days from the median last spring frost. */
  indoors?: Win; transplant?: Win; direct?: Win;
  /** Offsets in days from the median first fall frost. */
  fall?: Win; fallVerb?: string;
  days_to_maturity: number | null; note?: string;
}

export const CROPS: Crop[] = [
  { id: 'tomato', name: 'Tomato', aliases: ['tomatoes'], type: 'warm', indoors: [-56, -42], transplant: [7, 21], days_to_maturity: 75 },
  { id: 'pepper', name: 'Pepper', aliases: ['peppers', 'bell pepper', 'chili', 'chile', 'hot pepper'], type: 'warm', indoors: [-70, -56], transplant: [14, 28], days_to_maturity: 75 },
  { id: 'eggplant', name: 'Eggplant', aliases: ['eggplants', 'aubergine'], type: 'warm', indoors: [-63, -56], transplant: [14, 28], days_to_maturity: 80 },
  { id: 'cucumber', name: 'Cucumber', aliases: ['cucumbers'], type: 'warm', indoors: [-28, -21], direct: [7, 21], days_to_maturity: 60 },
  { id: 'zucchini', name: 'Zucchini and summer squash', aliases: ['summer squash', 'squash', 'courgette'], type: 'warm', direct: [7, 21], days_to_maturity: 55 },
  { id: 'pumpkin', name: 'Pumpkin and winter squash', aliases: ['pumpkins', 'winter squash', 'butternut'], type: 'warm', direct: [7, 21], days_to_maturity: 100 },
  { id: 'watermelon', name: 'Watermelon and melons', aliases: ['watermelons', 'melon', 'melons', 'cantaloupe'], type: 'warm', indoors: [-28, -21], transplant: [14, 21], days_to_maturity: 85 },
  { id: 'corn', name: 'Sweet corn', aliases: ['sweet corn', 'maize'], type: 'warm', direct: [7, 21], days_to_maturity: 75 },
  { id: 'beans', name: 'Green beans', aliases: ['bean', 'green beans', 'bush beans', 'pole beans'], type: 'warm', direct: [7, 21], days_to_maturity: 55 },
  { id: 'basil', name: 'Basil', aliases: [], type: 'warm', indoors: [-42, -28], transplant: [7, 14], days_to_maturity: 60 },
  { id: 'lettuce', name: 'Lettuce', aliases: ['salad greens', 'greens'], type: 'cool', indoors: [-42, -28], direct: [-28, -14], fall: [-56, -42], fallVerb: 'sow for a fall crop', days_to_maturity: 45 },
  { id: 'spinach', name: 'Spinach', aliases: [], type: 'cool', direct: [-42, -28], fall: [-56, -42], fallVerb: 'sow for a fall crop', days_to_maturity: 40 },
  { id: 'peas', name: 'Peas', aliases: ['pea', 'snap peas', 'snow peas'], type: 'cool', direct: [-42, -28], days_to_maturity: 60 },
  { id: 'radish', name: 'Radish', aliases: ['radishes'], type: 'cool', direct: [-28, -7], fall: [-42, -28], fallVerb: 'sow for a fall crop', days_to_maturity: 25 },
  { id: 'carrot', name: 'Carrot', aliases: ['carrots'], type: 'cool', direct: [-21, 0], fall: [-84, -70], fallVerb: 'sow for a fall crop', days_to_maturity: 70 },
  { id: 'beet', name: 'Beet', aliases: ['beets', 'beetroot'], type: 'cool', direct: [-28, -7], fall: [-70, -56], fallVerb: 'sow for a fall crop', days_to_maturity: 55 },
  { id: 'broccoli', name: 'Broccoli', aliases: [], type: 'cool', indoors: [-56, -42], transplant: [-14, 0], fall: [-98, -84], fallVerb: 'sow for a fall crop', days_to_maturity: 70 },
  { id: 'cabbage', name: 'Cabbage', aliases: [], type: 'cool', indoors: [-56, -42], transplant: [-21, -7], days_to_maturity: 75 },
  { id: 'kale', name: 'Kale', aliases: ['collards', 'collard greens'], type: 'cool', indoors: [-56, -42], transplant: [-28, -14], fall: [-70, -56], fallVerb: 'sow for a fall crop', days_to_maturity: 55 },
  { id: 'onion', name: 'Onion', aliases: ['onions'], type: 'cool', indoors: [-84, -70], transplant: [-28, -14], days_to_maturity: 100, note: 'Transplant window also fits onion sets.' },
  { id: 'potato', name: 'Potato', aliases: ['potatoes'], type: 'cool', direct: [-21, -7], days_to_maturity: 90, note: 'Direct window is for planting seed potatoes.' },
  { id: 'cilantro', name: 'Cilantro', aliases: ['coriander'], type: 'cool', direct: [-14, 0], fall: [-56, -42], fallVerb: 'sow for a fall crop', days_to_maturity: 50 },
  { id: 'garlic', name: 'Garlic', aliases: [], type: 'cool', fall: [-42, -14], fallVerb: 'plant cloves (harvest next summer)', days_to_maturity: null, note: 'Planted in fall and harvested the next summer.' },
];

export function findCrops(names: unknown): Crop[] {
  if (names === undefined || names === null || (Array.isArray(names) && names.length === 0)) return CROPS;
  const list = Array.isArray(names) ? names : String(names).split(',');
  const out: Crop[] = [];
  const unknown: string[] = [];
  for (const raw of list) {
    const q = String(raw).trim().toLowerCase();
    if (!q) continue;
    const c = CROPS.find((x) => x.id === q || x.name.toLowerCase() === q || x.aliases.includes(q)) ??
      CROPS.find((x) => x.id === q.replace(/e?s$/, '') || x.aliases.includes(q.replace(/e?s$/, '')));
    if (c) { if (!out.includes(c)) out.push(c); } else unknown.push(String(raw).trim());
  }
  if (unknown.length) throw new InputError(`no planting rule for: ${unknown.join(', ')}. Known crops: ${CROPS.map((c) => c.id).join(', ')}.`);
  return out;
}

export async function plantingCalendar(f: FetchText, a: PlaceInput & { crops?: unknown }, now = new Date()) {
  const crops = findCrops(a.crops);
  const p = await resolvePlace(f, a);
  const daily = await fetchArchive(f, p, now);
  const south = p.latitude < 0;
  const s = frostStats(daily, 32, south);
  const lf = s.spring.median, ff = s.fall.median;
  const period = `${s.first_season}-${s.last_season}`;
  const win = (base: number | null, w: Win | undefined) => {
    if (!w || base === null) return null;
    const from = offsetToMmdd(base + w[0], south), to = offsetToMmdd(base + w[1], south);
    return { from: mmddText(from), to: mmddText(to), from_mmdd: from, to_mmdd: to };
  };
  const rows = crops.map((c) => {
    const start = c.transplant ? c.transplant[0] : c.direct ? c.direct[0] : null;
    const fits = c.type === 'warm' && lf !== null && ff !== null && start !== null && c.days_to_maturity !== null
      ? lf + start + c.days_to_maturity <= ff : null;
    return {
      crop: c.name, id: c.id, season: c.type === 'warm' ? 'warm season (after frost)' : 'cool season (tolerates light frost)',
      sow_indoors: win(lf, c.indoors), transplant_outdoors: win(lf, c.transplant), direct_sow: win(lf, c.direct),
      fall: c.fall && ff !== null ? { ...(win(ff, c.fall) as NonNullable<ReturnType<typeof win>>), what: c.fallVerb ?? 'sow' } : null,
      days_to_maturity: c.days_to_maturity,
      fits_frost_free_season: fits,
      ...(c.note ? { note: c.note } : {}),
      ...(fits === false ? { warning: `About ${c.days_to_maturity} days to harvest may not fit before the median first fall frost; choose a short-season variety or start indoors.` } : {}),
    };
  });
  const lfText = lf === null ? null : mmddText(offsetToMmdd(lf, south));
  const ffText = ff === null ? null : mmddText(offsetToMmdd(ff, south));
  let summary: string;
  if (lf === null) {
    summary = `${p.name}: frost at or below 32 F is rare (no spring frost in ${s.spring.no_frost} of ${s.seasons_counted} seasons, ${period}), so frost-based planting dates do not apply. ` +
      'Grow cool-season crops in the coolest months and warm-season crops when nights stay above about 50 F; heat, not frost, sets the calendar there.';
  } else {
    const pick = rows.slice(0, 4).map((r) => {
      const w = r.sow_indoors ? `start indoors ${r.sow_indoors.from} to ${r.sow_indoors.to}` : r.direct_sow ? `sow ${r.direct_sow.from} to ${r.direct_sow.to}` : r.fall ? `${r.fall.what} ${r.fall.from} to ${r.fall.to}` : '';
      const t = r.transplant_outdoors ? `, plant out ${r.transplant_outdoors.from} to ${r.transplant_outdoors.to}` : '';
      return `${r.crop}: ${w}${t}`;
    });
    summary = `${p.name}: median last spring frost ${lfText}${ffText ? `, first fall frost ${ffText}` : ''} (32 F, ${period}). ${pick.join('. ')}.` +
      (rows.length > 4 ? ` ${rows.length - 4} more crops in the table.` : '');
  }
  return {
    summary,
    place: placeOut(p, daily),
    hardiness_zone: zoneOut(p.zone),
    last_spring_frost_median: lfText, first_fall_frost_median: ffText,
    one_in_ten_years_last_frost_later_than: s.spring.one_in_ten === null ? null : mmddText(offsetToMmdd(s.spring.one_in_ten, south)),
    growing_season_days_median: s.growing_season_days_median,
    normals_period: period,
    crops: rows,
    note: 'Windows are counted from the median frost date, so in half of all years the last frost comes later. Protect tender transplants if a frost is forecast (see frost_forecast).',
    as_of: daily.times[daily.times.length - 1],
    source: SOURCE_PLANTING,
    more: more(),
  };
}
