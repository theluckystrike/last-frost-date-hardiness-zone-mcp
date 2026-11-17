// Fixtures in test/fixtures/ were downloaded on 2026-11-17: phzmapi.org/80202.json (zone 6a, -10 to -5 F), the Open-Meteo geocoder answer
// for "Burlington" (10 results, Ontario first, Vermont second), the Open-Meteo archive of daily minimum temperature at 39.7516,-104.997
// (Denver) from 1995-07-01 to 2026-11-10, and the 16-day forecast for the same point from 2026-11-16.
// Expected frost values were computed independently in Python from the archive file (~/last-frost-work/expect.py): at 32 F over the
// 30 seasons 1996-2025 the median last spring frost is May 5 (1 in 10 later than May 20, 3 seasons later), the median first fall frost
// Oct 14 (1 in 10 earlier than Sep 28, 3 seasons earlier), median growing season 160 days; 28 F gives Apr 29 and Oct 23, 36 F May 14 and Oct 7.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import {
  normalizeZip, thresholdOf, lastSeasonEnd, archiveRanges, archiveUrl, frostStats, findCrops, resolvePlace, parseDaily,
  hardinessZone, frostDates, frostForecast, plantingCalendar, InputError, UpstreamError, UTM,
} from '../dist/core.js';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const ARCHIVE = JSON.parse(fx('archive-80202.json'));
const sliceArchive = (src, start, end) => {
  const idx = src.daily.time.map((t, i) => i).filter((i) => src.daily.time[i] >= start && src.daily.time[i] <= end);
  return JSON.stringify({ ...src, daily: { time: idx.map((i) => src.daily.time[i]), temperature_2m_min: idx.map((i) => src.daily.temperature_2m_min[i]) } });
};
const ARCH_RE = /^https:\/\/archive-api\.open-meteo\.com\/v1\/archive\?latitude=(-?[\d.]+)&longitude=(-?[\d.]+)&start_date=(\d{4}-\d{2}-\d{2})&end_date=(\d{4}-\d{2}-\d{2})&daily=temperature_2m_min&timezone=auto$/;
const stub = (archive) => {
  const seen = [];
  const f = async (u) => {
    seen.push(u);
    if (u === 'https://phzmapi.org/80202.json') return fx('phz-80202.json');
    if (u.startsWith('https://phzmapi.org/')) throw new Error('HTTP 404');
    if (u.startsWith('https://geocoding-api.open-meteo.com/v1/search?name=Burlington&')) return fx('geo-burlington.json');
    const m = ARCH_RE.exec(u);
    if (m) return sliceArchive(archive, m[3], m[4]);
    const fc = /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=[-\d.]+&longitude=[-\d.]+&daily=temperature_2m_min&forecast_days=(\d+)&timezone=auto$/.exec(u);
    if (fc) {
      const d = JSON.parse(fx('forecast-80202.json')); const n = Number(fc[1]);
      return JSON.stringify({ ...d, daily: { time: d.daily.time.slice(0, n), temperature_2m_min: d.daily.temperature_2m_min.slice(0, n) } });
    }
    throw new Error(`HTTP 404 (no fixture for ${u})`);
  };
  return { f, seen };
};
const NOW = new Date('2026-11-17T15:00:00Z');

// Southern hemisphere series: 10 C every day except a frost on May 20 (first fall frost) and Sep 30 (last spring frost) of each year.
const southSeries = (() => {
  const time = [], temperature_2m_min = [];
  for (let t = Date.parse('1996-07-01T00:00:00Z'); t <= Date.parse('2026-11-10T00:00:00Z'); t += 86400000) {
    const d = new Date(t).toISOString().slice(0, 10);
    time.push(d); temperature_2m_min.push(d.endsWith('-05-20') || d.endsWith('-09-30') ? -1 : 10);
  }
  return { latitude: -35.3, longitude: 149.1, timezone: 'Australia/Sydney', elevation: 580, daily: { time, temperature_2m_min } };
})();

test('ZIPs, thresholds and the archive ranges: the normals URL changes once a year', () => {
  assert.equal(normalizeZip('80202'), '80202'); assert.equal(normalizeZip('05401-1234'), '05401'); assert.equal(normalizeZip(5401), '05401');
  assert.throws(() => normalizeZip('8020'), InputError); assert.throws(() => normalizeZip('Denver'), InputError);
  assert.equal(thresholdOf(undefined), 32); assert.equal(thresholdOf(28), 28); assert.throws(() => thresholdOf(30), InputError);
  assert.equal(lastSeasonEnd('2026-11-15', false), '2025-12-31'); assert.equal(lastSeasonEnd('2026-12-31', false), '2026-12-31');
  assert.equal(lastSeasonEnd('2026-11-15', true), '2026-07-14'); assert.equal(lastSeasonEnd('2026-07-13', true), '2025-07-14');
  assert.deepEqual(archiveRanges(NOW, false), { normals: ['1995-07-01', '2025-12-31'], recent: ['2026-01-01', '2026-11-15'] });
  assert.deepEqual(archiveRanges(NOW, true), { normals: ['1996-07-01', '2026-07-14'], recent: ['2026-07-15', '2026-11-15'] });
  assert.deepEqual(archiveRanges(new Date('2026-12-20T00:00:00Z'), false).normals, ['1995-07-01', '2025-12-31']);
  assert.deepEqual(archiveRanges(new Date('2027-01-05T00:00:00Z'), false).normals, ['1996-07-01', '2026-12-31']);
  assert.equal(archiveRanges(new Date('2027-01-02T00:00:00Z'), false).recent, null);
  assert.equal(archiveUrl(39.751586, -104.99699, '1995-07-01', '2025-12-31'),
    'https://archive-api.open-meteo.com/v1/archive?latitude=39.75&longitude=-105&start_date=1995-07-01&end_date=2025-12-31&daily=temperature_2m_min&timezone=auto');
});

test('hardiness zone for ZIP 80202 is 6a; unknown ZIP is an input error', async () => {
  const { f } = stub(ARCHIVE);
  const r = await hardinessZone(f, { zip: '80202' });
  assert.equal(r.zone, '6a'); assert.equal(r.zone_number, 6); assert.equal(r.half, 'a');
  assert.equal(r.min_temp_low_f, -10); assert.equal(r.min_temp_high_f, -5); assert.equal(r.min_temp_low_c, -23.3); assert.equal(r.min_temp_high_c, -20.6);
  assert.equal(r.latitude, 39.751586); assert.match(r.summary, /^ZIP 80202 is USDA plant hardiness zone 6a \(2023 map\): the average coldest winter night is -10 to -5 F/);
  assert.ok(r.more.includes(UTM));
  await assert.rejects(hardinessZone(f, { zip: '00000' }), InputError);
  await assert.rejects(hardinessZone(async () => '<html>', { zip: '80202' }), UpstreamError);
});

test('frost dates at 32 F for ZIP 80202: May 5 and Oct 14 over 1996-2025, two reads (stable normals + current season)', async () => {
  const { f, seen } = stub(ARCHIVE);
  const r = await frostDates(f, { location: '80202' }, NOW);
  assert.equal(r.normals_period, '1996-2025'); assert.equal(r.seasons_counted, 30); assert.equal(r.hemisphere, 'northern');
  assert.deepEqual(r.last_spring_frost, {
    median: 'May 5', median_mmdd: '05-05', one_in_ten_years_later_than: 'May 20', seasons_later_than_that: 3,
    seasons_with_no_spring_frost: 0, earliest_on_record: '2012-04-16', latest_on_record: '2019-05-24',
  });
  assert.deepEqual(r.first_fall_frost, {
    median: 'Oct 14', median_mmdd: '10-14', one_in_ten_years_earlier_than: 'Sep 28', seasons_earlier_than_that: 3,
    seasons_with_no_fall_frost: 0, earliest_on_record: '2020-09-08', latest_on_record: '2024-10-31',
  });
  assert.equal(r.growing_season_days_median, 160);
  assert.deepEqual(r.recent_seasons, [
    { season: '2025', last_spring_frost: '2025-04-20', first_fall_frost: '2025-10-28' },
    { season: '2026', last_spring_frost: '2026-05-07', first_fall_frost: 'none yet through 2026-11-10' },
  ]);
  assert.equal(r.as_of, '2026-11-10'); assert.deepEqual(r.hardiness_zone, { zone: '6a', min_temp_range_f: '-10 to -5' });
  assert.match(r.summary, /^ZIP 80202 \(USDA zone 6a\): Median last spring frost \(32 F\) May 5; 1 year in 10 later than May 20\. Median first fall frost Oct 14; 1 year in 10 earlier than Sep 28\. Median growing season 160 days/);
  const arch = seen.filter((u) => u.startsWith('https://archive-api'));
  assert.equal(arch.length, 2);
  assert.ok(arch.some((u) => u.includes('latitude=39.75&longitude=-105&start_date=1995-07-01&end_date=2025-12-31')));
  assert.ok(arch.some((u) => u.includes('start_date=2026-01-01&end_date=2026-11-15')));
  const h = await frostDates(f, { location: '80202', threshold_f: 28 }, NOW);
  assert.equal(h.last_spring_frost.median, 'Apr 29'); assert.equal(h.first_fall_frost.median, 'Oct 23'); assert.equal(h.growing_season_days_median, 173);
  const l = await frostDates(f, { latitude: 39.7516, longitude: -104.997, threshold_f: 36 }, NOW);
  assert.equal(l.last_spring_frost.median, 'May 14'); assert.equal(l.first_fall_frost.median, 'Oct 7'); assert.equal(l.hardiness_zone, null);
});

test('southern hemisphere seasons run July to July; frost-free places have no median', async () => {
  const { f } = stub(southSeries);
  const r = await frostDates(f, { latitude: -35.3, longitude: 149.1 }, NOW);
  assert.equal(r.hemisphere, 'southern'); assert.equal(r.normals_period, '1997-2026'); assert.equal(r.seasons_counted, 30);
  assert.equal(r.last_spring_frost.median, 'Sep 30'); assert.equal(r.first_fall_frost.median, 'May 20');
  assert.deepEqual(r.recent_seasons, [
    { season: '2025-2026', last_spring_frost: '2025-09-30', first_fall_frost: '2026-05-20' },
    { season: '2026-2027', last_spring_frost: '2026-09-30', first_fall_frost: 'none yet through 2026-11-10' },
  ]);
  const warm = { times: southSeries.daily.time, mins: southSeries.daily.time.map(() => 12) };
  const s = frostStats(warm, 32, false);
  assert.equal(s.spring.median, null); assert.equal(s.fall.median, null); assert.equal(s.seasons_counted, 29); assert.equal(s.spring.no_frost, 29); assert.equal(s.fall.no_frost, 29);
  assert.throws(() => frostStats({ times: ['2026-01-01'], mins: [1] }, 32, false), UpstreamError);
});

test('frost forecast for 80202: one freeze night (Mon 2026-11-16, 30.2 F) and three more at or below 36 F', async () => {
  const { f } = stub(ARCHIVE);
  const r = await frostForecast(f, { location: '80202' }, NOW);
  assert.equal(r.days, 16); assert.equal(r.nights_at_or_below_32f, 1); assert.equal(r.nights_at_or_below_36f, 4);
  assert.deepEqual(r.first_freeze, { date: '2026-11-16', weekday: 'Monday', low_f: 30.2, low_c: -1, category: 'frost or light freeze' });
  assert.deepEqual(r.cold_nights.map((x) => [x.date, x.low_f]), [['2026-11-16', 30.2], ['2026-11-17', 33.3], ['2026-11-24', 34.5], ['2026-11-25', 34.5]]);
  assert.match(r.summary, /^ZIP 80202, next 16 days: 1 night at or below 32 F and 3 more between 32 and 36 F\. First at or below 32 F: Mon 2026-11-16 30\.2 F\./);
  const s = await frostForecast(f, { location: '80202', days: 3 }, NOW);
  assert.equal(s.days, 3);
  await assert.rejects(frostForecast(f, { location: '80202', days: 20 }, NOW), InputError);
});

test('planting calendar for 80202: tomatoes indoors Mar 10-24, out May 12-26; garlic Sep 2-30', async () => {
  const { f } = stub(ARCHIVE);
  const r = await plantingCalendar(f, { location: '80202', crops: ['tomatoes', 'garlic', 'pumpkin'] }, NOW);
  assert.equal(r.last_spring_frost_median, 'May 5'); assert.equal(r.first_fall_frost_median, 'Oct 14');
  const [tom, gar, pum] = r.crops;
  assert.equal(tom.id, 'tomato'); assert.equal(tom.sow_indoors.from, 'Mar 10'); assert.equal(tom.sow_indoors.to, 'Mar 24');
  assert.equal(tom.transplant_outdoors.from, 'May 12'); assert.equal(tom.transplant_outdoors.to, 'May 26');
  assert.equal(gar.fall.from, 'Sep 2'); assert.equal(gar.fall.to, 'Sep 30'); assert.equal(gar.fall.what, 'plant cloves (harvest next summer)');
  assert.equal(pum.fits_frost_free_season, true);
  assert.match(r.summary, /^ZIP 80202: median last spring frost May 5, first fall frost Oct 14 \(32 F, 1996-2025\)\. Tomato: start indoors Mar 10 to Mar 24, plant out May 12 to May 26/);
  assert.throws(() => findCrops(['okra']), InputError);
  assert.equal(findCrops(undefined).length, 23);
  const { f: fs } = stub(southSeries);
  const w = await plantingCalendar(fs, { latitude: -35.3, longitude: 149.1, crops: ['garlic'] }, NOW);
  assert.equal(w.crops[0].fall.from, 'Apr 8'); assert.equal(w.crops[0].fall.to, 'May 6');
});

test('place names: a state picks the right Burlington, a bare name lists the others', async () => {
  const { f } = stub(ARCHIVE);
  const vt = await resolvePlace(f, { location: 'Burlington, VT' });
  assert.equal(vt.name, 'Burlington, Vermont, US'); assert.equal(vt.latitude, 44.47588); assert.equal(vt.matched_qualifier, true); assert.equal(vt.alternatives, undefined);
  const bare = await resolvePlace(f, { location: 'Burlington' });
  assert.equal(bare.name, 'Burlington, Ontario, CA'); assert.deepEqual(bare.alternatives.slice(0, 2), ['Burlington, Vermont, US', 'Burlington, Iowa, US']);
  const miss = await resolvePlace(f, { location: 'Burlington, Narnia' });
  assert.equal(miss.matched_qualifier, false);
  const ll = await resolvePlace(f, { location: '-33.9, 151.2' });
  assert.equal(ll.latitude, -33.9);
  await assert.rejects(resolvePlace(f, {}), InputError);
  await assert.rejects(resolvePlace(f, { latitude: 95, longitude: 0 }), InputError);
  assert.throws(() => parseDaily('{"error":true,"reason":"Parameter out of range"}', 'x'), UpstreamError);
  const p = parseDaily(JSON.stringify({ daily: { time: ['2026-11-14', '2026-11-15', '2026-11-16'], temperature_2m_min: [1, 2, null] } }), 'x');
  assert.deepEqual(p.times, ['2026-11-14', '2026-11-15']);
});

test('stdio: initialize, tools/list with annotations and a tools/call error over JSON-RPC (offline)', async () => {
  const child = spawn(process.execPath, [new URL('../dist/stdio.js', import.meta.url).pathname], { stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = []; let buf = '';
  const got = (id) => new Promise((res) => { const iv = setInterval(() => { const m = lines.find((l) => l.id === id); if (m) { clearInterval(iv); res(m); } }, 10); });
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const send = (m) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  assert.equal((await got(1)).result.serverInfo.name, 'last-frost-date-hardiness-zone-mcp');
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/list' });
  const tools = (await got(2)).result.tools;
  assert.deepEqual(tools.map((t) => t.name), ['hardiness_zone', 'frost_dates', 'frost_forecast', 'planting_calendar']);
  for (const t of tools) { assert.ok(t.title); assert.equal(t.annotations.readOnlyHint, true); assert.equal(t.annotations.destructiveHint, false); assert.equal(t.annotations.openWorldHint, true); }
  send({ id: 3, method: 'tools/call', params: { name: 'planting_calendar', arguments: { location: '80202', crops: ['okra'] } } });
  const r3 = await got(3);
  child.kill();
  assert.equal(r3.result?.isError ?? Boolean(r3.error), true);
});
