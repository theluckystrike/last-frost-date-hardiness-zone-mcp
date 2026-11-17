# Data sources

All sources are public, keyless and read at call time. Test fixtures in `test/fixtures/` were downloaded on 2026-11-17.

| Data | URL | Notes |
|---|---|---|
| USDA Plant Hardiness Zone by ZIP (2023 map) | https://phzmapi.org/80202.json | Static JSON per ZIP: zone ("6a"), temperature_range (average annual extreme minimum, F) and coordinates of the ZIP. Unknown ZIPs answer 404. Official map: https://planthardiness.ars.usda.gov/ |
| Open-Meteo historical weather | https://archive-api.open-meteo.com/v1/archive?latitude=39.75&longitude=-105&start_date=1995-07-01&end_date=2025-12-31&daily=temperature_2m_min&timezone=auto | Daily minimum 2 m air temperature in C. Read twice per question: the 30-season record (its URL changes once a year, coordinates rounded to 0.05 degree, cached 30 days, because Open-Meteo counts a request for more than 2 weeks of data as several calls) and the current season so far (cached 6 hours). Fixture: Denver, 1995-07-01 to 2026-11-10. |
| Open-Meteo forecast | https://api.open-meteo.com/v1/forecast?latitude=39.7516&longitude=-104.997&daily=temperature_2m_min&forecast_days=16&timezone=auto | Up to 16 days of forecast daily minimum temperature. Cached 30 minutes. |
| Open-Meteo geocoding | https://geocoding-api.open-meteo.com/v1/search?name=Burlington&count=10&language=en&format=json | Place names to coordinates. A state ("VT" or "Vermont") or country after a comma picks among same-named places. |

## Method

A frost day is a day whose minimum temperature is at or below the threshold (32 F by default, or 36 F or 28 F). Northern Hemisphere seasons split at July 15: the last frost before it is the last spring frost and the first frost after it the first fall frost. Southern Hemisphere seasons run from July 15 to July 14 and split at January 15. The median and the 1-in-10 year dates are nearest-rank quantiles over the 30 most recent complete seasons; the 1-in-10 date has 10% of seasons beyond it (3 of 30). Seasons without a frost count as earlier than any spring date and later than any fall date, so a place that frosts in fewer than half of its seasons has no median.

Open-Meteo data is licensed CC BY 4.0 (https://open-meteo.com/en/license).
