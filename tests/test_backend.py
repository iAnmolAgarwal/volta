import json

import pandas as pd
import pytest

from backend.app import create_app
from backend.battery import BatteryParams
from backend.controller import decide
from backend.service import MAX_ROWS, Forecaster, PredictionCache
from fakes import fake_model, fake_predictions
from model.data import load_test
from model.quickml_client import ConfigError, PredictionError

SECRET_ENV = {
    "QUICKML_ENDPOINT_URL": "https://api.catalyst.example/quickml/endpoint",
    "QUICKML_ENDPOINT_KEY": "endpoint-key-SECRET",
    "ZOHO_ORG_ID": "60012345",
    "ZOHO_CLIENT_ID": "1000.CLIENTID-SECRET",
    "ZOHO_CLIENT_SECRET": "client-secret-SECRET",
    "ZOHO_REFRESH_TOKEN": "refresh-token-SECRET",
}


class FakeClient:
    """Stands in for QuickMLClient; records how many rows each call carried."""

    def __init__(self, fail: Exception | None = None, offset: float = 0.0):
        self.calls, self.fail, self.offset = [], fail, offset

    def predict(self, features: pd.DataFrame):
        if self.fail:
            raise self.fail
        self.calls.append(len(features))
        return [fake_model(r) + self.offset for r in features.to_dict(orient="records")]


def sample_rows(n: int = 24) -> list[dict]:
    df = load_test().head(n)
    df["timestamp"] = df["timestamp"].dt.strftime("%Y-%m-%d %H:%M:%S")
    return df.to_dict(orient="records")


@pytest.fixture
def fake():
    return FakeClient()


@pytest.fixture
def api(fake):
    return create_app(Forecaster(client_factory=lambda req: fake)).test_client()


def post(api, body):
    return api.post("/api/predict", data=json.dumps(body), content_type="application/json")


# --- /api/predict ---------------------------------------------------------------


def test_predict_returns_everything_in_input_order(api):
    rows = sample_rows(48)[::-1]  # reversed: order must follow the request, not time
    resp = post(api, {"rows": rows})
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["predictions"] == pytest.approx(fake_predictions(rows))
    assert [s["timestamp"] for s in body["signals"]] == [r["timestamp"] for r in rows]
    for s, p in zip(body["signals"], body["predictions"]):
        assert {"mode": s["mode"], "overload": s["overload"]} == decide(s["timestamp"], p)
    assert len(body["battery"]) == 48
    assert [b["mode"] for b in body["battery"]] == [s["mode"] for s in body["signals"]]
    assert body["battery"][0]["soc_start"] == BatteryParams().start_soc


def test_repeated_rows_cost_nothing(api, fake):
    rows = sample_rows(24)
    post(api, {"rows": rows})
    first = sum(fake.calls)
    assert first == len({json.dumps(r, sort_keys=True) for r in rows}) or first <= 24
    post(api, {"rows": rows})
    assert sum(fake.calls) == first  # second request served entirely from the cache


def test_duplicate_feature_vectors_reach_quickml_once(api, fake):
    cool_night = {"ambient_temp_c": 15.0, "humidity_pct": 60.0, "solar_irradiance_wm2": 0.0}
    rows = [{"timestamp": f"2015-07-0{d} 0{h}:00:00", **cool_night} for d in range(1, 4) for h in range(4)]
    resp = post(api, {"rows": rows})
    assert resp.status_code == 200 and fake.calls == [1]  # 12 rows, one distinct vector


def test_cache_key_is_rounded_to_1e_6():
    fake = FakeClient()
    fc = Forecaster(client_factory=lambda req: fake)
    base = {"timestamp": "2015-07-01 12:00:00", "humidity_pct": 50.0, "solar_irradiance_wm2": 100.0}
    fc.forecast({"rows": [{**base, "ambient_temp_c": 30.0}]})
    fc.forecast({"rows": [{**base, "ambient_temp_c": 30.0000000001}]})
    fc.forecast({"rows": [{**base, "ambient_temp_c": 30.00001}]})
    assert fake.calls == [1, 1]


def test_cache_evicts_least_recently_used():
    cache = PredictionCache(maxsize=2)
    cache.put_many({"a": 1.0, "b": 2.0})
    cache.get_many(["a"])
    cache.put_many({"c": 3.0})
    assert cache.get_many(["a", "b", "c"]) == {"a": 1.0, "c": 3.0}


def test_null_weather_is_filled(api):
    row = {"timestamp": "2015-07-01 12:00:00", "ambient_temp_c": None, "humidity_pct": None,
           "solar_irradiance_wm2": None}
    assert post(api, {"rows": [row]}).status_code == 200


@pytest.mark.parametrize(
    "body, status, needle",
    [
        ({"data": []}, 400, "rows"),
        ({"rows": []}, 400, "empty"),
        ({"rows": ["x"]}, 400, "not an object"),
        ({"rows": [{"timestamp": "yesterday", "ambient_temp_c": 1, "humidity_pct": 1, "solar_irradiance_wm2": 1}]},
         400, "row 0: timestamp"),
        ({"rows": [{"timestamp": 1435752000, "ambient_temp_c": 1}]}, 400, "row 0: timestamp"),
        ({"rows": [{"timestamp": "2015-07-01 12:00:00", "ambient_temp_c": "hot"}]}, 400, "ambient_temp_c"),
        ({"rows": [{"timestamp": "2015-07-01 12:00:00", "humidity_pct": True}]}, 400, "humidity_pct"),
    ],
)
def test_invalid_requests_are_rejected(api, body, status, needle):
    resp = post(api, body)
    assert resp.status_code == status
    assert needle in json.dumps(resp.get_json())


def test_too_many_rows(api):
    rows = sample_rows(1) * (MAX_ROWS + 1)
    resp = post(api, {"rows": rows})
    assert resp.status_code == 413 and "at most 2000" in resp.get_json()["error"]


def test_exactly_the_limit_is_accepted(api):
    assert post(api, {"rows": sample_rows(1) * MAX_ROWS}).status_code == 200


def test_json_sent_as_text_plain_is_accepted(api):
    # browsers send JSON as text/plain to skip the CORS preflight the Catalyst gateway mishandles
    resp = api.post("/api/predict", data=json.dumps({"rows": sample_rows(3)}), content_type="text/plain;charset=UTF-8")
    assert resp.status_code == 200 and len(resp.get_json()["predictions"]) == 3


def test_mixed_utc_offsets_are_a_400_not_a_500(api):
    rows = sample_rows(2)
    rows[0]["timestamp"] += "+05:30"
    rows[1]["timestamp"] += "Z"
    resp = post(api, {"rows": rows})
    assert resp.status_code == 400 and "UTC offset" in resp.get_json()["error"]


def test_non_json_body(api):
    resp = api.post("/api/predict", data="rows=1", content_type="text/plain")
    assert resp.status_code == 400 and resp.is_json


def test_not_configured_is_503():
    def unconfigured(req):
        raise ConfigError("QuickML is not configured: missing QUICKML_ENDPOINT_URL")

    api = create_app(Forecaster(client_factory=unconfigured)).test_client()
    resp = post(api, {"rows": sample_rows(2)})
    assert resp.status_code == 503 and "not configured" in resp.get_json()["error"]


def test_quickml_failure_is_502():
    api = create_app(Forecaster(client_factory=lambda req: FakeClient(fail=PredictionError("HTTP 500")))).test_client()
    assert post(api, {"rows": sample_rows(2)}).status_code == 502


def test_negative_prediction_is_502():
    api = create_app(Forecaster(client_factory=lambda req: FakeClient(offset=-1000))).test_client()
    resp = post(api, {"rows": sample_rows(2)})
    assert resp.status_code == 502 and "unusable prediction" in resp.get_json()["error"]


# --- /api/health and plumbing --------------------------------------------------------


def test_health_without_credentials(api, monkeypatch):
    for k in SECRET_ENV:
        monkeypatch.delenv(k, raising=False)
    resp = api.get("/api/health")
    assert resp.status_code == 200
    assert resp.get_json() == {"status": "ok", "version": "dev", "quickml_configured": False, "catalyst_context": False,
                               "gateway_timeout": None}
    assert api.get("/api/health", headers={"X-ZC-ProjectId": "1"}).get_json()["catalyst_context"] is True


def test_health_with_credentials_reveals_nothing(api, monkeypatch):
    for k, v in SECRET_ENV.items():
        monkeypatch.setenv(k, v)
    resp = api.get("/api/health")
    assert resp.get_json()["quickml_configured"] is True
    text = resp.get_data(as_text=True)
    assert not any(v in text for v in SECRET_ENV.values())


def test_unknown_routes_answer_json(api):
    assert api.get("/nope").status_code == 404 and api.get("/nope").is_json
    assert api.get("/api/predict").status_code == 405


def test_cors_headers(api):
    resp = api.options("/api/predict")
    assert resp.headers["Access-Control-Allow-Origin"] == "*"
    assert "Content-Type" in resp.headers["Access-Control-Allow-Headers"]


# --- choosing the QuickML path and the SDK transport ------------------------------


class FakeRequest:
    def __init__(self, headers: dict):
        self.headers = headers


IN_CATALYST = FakeRequest({"X-ZC-ProjectId": "93853000000013050"})


@pytest.fixture
def bare_env(monkeypatch):
    import backend.service as service

    for k in [*SECRET_ENV, "QUICKML_BATCH_SIZE", "QUICKML_CONCURRENCY"]:
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(service, "_direct_client", None)
    return service


def test_no_quickml_settings_is_a_config_error(bare_env):
    with pytest.raises(ConfigError, match="set QUICKML_ENDPOINT_KEY"):
        bare_env.make_client(IN_CATALYST)
    assert bare_env.quickml_configured() is False


def test_endpoint_key_inside_catalyst_uses_the_sdk(bare_env, monkeypatch):
    built = []
    monkeypatch.setattr(bare_env, "SdkTransport", lambda key, req: built.append((key, req)) or "sdk")
    monkeypatch.setenv("QUICKML_ENDPOINT_KEY", "endpoint-key-SECRET")
    c = bare_env.make_client(IN_CATALYST)
    assert built == [("endpoint-key-SECRET", IN_CATALYST)]
    assert (c.transport, c.batch_size, c.concurrency) == ("sdk", 1000, 1)
    assert bare_env.quickml_configured() is True


def test_endpoint_key_outside_catalyst_explains_why(bare_env, monkeypatch):
    monkeypatch.setenv("QUICKML_ENDPOINT_KEY", "endpoint-key-SECRET")
    with pytest.raises(ConfigError, match="X-ZC"):
        bare_env.make_client(FakeRequest({}))


def test_full_direct_config_outside_catalyst_uses_rest(bare_env, monkeypatch):
    for k, v in SECRET_ENV.items():
        monkeypatch.setenv(k, v)
    c = bare_env.make_client(None)
    assert type(c.transport).__name__ == "QuickMLTransport" and bare_env.make_client(None) is c


def test_health_with_only_the_key_reveals_nothing(api, bare_env, monkeypatch):
    monkeypatch.setenv("QUICKML_ENDPOINT_KEY", "endpoint-key-SECRET")
    resp = api.get("/api/health")
    assert resp.get_json()["quickml_configured"] is True and "SECRET" not in resp.get_data(as_text=True)


class FakeQuickML:
    def __init__(self, fail=None):
        self.fail, self.calls = fail, []
        outer = self

        class Requester:
            def request(self, **kwargs):
                outer.calls.append(("request", kwargs))
                if outer.fail:
                    raise outer.fail

                class Resp:
                    response_json = {"result": [float(i) for i in range(len(kwargs["json"]["data"]))]}

                return Resp()

        self._requester = Requester()

    def predict(self, key, data):
        self.calls.append(("predict", key, data))
        return {"result": [42.0]}


@pytest.fixture
def sdk(monkeypatch):
    import zcatalyst_sdk

    fake_qm = FakeQuickML()
    monkeypatch.setattr(zcatalyst_sdk, "initialize", lambda req: type("App", (), {"quick_ml": lambda self: fake_qm})())
    return fake_qm


def test_sdk_transport_sends_a_whole_batch_in_one_call(sdk, monkeypatch):
    monkeypatch.delenv("ZOHO_ORG_ID", raising=False)
    from backend.quickml_sdk import SdkTransport
    from model.quickml_client import QuickMLClient

    client = QuickMLClient(SdkTransport("endpoint-key-SECRET", IN_CATALYST), batch_size=1000)
    preds = client.predict(pd.DataFrame({"blk_day": [1, 0, 0], "cool_24": [1.0, 2.0, 3.0]}))
    assert preds.tolist() == [0.0, 1.0, 2.0]
    (kind, kwargs), = sdk.calls
    assert kind == "request" and kwargs["path"] == "/endpoints/predict"
    assert kwargs["json"] == {"data": [{"blk_day": 1, "cool_24": 1.0}, {"blk_day": 0, "cool_24": 2.0},
                                       {"blk_day": 0, "cool_24": 3.0}]}
    assert kwargs["headers"] == {"X-QUICKML-ENDPOINT-KEY": "endpoint-key-SECRET", "CATALYST-ORG": "60093344122",
                                 "Environment": "Development"}


def test_sdk_transport_headers_follow_env_and_gateway(sdk, monkeypatch):
    from backend.quickml_sdk import SdkTransport

    monkeypatch.setenv("ZOHO_ORG_ID", "123")
    req = FakeRequest({"X-ZC-ProjectId": "1", "X-ZC-Environment": "Production"})
    SdkTransport("k", req)({"data": {"cool_24": 1.0}})  # a single dict goes the same way
    (kind, kwargs), = sdk.calls
    assert kwargs["json"] == {"data": {"cool_24": 1.0}}
    assert (kwargs["headers"]["CATALYST-ORG"], kwargs["headers"]["Environment"]) == ("123", "Production")


def test_sdk_errors_become_prediction_errors_without_the_key(sdk):
    from zcatalyst_sdk.exceptions import CatalystAPIError

    from backend.quickml_sdk import SdkTransport

    sdk.fail = CatalystAPIError("NOT_PUBLISHED", "endpoint endpoint-key-SECRET is not published")
    with pytest.raises(PredictionError, match="NOT_PUBLISHED") as exc:
        SdkTransport("endpoint-key-SECRET", IN_CATALYST)({"data": [{"cool_24": 1.0}]})
    assert "endpoint-key-SECRET" not in str(exc.value)


def test_sdk_network_errors_become_prediction_errors(sdk):
    import requests

    from backend.quickml_sdk import SdkTransport

    # seen live: the SDK's request to api.catalyst.zoho.in timed out and escaped as a bare 500
    sdk.fail = requests.ReadTimeout("HTTPSConnectionPool(host='api.catalyst.zoho.in', port=443): Read timed out.")
    with pytest.raises(PredictionError, match="QuickML did not answer: ReadTimeout"):
        SdkTransport("endpoint-key-SECRET", IN_CATALYST)({"data": [{"cool_24": 1.0}]})


# --- the server's one extra QuickML try (backend/quickml_sdk.py) ------------------

class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def test_a_network_error_gets_one_more_try_when_the_budget_allows():
    from backend.quickml_sdk import once_more_on_network_error
    clock, calls = Clock(), []

    def call():
        calls.append(1)
        if len(calls) == 1:
            clock.t += 30  # a read timeout
            raise TimeoutError("read timed out")
        return "ok"

    assert once_more_on_network_error(call, (TimeoutError,), budget_s=110, clock=clock) == "ok"
    assert len(calls) == 2


def test_no_second_try_when_it_would_outlast_the_gateway():
    from backend.quickml_sdk import once_more_on_network_error
    clock, calls = Clock(), []

    def call():
        calls.append(1)
        clock.t += 30
        raise TimeoutError("read timed out")

    with pytest.raises(TimeoutError):
        once_more_on_network_error(call, (TimeoutError,), budget_s=50, clock=clock)
    assert len(calls) == 1


def test_two_network_errors_raise_and_other_errors_are_not_retried():
    from backend.quickml_sdk import once_more_on_network_error
    calls = []

    def dead():
        calls.append(1)
        raise ConnectionError("refused")

    with pytest.raises(ConnectionError):
        once_more_on_network_error(dead, (ConnectionError,), budget_s=1000, clock=Clock())
    assert len(calls) == 2
    calls.clear()

    def refused():  # a QuickML 4xx comes back as an SDK error, not a network error
        calls.append(1)
        raise ValueError("ORGID_HEADER_UNAVAILABLE")

    with pytest.raises(ValueError):
        once_more_on_network_error(refused, (ConnectionError,), budget_s=1000, clock=Clock())
    assert len(calls) == 1


@pytest.mark.parametrize("raw, budget", [("", 50.0), ("120", 110.0), ("300000", 290.0), ("junk", 50.0), ("0", 50.0)])
def test_gateway_budget_reads_seconds_or_milliseconds(raw, budget):
    from backend.quickml_sdk import gateway_budget_s
    assert gateway_budget_s({"CATALYST_MAX_TIMEOUT": raw}) == budget
