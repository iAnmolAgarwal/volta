import threading
import time

import pandas as pd
import pytest
import requests

from fakes import FakeResponse, FakeSession
from model.quickml_client import ZOHO_TOKEN_URL, ConfigError, PredictionError, QuickMLClient, is_configured

DIRECT = {
    "QUICKML_ENDPOINT_URL": "https://api.catalyst.example/quickml/endpoint",
    "QUICKML_ENDPOINT_KEY": "endpoint-key-SECRET",
    "ZOHO_ORG_ID": "60012345",
    "ZOHO_CLIENT_ID": "1000.CLIENTID",
    "ZOHO_CLIENT_SECRET": "client-secret-SECRET",
    "ZOHO_REFRESH_TOKEN": "refresh-token-SECRET",
}
SECRETS = ["endpoint-key-SECRET", "client-secret-SECRET", "refresh-token-SECRET", "access-token-SECRET"]


def indexed_rows(n: int) -> pd.DataFrame:
    """Feature rows whose only column is their position, so order is checkable exactly."""
    return pd.DataFrame({"i": range(n)})


def echo_index(call) -> FakeResponse:
    return FakeResponse(200, {"predictions": [float(r["i"]) for r in call["json"]["data"]]})


def with_tokens(answer):
    """Wrap a QuickML answer (callable or list of answers; the last repeats) with a Zoho token endpoint."""
    tokens = iter(f"access-token-SECRET-{i}" for i in range(1000))
    answers = answer if isinstance(answer, list) else [answer]
    lock = threading.Lock()

    def handler(call):
        if call["url"] == ZOHO_TOKEN_URL:
            with lock:
                return FakeResponse(200, {"access_token": next(tokens), "expires_in": 3600})
        with lock:
            a = answers.pop(0) if len(answers) > 1 else answers[0]
        return a(call) if callable(a) else a

    return handler


def client(answer, extra: dict | None = None, sleeps: list | None = None, clock=None, env=None):
    session = FakeSession(with_tokens(answer))
    kwargs = {"session": session, "sleep": (sleeps.append if sleeps is not None else lambda s: None)}
    if clock is not None:
        kwargs["clock"] = clock
    return QuickMLClient.from_env({**(DIRECT if env is None else env), **(extra or {})}, **kwargs), session


def predict_calls(session):
    return [c for c in session.calls if c["url"] != ZOHO_TOKEN_URL]


# --- configuration ---------------------------------------------------------


def test_defaults():
    c, _ = client(echo_index)
    assert (c.batch_size, c.concurrency) == (1, 8)


def test_missing_variables_are_named():
    env = {k: v for k, v in DIRECT.items() if k not in ("ZOHO_ORG_ID", "ZOHO_REFRESH_TOKEN")}
    with pytest.raises(ConfigError, match="missing ZOHO_ORG_ID, ZOHO_REFRESH_TOKEN"):
        client(echo_index, env=env)
    assert not is_configured(env) and is_configured(DIRECT)


def test_nothing_configured_raises():
    with pytest.raises(ConfigError, match="QuickML is not configured"):
        client(echo_index, env={})


@pytest.mark.parametrize(
    "extra",
    [{"QUICKML_BATCH_SIZE": "0"}, {"QUICKML_BATCH_SIZE": "two"}, {"QUICKML_RETRIES": "-1"},
     {"QUICKML_TIMEOUT": "0"}, {"QUICKML_CONCURRENCY": "0"}],
)
def test_bad_settings_raise(extra):
    with pytest.raises(ConfigError):
        client(echo_index, extra)


# --- chunking, concurrency and order ----------------------------------------


@pytest.mark.parametrize("batch, sizes", [(1, [1] * 10), (3, [3, 3, 3, 1]), (10, [10]), (50, [10])])
@pytest.mark.parametrize("concurrency", ["1", "4"])
def test_chunks_reassemble_in_order(batch, sizes, concurrency):
    c, session = client(echo_index, {"QUICKML_BATCH_SIZE": str(batch), "QUICKML_CONCURRENCY": concurrency})
    assert c.predict(indexed_rows(10)).tolist() == [float(i) for i in range(10)]
    assert sorted(len(x["json"]["data"]) for x in predict_calls(session)) == sorted(sizes)


def test_requests_really_run_in_parallel():
    active, peak, lock = [0], [0], threading.Lock()

    def slow(call):
        with lock:
            active[0] += 1
            peak[0] = max(peak[0], active[0])
        time.sleep(0.05)
        with lock:
            active[0] -= 1
        return echo_index(call)

    c, _ = client(slow, {"QUICKML_CONCURRENCY": "4"})
    assert c.predict(indexed_rows(12)).tolist() == [float(i) for i in range(12)]
    assert peak[0] == 4


def test_concurrent_requests_share_one_token():
    c, session = client(echo_index, {"QUICKML_CONCURRENCY": "8"})
    c.predict(indexed_rows(40))
    assert sum(x["url"] == ZOHO_TOKEN_URL for x in session.calls) == 1


def test_empty_input_makes_no_requests():
    c, session = client(echo_index)
    assert c.predict(indexed_rows(0)).tolist() == [] and session.calls == []


def test_quickml_sample_response_shape_is_accepted():
    c, _ = client(lambda call: FakeResponse(200, {"status": "success", "result": [123.4]}))
    assert c.predict(indexed_rows(1)).tolist() == [123.4]


@pytest.mark.parametrize(
    "body, message",
    [
        ({"predictions": [1.0, 2.0]}, "expected 1 predictions, got 2 values"),
        ({"prediction": 1.0}, "response keys"),
        ({"predictions": ["abc"]}, "non-numeric"),
        ({"predictions": [float("nan")]}, "NaN or infinite"),
        ({"status": "failure", "result": [1.0]}, "status 'failure'"),
        ([1.0], "expected a JSON object"),
    ],
)
def test_unusable_responses_raise(body, message):
    c, _ = client(lambda call: FakeResponse(200, body))
    with pytest.raises(PredictionError, match=message):
        c.predict(indexed_rows(1))


def test_error_names_the_failing_rows():
    def fail_third_batch(call):
        if call["json"]["data"][0]["i"] == 4:
            return FakeResponse(200, {"predictions": []})
        return echo_index(call)

    c, _ = client(fail_third_batch, {"QUICKML_BATCH_SIZE": "2", "QUICKML_CONCURRENCY": "3"})
    with pytest.raises(PredictionError, match="rows 4-5"):
        c.predict(indexed_rows(8))


# --- timeout and retries ---------------------------------------------------


def test_timeout_is_passed_to_every_request():
    c, session = client(echo_index, {"QUICKML_TIMEOUT": "2.5"})
    c.predict(indexed_rows(3))
    assert {x["timeout"] for x in session.calls} == {2.5}


def test_transient_failures_are_retried_with_backoff():
    sleeps = []
    c, session = client([FakeResponse(503, text="busy"), requests.ConnectionError("reset"), echo_index], sleeps=sleeps)
    assert c.predict(indexed_rows(1)).tolist() == [0.0]
    assert len(predict_calls(session)) == 3 and sleeps == [0.5, 1.0]


def test_retry_after_header_is_respected():
    sleeps = []
    c, _ = client([FakeResponse(429, text="slow down", headers={"Retry-After": "3"}), echo_index], sleeps=sleeps)
    c.predict(indexed_rows(1))
    assert sleeps == [3.0]


def test_persistent_failure_raises_after_all_retries():
    sleeps = []
    c, session = client(requests.Timeout("slow"), {"QUICKML_RETRIES": "2"}, sleeps=sleeps)
    with pytest.raises(PredictionError, match="after 3 attempt"):
        c.predict(indexed_rows(1))
    assert len(predict_calls(session)) == 3 and sleeps == [0.5, 1.0]


def test_client_errors_are_not_retried():
    c, session = client(FakeResponse(400, text='{"message": "bad feature"}'))
    with pytest.raises(PredictionError, match="HTTP 400"):
        c.predict(indexed_rows(1))
    assert len(predict_calls(session)) == 1


def test_non_json_success_raises():
    c, _ = client(FakeResponse(200, body=None, text="<html>oops</html>"))
    with pytest.raises(PredictionError, match="non-JSON"):
        c.predict(indexed_rows(1))


# --- auth, token cache, secrets ---------------------------------------------


def test_sends_quickml_headers_and_caches_the_token():
    c, session = client(echo_index)
    c.predict(indexed_rows(5))
    token_calls = [x for x in session.calls if x["url"] == ZOHO_TOKEN_URL]
    assert len(token_calls) == 1 and len(predict_calls(session)) == 5
    assert token_calls[0]["data"] == {
        "refresh_token": "refresh-token-SECRET",
        "client_id": "1000.CLIENTID",
        "client_secret": "client-secret-SECRET",
        "grant_type": "refresh_token",
    }
    assert "SECRET" not in token_calls[0]["url"]  # credentials go in the body, not the URL
    assert predict_calls(session)[0]["headers"] == {
        "Authorization": "Zoho-oauthtoken access-token-SECRET-0",
        "X-QUICKML-ENDPOINT-KEY": "endpoint-key-SECRET",
        "CATALYST-ORG": "60012345",
        "Environment": "Production",
    }


def test_token_is_refreshed_after_it_expires():
    now = [0.0]
    c, session = client(echo_index, clock=lambda: now[0])
    c.predict(indexed_rows(1))
    now[0] = 3600 - 61  # still inside expiry minus the 60 s margin
    c.predict(indexed_rows(1))
    now[0] = 3600 - 59
    c.predict(indexed_rows(1))
    tokens_used = [x["headers"]["Authorization"] for x in predict_calls(session)]
    assert tokens_used == ["Zoho-oauthtoken access-token-SECRET-0"] * 2 + ["Zoho-oauthtoken access-token-SECRET-1"]


def test_rejected_token_is_refreshed_once():
    c, session = client([FakeResponse(401, text="expired"), echo_index])
    assert c.predict(indexed_rows(1)).tolist() == [0.0]
    assert sum(x["url"] == ZOHO_TOKEN_URL for x in session.calls) == 2


def test_second_rejection_raises_with_a_hint():
    c, _ = client(FakeResponse(401, text="no scope"))
    with pytest.raises(PredictionError, match="QuickML.deployment.READ"):
        c.predict(indexed_rows(1))


def test_token_endpoint_error_raises_without_secrets():
    session = FakeSession(lambda call: FakeResponse(200, {"error": "invalid_code"}))
    c = QuickMLClient.from_env(DIRECT, session=session, sleep=lambda s: None)
    with pytest.raises(PredictionError, match="invalid_code") as exc:
        c.predict(indexed_rows(1))
    assert not any(s in str(exc.value) for s in SECRETS)


def test_secrets_are_redacted_from_errors():
    c, _ = client(lambda call: FakeResponse(400, text=f"bad request, headers were {call['headers']}"))
    with pytest.raises(PredictionError) as exc:
        c.predict(indexed_rows(1))
    message = str(exc.value)
    assert "***" in message and not any(s in message for s in SECRETS)
