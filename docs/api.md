# Microgrid API

Base URL (Development): `https://microgrid-proxy-50047164504.development.catalystappsail.in`

The API is public and needs no login. Every response is JSON except `/api/sample`, and every error is `{"error": "...", "details": [...]}`. `details` is present only when there is something to list.

| Method | Path | What it does |
|---|---|---|
| `POST` | `/api/forecast` | Cleans a CSV upload or manual rows, forecasts every hour, applies the controller and battery, and saves the run |
| `GET` | `/api/runs` | Lists the latest 20 runs, newest first |
| `GET` | `/api/runs/{id}` | Returns one saved run, in the same shape as `/api/forecast` |
| `GET` | `/api/sample` | Downloads the bundled sample CSV (1,000 hours), for "Try sample data" |
| `POST` | `/api/predict` | `predict.py`'s contract, unchanged: `{"rows": [...]}` → `{"predictions", "signals", "battery"}` |
| `GET` | `/api/health` | `{"status", "version", "quickml_configured", "catalyst_context", "gateway_timeout", "quickml_calls_month"}`: AppSail's `CATALYST_MAX_TIMEOUT`, and QuickML requests sent this month (see [QuickML quota](#quickml-quota)). It never shows a secret |

## POST /api/forecast

There are two ways to send the input. Both accept at most 2,000 rows; more is a `413`.

**CSV upload** (multipart/form-data):

| Field | Required | Meaning |
|---|---|---|
| `file` | yes | The CSV file. Headers are matched case-insensitively. `timestamp` and `ambient_temp_c` are required; `humidity_pct` and `solar_irradiance_wm2` are optional |
| `source` | no | `csv` (the default) or `sample` |
| `window_start` | no | See [Window](#window) |

```bash
curl -F "file=@sample_test_input.csv" -F source=sample "$BASE/api/forecast"
```

**Manual rows** (JSON). `source` defaults to `manual`. The body is parsed as JSON whatever its Content-Type. Browsers should send `text/plain;charset=UTF-8` with no custom headers, because the Catalyst gateway answers CORS preflights itself, without CORS headers. `/api/predict` works the same way.

```bash
curl -H "Content-Type: application/json" "$BASE/api/forecast" -d '{
  "rows": [
    {"timestamp": "2015-06-16 18:00", "ambient_temp_c": 31.2, "humidity_pct": 60, "solar_irradiance_wm2": 40},
    {"timestamp": "16/06/2015 19:00", "ambient_temp_c": "30.8"}
  ],
  "window_start": 0
}'
```

### Cleaning

The steps below run in this order, and each one is counted in `cleaning.fixes`, zero counts included:

1. **Timestamps.** ISO 8601 (`2015-06-16 15:00:00`, `2015-06-16T15:00`, `2015/06/16 15:00`) is always accepted. A column may instead use one of these day-first or month-first layouts, with `/` or `-` between the date parts:
   - `DD/MM/YYYY HH:MM[:SS]`
   - `MM/DD/YYYY HH:MM[:SS]`
   - the 12-hour forms with `AM`/`PM`

   The whole column is read with whichever layout reads the most values; day-first wins a tie. A trailing UTC offset (`+05:30`, `Z`) is dropped and the local clock time kept.
2. **Rejected rows.** A row is rejected, and listed with its 1-based row number, when it has no timestamp, an unreadable timestamp, or a temperature outside −60 to 60 °C. For a CSV, row 1 is the line after the header.
3. **Non-numbers.** A weather value that isn't a number becomes missing.
4. **Clipping.** Humidity is clipped to 0–100 and solar irradiance to ≥ 0.
5. **Order.** Rows are sorted by time, and rows with a duplicate timestamp are dropped (the first one is kept).
6. **Gaps.** Missing values are interpolated against time, then filled from the nearest value at either end. A column with no values at all gets the training median.

If no rows survive, the response is a `400` with each reason in `details`:

```json
{"error": "no usable rows after cleaning", "details": ["row 1: no timestamp", "row 2: impossible temperature 75 °C"]}
```

### Response

Below is the trimmed live response for the sample CSV (`-F source=sample`). This run is saved in the Data Store, and the CSV is in Stratus.

```json
{
  "run": {
    "id": "93853000000030001",
    "created": "2026-10-26T22:07:31+05:30",
    "saved": true,
    "source": "sample",
    "filename": "sample_test_input.csv",
    "csv_key": "uploads/2026/10/26/163731-4ba92c62-sample_test_input.csv",
    "errors": []
  },
  "cleaning": {
    "rows_in": 1000,
    "rows_out": 1000,
    "timestamp_formats": {"ISO 8601": 1000},
    "fixes": [
      {"code": "rejected_no_timestamp", "label": "Rejected rows with no timestamp", "count": 0},
      {"code": "rejected_bad_timestamp", "label": "Rejected rows with an unreadable timestamp", "count": 0},
      {"code": "rejected_impossible_temp", "label": "Rejected rows with a temperature outside -60 to 60 °C", "count": 0},
      "… 12 more, always all present"
    ],
    "rejected_count": 0,
    "rejected": []
  },
  "summary": {
    "n_hours": 1000, "start": "2015-06-16 15:00:00", "end": "2015-07-28 06:00:00",
    "peak_kw": 299.82, "peak_timestamp": "2015-06-23 18:00:00",
    "storage_hours": 672, "grid_hours": 328, "overload_count": 577, "switch_count": 83, "min_soc_pct": 10.0
  },
  "window": {
    "start": 0, "end": 24, "size": 24,
    "hours": [
      {
        "index": 3, "timestamp": "2015-06-16 18:00:00", "hour": 18,
        "ambient_temp_c": 35.37, "humidity_pct": 56.92, "solar_irradiance_wm2": 16.0,
        "prediction_kw": 295.69, "mode": "Renewable Storage Mode", "overload": true,
        "soc_pct": 40.91, "pv_kw": 4.0, "battery_kw": 96.0, "grid_kw": 195.69,
        "reason": "295.7 kW > 160 and hour 18 is in the 18–22 window; 295.7 kW ≥ 200 raises a critical overload alert"
      },
      "… the other 23 hours of the window"
    ]
  },
  "hours": ["… all 1,000 hours, same shape as window.hours"],
  "switch_events": [
    {"index": 8, "timestamp": "2015-06-16 23:00:00", "from": "Renewable Storage Mode", "to": "Main Grid Mode",
     "label": "23:00 Renewable Storage → Main Grid"},
    {"index": 16, "timestamp": "2015-06-17 07:00:00", "from": "Main Grid Mode", "to": "Renewable Storage Mode",
     "label": "07:00 Main Grid → Renewable Storage"},
    "…"
  ],
  "overload_alerts": [
    {"index": 0, "timestamp": "2015-06-16 15:00:00", "prediction_kw": 244.01, "label": "15:00 Critical overload: 244.0 kW"},
    "…"
  ]
}
```

What the hour fields mean:

- **`prediction_kw`** comes from the QuickML endpoint, unrounded. The controller decides on that raw value, as `/api/predict` does, so a saved hour's prediction always matches its `mode`, `overload` flag and `reason`. Round it only for display; the reason prints enough decimals near a threshold (`160.004 kW > 160`).
- **`mode`**: `Renewable Storage Mode` when demand > 160 kW **or** the hour is 18–22. Otherwise `Main Grid Mode`.
- **`overload`** is true at ≥ 200 kW, whatever the mode.
- **`soc_pct`** is the battery's state of charge at the end of the hour. The battery model and its parameters are in [battery.md](battery.md).
- **`pv_kw`** is the solar output that hour (`0.25 × solar_irradiance_wm2`). It charges the battery in either mode.
- **`battery_kw`** is greater than 0 while discharging and less than 0 while charging. **`grid_kw`** is what the main grid supplies.
- **`switch_events`** lists each mode change between consecutive hours. The first hour of a run is never an event.
- **`overload_alerts`** has one entry per overload hour.

### Saving

The forecast is always returned. Saving is a separate step whose result is in `run`:

```json
"run": {"saved": true, "id": "r20261027013000-1a2b3c", "created": "2026-10-27T01:30:00+00:00",
        "csv_key": "uploads/2026/10/27/013000-4ba92c62-sample_test_input.csv", "errors": [],
        "storage": {"stratus": true, "datastore": false,
                    "reason": "Data Store free-tier insert quota used up for this month"}}
```

- `saved` is true once the run is in Stratus. That is the run store; see [Persistence](#persistence).
- `storage.datastore` says whether the run's metadata row also reached the Data Store, and `storage.reason` says why not.
- If saving fails, `saved` is false and the reason is in `run.errors` and `storage.reason`. A CSV that couldn't be uploaded leaves `csv_key: null`.
- Past the daily save limit (40 runs a UTC day), the reason is "daily save limit reached".

If QuickML fails, the response is a `502` (endpoint error) or `503` (not configured). There is never a made-up forecast.

### Window

`window_start` can be sent as a query parameter, a form field or a JSON field. It is either an hour index (`0` … `n_hours - 1`) or a timestamp, meaning the first hour at or after it. The default is `0`.

The window is up to 24 hours long. An out-of-range value is a `400`.

## GET /api/runs

Runs from Stratus and runs from the Data Store are merged, newest first, each listed once. Each Stratus run also has `series`, its demand in at most 48 equal buckets, for the History card's mini curve: `{"step_hours": 21, "mean_kw": [...], "max_kw": [...]}`. The older Data Store runs have no `series`. Every run has a `storage` object. Runs saved before 2026-10-27 have Data Store ROWIDs as their ids and `storage.stratus: false`.

```json
{"runs": [
  {"id": "93853000000030001", "created": "2026-10-26T22:07:31+05:30", "source": "sample",
   "filename": "sample_test_input.csv", "rows_in": 1000, "n_rows": 1000, "peak_kw": 299.82,
   "peak_timestamp": "2015-06-23 18:00:00", "overload_count": 577, "storage_hours": 672,
   "switch_count": 83, "start": "2015-06-16 15:00:00", "end": "2015-07-28 06:00:00",
   "csv_key": "uploads/2026/10/26/163731-4ba92c62-sample_test_input.csv"},
  "… up to 20 runs, newest first"
]}
```

## GET /api/runs/{id}

`GET /api/runs/r20261027013000-1a2b3c?window_start=2015-06-23 12:00` returns the same keys as `/api/forecast`: `run`, `cleaning`, `summary`, `window`, `hours`, `switch_events`, `overload_alerts`. They are rebuilt from the stored hours. Ids starting with `r` are read from Stratus. All-digit ids are the older Data Store runs, read from `runs` and `run_hours`. An unknown or malformed id is a `404`.

## POST /api/predict

`predict.py`'s contract: `{"rows": [{timestamp, ambient_temp_c, humidity_pct, solar_irradiance_wm2}, ...]}` answers,
in input order:

- `predictions`: one kW value per row, from QuickML, unrounded;
- `signals`: per row, `{timestamp, mode, overload}`, decided on the raw prediction exactly as `/api/forecast` decides;
- `battery`: per row, `{timestamp, mode, demand_kw, pv_kw, battery_kw, grid_kw, soc_start, soc_end, soc_pct}`.

**Units:** `soc_start` and `soc_end` are fractions from 0 to 1, kept for compatibility. `soc_pct` is the same end
state as a percentage, matching `soc_pct` in runs. It saves nothing, and it is never blocked by the
[QuickML quota](#quickml-quota) reserve.

## Persistence

Runs are stored in a hybrid way, because of the Catalyst free tier.

**Why.** The free tier is account-wide and per calendar month, shared by Development and Production. It allows 5,000 Data Store inserts, 1,000 Stratus object uploads, 1,000 object updates and 10,000 downloads (as the console's free-tier dialog shows). Runs used to be saved as one `runs` row plus one `run_hours` row per hour. Inserts appear to be counted per row, so each 1,000-hour run cost about 1,001 of them, and a handful of runs used up the month's allowance on 2026-10-27. Inserts then failed with `FREE_USAGE_LIMIT_REACHED` until the next month.

**Now:**

| Where | What | Cost per run |
|---|---|---|
| Stratus `runs/<id>.json` | the run summary, the cleaning report and all its hours, as one object | 1 upload |
| Stratus `runs/index.json` | the latest 20 run summaries, and the count of runs saved today (UTC) | 1 download, 1 upload |
| Stratus `uploads/...` | the uploaded CSV (CSV uploads only) | 1 upload |
| Data Store `runs` | one metadata row (source, file, peak, counts, cleaning report), best effort | 1 insert |

- Stratus is the run store. The Data Store row is kept so that run metadata is queryable with ZCQL. When an insert is refused, for example by the free-tier quota, the run is still saved and `storage.datastore` is false.
- Hourly rows are no longer written to `run_hours`. The table is read only for the runs saved before 2026-10-27.
- Run ids are made by the API: `r` + the UTC time to the second + 6 random hex digits. They sort by time, and don't depend on Data Store ROWIDs.
- **Save limits: 40 runs per UTC day, and 250 per calendar month.** Past either, forecasts still work, unsaved.
  The maths, against the free tier's 1,000 uploads and 1,000 updates a month:
  - a saved run costs at most 2 uploads (the run object and its CSV) and 1 update (the index);
  - 250 runs a month: at most **500 uploads** and **250 updates**;
  - the QuickML ledger adds at most one update per QuickML request, so at most 500 more;
  - worst case for a full month: 500 uploads and 750 updates, both under 1,000;
  - until Nov 1, from the console's 31 uploads and 15 updates on 2026-10-27, 40 a day for five days stays under 400 more uploads.
- **Limitations.** The index is read, changed and written back with no lock, so two runs saved in the same second can drop one from the 20-run list. Both runs are still stored and can be opened by id.

## QuickML quota

QuickML's free tier is 500 inference calls a month, account-wide, and the graded `predict.py` run uses the same
allowance as every visitor ([`backend/quota.py`](../backend/quota.py)):

- **A persistent prediction cache.** Every feature vector QuickML has priced, and its prediction, is kept in Stratus
  in `quickml/ledger.json`. Identical inputs never reach QuickML twice, across restarts too: the landing's 24 rows,
  the sample and a repeated `test_eval` cost nothing once priced.
- **A monthly counter**, in the same object, counts the QuickML requests sent this calendar month (UTC).
  `/api/health` shows it as `quickml_calls_month`. Cache and counter are written together, one Stratus update per
  request that called QuickML. October starts from the console's figure, 52 of 500 on 2026-10-27, as an offset in `backend/quota.py` (`USAGE_OFFSET`).
- **A reserve for grading.** From 380 calls on, `/api/forecast` (uploads, the form, the sample) answers only from the
  cache. When it would need QuickML, it answers `429 {"error": "demo forecast quota reached", "details": [...]}`.
  `/api/predict` is never blocked.
- **Retries.** `predict.py` makes 3 attempts (10 s, then 30 s apart), and retries a gateway 408 too. The Catalyst
  gateway cuts a request at about 30 s even though `CATALYST_MAX_TIMEOUT` reads -1, and the SDK's own QuickML read
  timeout is 30 s, so the server never makes a second QuickML try: it couldn't finish in time.
  Worst case for one graded run: 3 calls. The usual case: 1 call, or 0 when cached.

## Storage

**Data Store (Development).** `run_hours` holds only the runs saved before 2026-10-27:

| Table | Columns |
|---|---|
| `runs` | `ROWID` (the run id), `CREATEDTIME`, `source_type`, `file_name`, `rows_in`, `n_rows`, `peak_kw`, `peak_at`, `overload_count`, `storage_hours`, `switch_count`, `start_at`, `end_at`, `csv_key`, `cleaning_json` |
| `run_hours` | `run_id` → `runs.ROWID` (cascade delete), `idx`, `ts`, `temp_c`, `humidity_pct`, `solar_wm2`, `prediction_kw`, `grid_mode`, `is_overload`, `soc_pct`, `pv_kw`, `battery_kw`, `grid_kw`, `reason` |

**Stratus:** everything goes to the protected bucket `microgrid-uploads` (`UPLOAD_BUCKET` overrides the name).
- Runs are at `runs/<id>.json`, and the index at `runs/index.json`.
- Uploaded CSVs are at keys like `uploads/2026/10/26/153012-1a2b3c4d-name.csv`.

**Free-tier cost per run:**
- 1 Stratus upload (the run), plus 1 more for a CSV, and 1 update (the index);
- 1 Stratus download;
- 1 Data Store insert, when the quota allows;
- at most 1 QuickML call (rows already cached cost nothing), out of 500 a month.

Reading a run back costs 1 Stratus download, or 5 ZCQL queries for an older Data Store run. Listing runs costs 1 download plus 1 ZCQL query.
