"""The QuickML free-tier guard (backend/quota.py): the persistent prediction cache, the monthly call
counter and the demo reserve. QuickML and Stratus are fakes; no test reaches the network."""

import io
import json
from datetime import datetime, timezone

from backend.app import SAMPLE_CSV, create_app
from backend.quota import CACHE_KEY, DEMO_RESERVE_AT, USAGE_KEY, QuickMLLedger
from backend.service import Forecaster
from fakes import FakeRunStore
from test_backend import FakeClient, sample_rows

OCT = lambda: datetime(2026, 10, 27, 6, 0, tzinfo=timezone.utc)  # noqa: E731
NOV = lambda: datetime(2026, 11, 1, 0, 5, tzinfo=timezone.utc)  # noqa: E731


def app_with(store, fake):
    return create_app(Forecaster(client_factory=lambda req: fake), store_factory=lambda req: store).test_client()


def predict(api, rows):
    return api.post("/api/predict", data=json.dumps({"rows": rows}), content_type="text/plain")


def upload(api, data=SAMPLE_CSV.read_bytes()):
    return api.post("/api/forecast", data={"file": (io.BytesIO(data), "x.csv"), "source": "sample"},
                    content_type="multipart/form-data")


def test_identical_inputs_never_reach_quickml_twice_even_after_a_restart():
    store, fake = FakeRunStore(), FakeClient()
    assert predict(app_with(store, fake), sample_rows(24)).status_code == 200
    assert len(fake.calls) == 1 and CACHE_KEY in store.objects
    again = FakeClient()  # a new process: empty memory, same Stratus bucket
    body = predict(app_with(store, again), sample_rows(24)).get_json()
    assert again.calls == [] and len(body["predictions"]) == 24


def test_every_quickml_call_is_counted_for_the_month():
    store, fake = FakeRunStore(), FakeClient()
    api = app_with(store, fake)
    predict(api, sample_rows(24))
    predict(api, sample_rows(30))  # 6 new hours: one more call
    assert len(fake.calls) == 2
    assert json.loads(store.objects[USAGE_KEY])["calls"] == 2
    assert api.get("/api/health").get_json()["quickml_calls_month"] == 2


def test_the_counter_starts_again_each_month():
    store = FakeRunStore()
    QuickMLLedger(store, clock=OCT).add_calls(400)
    assert QuickMLLedger(store, clock=OCT).calls_this_month() == 400
    assert QuickMLLedger(store, clock=NOV).calls_this_month() == 0


def test_past_the_reserve_the_demo_path_answers_429_but_predict_still_runs():
    store, fake = FakeRunStore(), FakeClient()
    QuickMLLedger(store).add_calls(DEMO_RESERVE_AT)
    api = app_with(store, fake)
    resp = upload(api)
    assert resp.status_code == 429 and resp.get_json()["error"] == "demo forecast quota reached"
    assert fake.calls == []
    assert predict(api, sample_rows(24)).status_code == 200  # predict.py's path is never blocked
    assert len(fake.calls) == 1


def test_past_the_reserve_cached_inputs_still_forecast_on_the_demo_path():
    store, fake = FakeRunStore(), FakeClient()
    api = app_with(store, fake)
    assert upload(api).status_code == 200  # priced once, while under the reserve
    QuickMLLedger(store).add_calls(DEMO_RESERVE_AT)
    fresh = FakeClient()
    resp = upload(app_with(store, fresh))  # restarted: served from the persistent cache
    assert resp.status_code == 200 and fresh.calls == []


def test_a_broken_ledger_never_costs_the_prediction():
    class Broken(FakeRunStore):
        def get_json(self, key):
            raise RuntimeError("stratus down")

        def put_json(self, key, value):
            raise RuntimeError("stratus down")

    fake = FakeClient()
    resp = predict(app_with(Broken(), fake), sample_rows(5))
    assert resp.status_code == 200 and len(fake.calls) == 1
