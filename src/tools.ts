// Tool registry shared by the stdio and Worker entries.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { InputError, REPO, SITE, CROPS, frostDates, frostForecast, hardinessZone, plantingCalendar } from './core.js';
import type { FetchText } from './types.js';

export const VERSION = '1.0.0';

export const META = {
  alias: 'last-frost-date',
  metaDescription: 'MCP server for the last frost date and USDA hardiness zone: plant hardiness zone by ZIP code (2023 map), average last spring and first fall frost dates with 1-in-10 year odds, the frost forecast for the next 16 days and when to plant each vegetable.',
  intro: 'Last frost dates, first frost dates and USDA plant hardiness zones for AI assistants, from the 2023 USDA map and 30 seasons of Open-Meteo weather history.',
};

export const TOOL_INFO = [
  { name: 'hardiness_zone', blurb: 'The USDA plant hardiness zone (2023 map) for a US ZIP code, with the average coldest winter temperature.' },
  { name: 'frost_dates', blurb: 'Median last spring frost and first fall frost, the 1-in-10 year dates, the growing season length and this year\'s frost so far, for a ZIP, a place or coordinates.' },
  { name: 'frost_forecast', blurb: 'Nights at or below 32 F and 36 F in the next 1 to 16 days, with the first freeze and the coldest night.' },
  { name: 'planting_calendar', blurb: 'When to start seeds indoors, transplant and direct sow vegetables, counted from the local frost dates.' },
];

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

function ok(data: Record<string, unknown> & { summary: string }) {
  return { content: [{ type: 'text' as const, text: `${data.summary}\n\n${JSON.stringify(data, null, 2)}` }], structuredContent: data };
}
function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: 'text' as const, text: `${e instanceof InputError ? 'Error' : 'Upstream error (phzmapi.org or Open-Meteo)'}: ${msg}` }] };
}
const wrap = <A>(fn: (a: A) => unknown) => async (a: A) => { try { return ok((await fn(a)) as any); } catch (e) { return fail(e); } };

const place = {
  location: z.string().max(120).optional().describe('A US ZIP code ("80202"), a place ("Burlington, VT", "Leeds, UK") or "lat,lon". Add the state or country to a place name to avoid a same-named town.'),
  latitude: z.number().min(-90).max(90).optional().describe('Latitude, instead of location.'),
  longitude: z.number().min(-180).max(180).optional().describe('Longitude, instead of location.'),
};

export function createServer(fetchText: FetchText): McpServer {
  const server = new McpServer({ name: REPO, version: VERSION, websiteUrl: SITE } as any, {
    instructions:
      'Frost dates and plant hardiness zones. hardiness_zone gives the USDA zone (2023 map) for a US ZIP code. frost_dates computes the median and 1-in-10 year ' +
      'last spring and first fall frost from 30 seasons of daily minimum temperatures for any place on Earth (Southern Hemisphere seasons are handled). ' +
      'frost_forecast lists the cold nights in the next 16 days. planting_calendar turns the frost dates into sowing and transplant windows for common vegetables. ' +
      'Frost dates are modelled from gridded weather history, not a NOAA station, so treat them as within about a week.',
  });

  server.registerTool('hardiness_zone', {
    title: 'USDA plant hardiness zone by ZIP code',
    description:
      'The USDA plant hardiness zone for a US ZIP code from the 2023 USDA Plant Hardiness Zone Map (for example 6a), the average annual coldest winter ' +
      'temperature range it stands for in F and C, and the ZIP\'s coordinates. Answers "what growing zone am I in".',
    inputSchema: { zip: z.string().min(5).max(10).describe('5-digit US ZIP code, for example "80202" or "05401".') },
    annotations: { title: 'Hardiness zone', ...RO },
  }, wrap((a: any) => hardinessZone(fetchText, a)));

  server.registerTool('frost_dates', {
    title: 'Last frost and first frost dates',
    description:
      'Average (median) last spring frost date and first fall frost date for a US ZIP code, a place name or coordinates, the dates beaten in only 1 year in 10, ' +
      'the earliest and latest on record, the median frost-free growing season, and the last spring and first fall frost of the latest seasons. ' +
      'Computed from 30 complete seasons of daily minimum temperatures. threshold_f 32 (frost, default), 36 (light frost on tender plants) or 28 (hard freeze).',
    inputSchema: {
      ...place,
      threshold_f: z.union([z.literal(36), z.literal(32), z.literal(28)]).optional().describe('Frost threshold in F: 32 (default), 36 or 28.'),
    },
    annotations: { title: 'Frost dates', ...RO },
  }, wrap((a: any) => frostDates(fetchText, a)));

  server.registerTool('frost_forecast', {
    title: 'Frost forecast',
    description:
      'Forecast frost and freeze nights for the next 1 to 16 days (default 16) at a ZIP code, place or coordinates: each night at or below 36 F with its ' +
      'category (frost possible, frost or light freeze, freeze, hard freeze), the first night at or below 32 F and the coldest night. Answers "will it frost tonight".',
    inputSchema: { ...place, days: z.number().int().min(1).max(16).optional().describe('Days ahead, 1 to 16. Default 16.') },
    annotations: { title: 'Frost forecast', ...RO },
  }, wrap((a: any) => frostForecast(fetchText, a)));

  server.registerTool('planting_calendar', {
    title: 'Vegetable planting calendar',
    description:
      'When to plant vegetables at a ZIP code, place or coordinates: dates to start seeds indoors, transplant outdoors, direct sow and sow a fall crop, counted ' +
      'from the local median last spring and first fall frost, and whether a warm-season crop fits the frost-free season. ' +
      `Crops: ${CROPS.map((c) => c.id).join(', ')}. Default all.`,
    inputSchema: {
      ...place,
      crops: z.array(z.string().min(2).max(40)).max(25).optional().describe('Crop names, for example ["tomato", "peas", "garlic"]. Default all.'),
    },
    annotations: { title: 'Planting calendar', ...RO },
  }, wrap((a: any) => plantingCalendar(fetchText, a)));

  return server;
}
