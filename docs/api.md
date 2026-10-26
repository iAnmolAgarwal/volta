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
| `GET` | `/api/health` | `{"status", "version", "quickml_configured", "catalyst_context"}`. It never shows a secret |

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

**Manual rows** (application/json). `source` defaults to `manual`:

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

Below is the trimmed live response for the sample CSV, from the run that is saved in the Data Store. This run was made before Stratus was enabled, which is why `run.errors` lists the refused upload.

```json
{
  "run": {
    "id": "93853000000022027",
    "created": "2026-10-26T21:47:47+05:30",
    "saved": true,
    "source": "sample",
    "filename": "sample_test_input.csv",
    "csv_key": null,
    "errors": ["Stratus upload failed: {'code': 'OPERATION_NOT_ALLOWED', 'message': '... User needs to be in session when accessing Stratus for the first time', 'status_code': 405}"]
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
        "soc_pct": 10.0, "battery_kw": 0.0, "grid_kw": 295.69,
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

- **`prediction_kw`** comes from the QuickML endpoint, rounded to 0.01 kW. The controller decides on that rounded value, so a saved hour's prediction always matches its `mode`, `overload` flag and `reason`.
- **`mode`**: `Renewable Storage Mode` when demand > 160 kW **or** the hour is 18–22. Otherwise `Main Grid Mode`.
- **`overload`** is true at ≥ 200 kW, whatever the mode.
- **`soc_pct`** is the battery's state of charge at the end of the hour. The battery holds 500 kWh and starts at 80%, with a 10% floor. It discharges up to 150 kW in storage mode and charges at 100 kW in grid mode.
- **`battery_kw`** is greater than 0 while discharging and less than 0 while charging. **`grid_kw`** is what the main grid supplies.
- **`switch_events`** lists each mode change between consecutive hours. The first hour of a run is never an event.
- **`overload_alerts`** has one entry per overload hour.

### Saving

`run.saved` is true once the run and its hours are in the Data Store. The upload, CSV uploads only, goes to Stratus at `run.csv_key`. If saving fails, the forecast is still returned, with `saved: false` (or `csv_key: null`) and the reason in `run.errors`.

If QuickML fails, the response is a `502` (endpoint error) or `503` (not configured). There is never a made-up forecast.

### Window

`window_start` can be sent as a query parameter, a form field or a JSON field. It is either an hour index (`0` … `n_hours - 1`) or a timestamp, meaning the first hour at or after it. The default is `0`.

The window is up to 24 hours long. An out-of-range value is a `400`.

## GET /api/runs

```json
{"runs": [
  {"id": "93853000000022027", "created": "2026-10-26T21:47:47+05:30", "source": "sample",
   "filename": "sample_test_input.csv", "rows_in": 1000, "n_rows": 1000, "peak_kw": 299.82,
   "peak_timestamp": "2015-06-23 18:00:00", "overload_count": 577, "storage_hours": 672,
   "switch_count": 83, "start": "2015-06-16 15:00:00", "end": "2015-07-28 06:00:00", "csv_key": null}
]}
```

## GET /api/runs/{id}

`GET /api/runs/93853000000022027?window_start=2015-06-23 12:00` returns the same keys as `/api/forecast`: `run`, `cleaning`, `summary`, `window`, `hours`, `switch_events`, `overload_alerts`. They are rebuilt from the stored hours. An unknown id is a `404`.

## Storage

**Data Store (Development):**

| Table | Columns |
|---|---|
| `runs` | `ROWID` (the run id), `CREATEDTIME`, `source_type`, `file_name`, `rows_in`, `n_rows`, `peak_kw`, `peak_at`, `overload_count`, `storage_hours`, `switch_count`, `start_at`, `end_at`, `csv_key`, `cleaning_json` |
| `run_hours` | `run_id` → `runs.ROWID` (cascade delete), `idx`, `ts`, `temp_c`, `humidity_pct`, `solar_wm2`, `prediction_kw`, `grid_mode`, `is_overload`, `soc_pct`, `battery_kw`, `grid_kw`, `reason` |

**Stratus:** uploaded CSVs go to the protected bucket `microgrid-uploads` (`UPLOAD_BUCKET` overrides the name). Keys look like `uploads/2026/10/26/153012-1a2b3c4d-name.csv`.

**Free-tier cost per 1,000-hour run:**
- 6 Data Store inserts (1 run row, plus hours in batches of 200), out of 5,000 a month;
- 1 Stratus upload, out of 2,000 a month;
- at most 1 QuickML call (rows already cached cost nothing), out of 500 a month.

Reading a run back costs 5 ZCQL queries.
