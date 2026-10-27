"""The /api/forecast, /api/runs and /api/sample contract, with QuickML and the store faked."""

import io
import json

import pytest

from backend.app import SAMPLE_CSV, create_app
from backend.controller import decide
from backend.service import MAX_ROWS, Forecaster
from backend.store import DailyLimitError, StoreError
from fakes import FakeRunStore, fake_predictions
from model.quickml_client import ConfigError, PredictionError
from test_backend import FakeClient, sample_rows

SAMPLE = SAMPLE_CSV.read_bytes()
TOP_KEYS = {"run", "cleaning", "summary", "window", "hours", "switch_events", "overload_alerts"}
HOUR_KEYS = {"index", "timestamp", "hour", "ambient_temp_c", "humidity_pct", "solar_irradiance_wm2", "prediction_kw",
             "mode", "overload", "soc_pct", "pv_kw", "battery_kw", "grid_kw", "reason"}


@pytest.fixture
def fake():
    return FakeClient()


@pytest.fixture
def store():
    return FakeRunStore()


@pytest.fixture
def api(fake, store):
    return create_app(Forecaster(client_factory=lambda req: fake), store_factory=lambda req: store).test_client()


def upload(api, data=SAMPLE, name="sample_test_input.csv", query="", **form):
    return api.post(f"/api/forecast{query}", data={"file": (io.BytesIO(data), name), **form},
                    content_type="multipart/form-data")


def post_rows(api, body, query=""):
    return api.post(f"/api/forecast{query}", data=json.dumps(body), content_type="application/json")


def test_csv_upload_returns_the_full_contract(api, store):
    resp = upload(api)
    assert resp.status_code == 200
    body = resp.get_json()
    assert set(body) == TOP_KEYS
    assert len(body["hours"]) == 1000 and set(body["hours"][0]) == HOUR_KEYS
    assert body["window"]["start"] == 0 and len(body["window"]["hours"]) == 24
    assert body["cleaning"]["rows_in"] == body["cleaning"]["rows_out"] == 1000
    run = body["run"]
    assert run["saved"] is True and run["id"] in store.runs and run["errors"] == []
    assert run["source"] == "csv" and run["filename"] == "sample_test_input.csv"
    assert store.csvs[run["csv_key"]] == SAMPLE  # the upload itself is kept in Stratus
    record = store.runs[run["id"]][0]
    assert record["n_rows"] == 1000 and record["csv_key"] == run["csv_key"]
    assert record["peak_kw"] == body["summary"]["peak_kw"]
    assert record["storage_hours"] == sum(h["mode"].startswith("Renewable") for h in body["hours"])


def test_every_hour_follows_the_controller(api):
    body = upload(api).get_json()
    for h in body["hours"]:
        assert {"mode": h["mode"], "overload": h["overload"]} == decide(h["timestamp"], h["prediction_kw"])
    events = body["switch_events"]
    assert len(events) == sum(a["mode"] != b["mode"] for a, b in zip(body["hours"], body["hours"][1:]))
    assert len(body["overload_alerts"]) == sum(h["overload"] for h in body["hours"])


def test_predictions_come_from_the_model_once_per_distinct_row(api, fake):
    rows = sample_rows(48)
    body = post_rows(api, {"rows": rows}).get_json()
    assert [h["prediction_kw"] for h in body["hours"]] == pytest.approx(fake_predictions(rows), abs=0.0051)
    assert len(fake.calls) == 1


def test_manual_rows_are_cleaned_and_saved_without_a_csv(api, store):
    rows = sample_rows(30)[::-1] + [{"timestamp": "", "ambient_temp_c": 20}]
    resp = post_rows(api, {"rows": rows})
    assert resp.status_code == 200
    body = resp.get_json()
    assert [h["timestamp"] for h in body["hours"]] == sorted(r["timestamp"] for r in rows if r["timestamp"])
    assert body["cleaning"]["rejected"] == [{"row": 31, "reason": "no timestamp"}]
    assert body["run"]["source"] == "manual" and body["run"]["csv_key"] is None and store.csvs == {}


def test_manual_rows_sent_as_text_plain_are_accepted(api):
    resp = api.post("/api/forecast", data=json.dumps({"rows": sample_rows(5)}), content_type="text/plain;charset=UTF-8")
    assert resp.status_code == 200 and resp.get_json()["run"]["source"] == "manual"


def test_sample_source_and_window_start(api):
    body = upload(api, source="sample", window_start="2015-06-17 00:00:00").get_json()
    assert body["run"]["source"] == "sample"
    assert body["window"]["start"] == 9 and body["window"]["hours"][0]["timestamp"] == "2015-06-17 00:00:00"
    body = upload(api, query="?window_start=990").get_json()
    assert (body["window"]["start"], body["window"]["end"]) == (990, 1000)
    body = post_rows(api, {"rows": sample_rows(30), "window_start": 5}).get_json()
    assert body["window"]["start"] == 5


@pytest.mark.parametrize(
    "send, status, message",
    [
        (lambda api: upload(api, b"timestamp,ambient_temp_c\n"), 400, "no rows"),
        (lambda api: upload(api, b"time,temp\n2015-06-16 10:00,20\n"), 400, "missing required column"),
        (lambda api: upload(api, b"timestamp,ambient_temp_c\nnope,20\n"), 400, "no usable rows"),
        (lambda api: upload(api, source="email"), 400, "source must be one of"),
        (lambda api: upload(api, query="?window_start=5000"), 400, "window_start"),
        (lambda api: post_rows(api, {"rows": "x"}), 400, "rows must be a list"),
        (lambda api: post_rows(api, [1, 2]), 400, "send a CSV"),
        (lambda api: api.post("/api/forecast", data="x", content_type="text/plain"), 400, "send a CSV"),
        (lambda api: api.post("/api/forecast", data={"csv": "x"}, content_type="multipart/form-data"), 400, "multipart field 'file'"),
    ],
)
def test_bad_requests(api, store, send, status, message):
    resp = send(api)
    assert resp.status_code == status
    assert message in resp.get_json()["error"]
    assert store.runs == {}


def test_no_usable_rows_lists_details(api):
    resp = upload(api, b"timestamp,ambient_temp_c\n,20\n2015-06-16 10:00,75\n")
    assert resp.get_json()["details"] == ["row 1: no timestamp", "row 2: impossible temperature 75 °C"]


def test_too_many_rows_is_413(api):
    lines = ["timestamp,ambient_temp_c"] + [f"2015-01-{1 + i // 24:02d} {i % 24:02d}:00,20" for i in range(MAX_ROWS + 1)]
    assert upload(api, "\n".join(lines).encode()).status_code == 413


@pytest.mark.parametrize("error, status", [(PredictionError("QuickML down"), 502), (ConfigError("no key"), 503)])
def test_quickml_failures_are_errors_never_a_made_up_forecast(store, error, status):
    api = create_app(Forecaster(client_factory=lambda req: FakeClient(fail=error)), store_factory=lambda req: store).test_client()
    resp = upload(api)
    assert resp.status_code == status and str(error) in resp.get_json()["error"]
    assert store.runs == {}


def test_store_failures_keep_the_forecast_and_say_so(fake):
    store = FakeRunStore(fail_save=StoreError("saving the run failed: quota"), fail_csv=StoreError("Stratus upload failed: 403"))
    api = create_app(Forecaster(client_factory=lambda req: fake), store_factory=lambda req: store).test_client()
    resp = upload(api)
    assert resp.status_code == 200
    run = resp.get_json()["run"]
    assert run["saved"] is False and run["id"] is None and run["csv_key"] is None
    assert run["errors"] == ["Stratus upload failed: 403", "saving the run failed: quota"]
    assert run["storage"] == {"stratus": False, "datastore": False, "reason": "saving the run failed: quota"}


def test_past_the_daily_save_limit_the_forecast_returns_unsaved(fake):
    store = FakeRunStore(fail_save=DailyLimitError("daily save limit reached (40 runs a day, UTC)"))
    api = create_app(Forecaster(client_factory=lambda req: fake), store_factory=lambda req: store).test_client()
    body = post_rows(api, {"rows": sample_rows(3)}).get_json()
    assert len(body["hours"]) == 3 and body["run"]["saved"] is False
    assert body["run"]["storage"]["reason"].startswith("daily save limit")


def test_past_the_daily_limit_a_csv_is_not_uploaded(fake):
    class Capped(FakeRunStore):
        def check_daily_limit(self):
            raise DailyLimitError("daily save limit reached (40 runs a day, UTC)")

    store = Capped()
    api = create_app(Forecaster(client_factory=lambda req: fake), store_factory=lambda req: store).test_client()
    run = upload(api).get_json()["run"]
    assert run["saved"] is False and run["csv_key"] is None and store.csvs == {}
    assert run["storage"]["reason"].startswith("daily save limit")


def test_case_colliding_columns_are_a_400(api):
    resp = upload(api, b"Timestamp,timestamp,ambient_temp_c\n2015-06-16 10:00,2015-06-16 10:00,20\n")
    assert resp.status_code == 400 and "duplicate column" in resp.get_json()["error"]


def test_a_timestamp_window_start_with_an_offset_reads_as_clock_time(api):
    body = upload(api, query="?window_start=2015-06-17T00:00:00Z", source="sample").get_json()
    assert body["window"]["hours"][0]["timestamp"] == "2015-06-17 00:00:00"


def test_a_saved_run_reports_where_it_is_stored(api):
    run = post_rows(api, {"rows": sample_rows(3)}).get_json()["run"]
    assert run["saved"] is True and run["storage"]["stratus"] is True


def test_without_catalyst_the_forecast_works_and_history_is_503(fake):
    api = create_app(Forecaster(client_factory=lambda req: fake)).test_client()  # the real store factory
    run = upload(api).get_json()["run"]
    assert run["saved"] is False and "Catalyst" in run["errors"][0]
    assert api.get("/api/runs").status_code == 503
    assert api.get("/api/runs/1").status_code == 503


def test_runs_list_newest_first_and_capped_at_20(api, store):
    for i in range(22):
        post_rows(api, {"rows": sample_rows(3), "source": "manual"})
    runs = api.get("/api/runs").get_json()["runs"]
    assert len(runs) == 20
    assert [int(r["id"]) for r in runs] == sorted((int(i) for i in store.runs), reverse=True)[:20]


def test_saved_run_reads_back_as_the_same_view(api):
    created = upload(api).get_json()
    resp = api.get(f"/api/runs/{created['run']['id']}")
    assert resp.status_code == 200
    again = resp.get_json()
    for key in ("summary", "window", "hours", "switch_events", "overload_alerts", "cleaning"):
        assert again[key] == created[key], key
    assert again["run"]["id"] == created["run"]["id"] and again["run"]["saved"] is True
    later = api.get(f"/api/runs/{created['run']['id']}?window_start=100").get_json()
    assert later["window"]["start"] == 100


def test_unknown_run_is_404(api):
    assert api.get("/api/runs/999999").status_code == 404
    assert api.get("/api/runs/abc").status_code == 404


def test_store_read_failures_are_502(fake):
    class Broken(FakeRunStore):
        def list_runs(self, limit=20):
            raise StoreError("listing runs failed: ZCQL error")

    api = create_app(Forecaster(client_factory=lambda req: fake), store_factory=lambda req: Broken()).test_client()
    resp = api.get("/api/runs")
    assert resp.status_code == 502 and "ZCQL" in resp.get_json()["error"]


def test_sample_csv_download(api):
    resp = api.get("/api/sample")
    assert resp.status_code == 200
    assert resp.headers["Content-Type"].startswith("text/csv")
    assert "sample_test_input.csv" in resp.headers["Content-Disposition"]
    assert resp.data == SAMPLE
    assert resp.headers["Access-Control-Allow-Origin"] == "*"


def test_predict_contract_unchanged(api):
    resp = api.post("/api/predict", data=json.dumps({"rows": sample_rows(5)}), content_type="application/json")
    assert set(resp.get_json()) == {"predictions", "signals", "battery"}


def test_unexpected_store_fault_still_returns_the_forecast(fake):
    store = FakeRunStore(fail_save=RuntimeError("socket closed"))
    api = create_app(Forecaster(client_factory=lambda req: fake), store_factory=lambda req: store).test_client()
    resp = upload(api)
    assert resp.status_code == 200 and len(resp.get_json()["hours"]) == 1000
    assert resp.get_json()["run"]["errors"] == ["saving the run failed: unexpected RuntimeError"]


def test_solar_reaches_the_battery(api):
    from backend.battery import BatteryParams

    body = upload(api).get_json()
    factor = BatteryParams().pv_kw_per_wm2
    assert all(h["pv_kw"] == pytest.approx(factor * h["solar_irradiance_wm2"], abs=0.01) for h in body["hours"])
    assert any(h["pv_kw"] > 0 and h["battery_kw"] < 0 and h["mode"].startswith("Renewable") for h in body["hours"])


def test_predict_battery_uses_solar_and_fills_missing_solar(api):
    rows = sample_rows(3)
    rows[1]["solar_irradiance_wm2"] = None
    battery = api.post("/api/predict", data=json.dumps({"rows": rows}), content_type="application/json").get_json()["battery"]
    assert battery[0]["pv_kw"] == pytest.approx(0.25 * rows[0]["solar_irradiance_wm2"])
    assert battery[1]["pv_kw"] == pytest.approx(0.25 * 8.0)  # the training median, as the features use


@pytest.mark.parametrize("raw, mode, overload", [(160.004, "Renewable Storage Mode", False), (199.996, "Renewable Storage Mode", False),
                                                 (159.996, "Main Grid Mode", False), (200.004, "Renewable Storage Mode", True)])
def test_forecast_and_predict_decide_on_the_same_raw_value(store, raw, mode, overload):
    class Fixed:
        calls = []

        def predict(self, features):
            return [raw] * len(features)

    api = create_app(Forecaster(client_factory=lambda req: Fixed()), store_factory=lambda req: store).test_client()
    rows = [{"timestamp": "2015-07-01 12:00:00", "ambient_temp_c": 25.0, "humidity_pct": 50.0, "solar_irradiance_wm2": 0.0}]
    hour = post_rows(api, {"rows": rows}).get_json()["hours"][0]
    signal = api.post("/api/predict", data=json.dumps({"rows": rows}), content_type="text/plain").get_json()["signals"][0]
    assert (hour["mode"], hour["overload"]) == (signal["mode"], signal["overload"]) == (mode, overload)
    assert hour["prediction_kw"] == raw  # stored unrounded
