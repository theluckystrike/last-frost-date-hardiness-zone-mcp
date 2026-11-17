# last-frost-date-hardiness-zone-mcp

Last frost dates and USDA hardiness zones for AI assistants. Ask what growing zone a ZIP code is in, when the last spring frost usually comes, whether it will freeze this week, or when to start tomatoes indoors.

This is a Model Context Protocol (MCP) server. It reads the USDA 2023 Plant Hardiness Zone Map by ZIP code (phzmapi.org) and Open-Meteo historical weather, forecast and geocoding at call time, and computes frost dates from 30 complete seasons of daily minimum temperatures. It needs no API key.

## Tools

| Tool | What it returns |
| --- | --- |
| `hardiness_zone` | The USDA plant hardiness zone (2023 map) for a US ZIP code, with the average coldest winter temperature range in F and C. |
| `frost_dates` | Median last spring frost and first fall frost, the dates beaten in only 1 year in 10, earliest and latest on record, the median growing season and the latest seasons' frosts. 32 F (default), 36 F or 28 F. |
| `frost_forecast` | Nights at or below 36 F and 32 F in the next 1 to 16 days with a frost category, the first freeze and the coldest night. |
| `planting_calendar` | When to start seeds indoors, transplant, direct sow and sow a fall crop for 23 vegetables, counted from the local frost dates, and whether a warm-season crop fits the season. |

Every result has structured JSON, a plain-text summary, `as_of`, `source` and `more` (a page on [mcpstamp.com](https://www.mcpstamp.com/servers/?utm_source=mcp&utm_medium=last-frost-date-hardiness-zone-mcp)). Every tool is marked read-only.

## What it knows that your model does not

- The 2023 USDA hardiness zone for any US ZIP code, which moved about half of the country half a zone warmer than the 2012 map.
- Local last spring and first fall frost dates with 1-in-10 year odds, computed from 30 seasons of daily minimum temperatures for any place on Earth, Southern Hemisphere included.
- Whether a frost or freeze is forecast in the next 16 days, and the frost of the current season so far.

## Install

### Hosted (custom connector, ChatGPT developer mode, any remote MCP client)

Paste this URL. No token, no sign-up.

```
https://last-frost-date-hardiness-zone-mcp.lipmichal.workers.dev/mcp
```

### Cursor

Add to `~/.cursor/mcp.json`.

```json
{
  "mcpServers": {
    "last-frost-date": { "url": "https://last-frost-date-hardiness-zone-mcp.lipmichal.workers.dev/mcp" }
  }
}
```

### VS Code

Add to `.vscode/mcp.json`.

```json
{
  "servers": {
    "last-frost-date": { "type": "http", "url": "https://last-frost-date-hardiness-zone-mcp.lipmichal.workers.dev/mcp" }
  }
}
```

### Local stdio

The npm package is not published. Build it from this repository with Node 20 or newer, then point your MCP client at `node /path/to/last-frost-date-hardiness-zone-mcp/dist/stdio.js`.

```
git clone https://github.com/theluckystrike/last-frost-date-hardiness-zone-mcp && cd last-frost-date-hardiness-zone-mcp
npm install && npm run build
node dist/stdio.js
```

## Example prompts

- "What is the last frost date for ZIP 80202?"
- "What USDA hardiness zone is Burlington, Vermont 05401 in?"
- "Will it freeze in Denver in the next week?"
- "When should I start tomato seeds indoors in Chicago 60614?"
- "When is the first fall frost in Leeds, UK, and how long is the growing season?"

## Data sources

Full list in [DATA_SOURCES.md](DATA_SOURCES.md).

- [USDA Plant Hardiness Zone Map 2023](https://planthardiness.ars.usda.gov/) by ZIP code via [phzmapi.org](https://phzmapi.org/): `https://phzmapi.org/<zip>.json`.
- [Open-Meteo](https://open-meteo.com/) historical weather (`archive-api.open-meteo.com/v1/archive`, daily `temperature_2m_min`), forecast (`api.open-meteo.com/v1/forecast`) and geocoding (`geocoding-api.open-meteo.com/v1/search`). Open-Meteo data is CC BY 4.0.

## Limitations

- Frost dates are modelled from gridded reanalysis temperatures (about 10 to 25 km cells), not NOAA station climate normals. They can differ from a nearby station by a week or more in valleys, on coasts and in mountains.
- Hardiness zones are by ZIP code centroid and US only (including Alaska, Hawaii and Puerto Rico). Frost dates and forecasts work worldwide.
- Planting windows are general extension-service rules of thumb counted from the median frost date, so in half of all years the last frost comes later. They are not variety-specific advice.
- The 30-season record is cached for 30 days at the edge, so the current season's frosts come from a separate, smaller read.

## More

More MCP servers that answer questions your assistant cannot answer alone are on [mcpstamp.com](https://www.mcpstamp.com/servers/?utm_source=mcp&utm_medium=last-frost-date-hardiness-zone-mcp).

Part of the Zovo MCP collection at https://mcp.zovo.one

Built by [theluckystrike](https://github.com/theluckystrike).

## Development

```
npm install
npm test                              # builds, then runs the fixture tests and an offline stdio test
node scripts/stdio-transcript.mjs     # live stdio round trip, writes .live/stdio-transcript.jsonl
```

CI (`.github/workflows/bundle.yml`) runs the tests, the type check and `wrangler deploy --dry-run --outdir out`, and uploads the Worker bundle as an artifact.

## License

MIT
