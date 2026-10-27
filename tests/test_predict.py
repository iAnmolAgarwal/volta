import os
import re
import shutil
import socket
import subprocess
import sys

import numpy as np
import pandas as pd
import pytest

import predict
from fakes import ENDPOINT_VARS, FakeResponse, fake_predictions
from model.data import ROOT, TARGET, load_test, load_train
from model.features import QUICKML_FEATURES
from model.features import build_features as model_build_features

SAMPLE = ROOT / "sample_test_input.csv"


@pytest.fixture
def no_sleep(monkeypatch):
    monkeypatch.setattr(predict.time, "sleep", lambda s: None)


@pytest.fixture
def use_proxy(proxy_server, no_endpoint_env, monkeypatch):
    monkeypatch.setenv("PREDICT_PROXY_URL", proxy_server.url)
    return proxy_server


def expected(df: pd.DataFrame) -> np.ndarray:
    return np.array(fake_predictions(df.to_dict(orient="records")))


def clean_env(**extra) -> dict:
    env = {k: v for k, v in os.environ.items() if k not in ENDPOINT_VARS and k != "PYTHONPATH"}
    return {**env, **extra}


def run(args, cwd, env) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, *args], cwd=cwd, env=env, capture_output=True, text=True)


# --- the inline feature builder ------------------------------------------------


@pytest.mark.parametrize("load", [load_train, load_test], ids=["train", "test"])
def test_inline_features_equal_the_feature_module(load):
    raw = load().drop(columns=TARGET, errors="ignore")
    raw["timestamp"] = raw["timestamp"].dt.strftime("%Y-%m-%d %H:%M:%S")  # as read from CSV
    pd.testing.assert_frame_equal(predict.build_features(raw), model_build_features(raw)[QUICKML_FEATURES])


def test_inline_features_handle_missing_temperature_like_the_module():
    raw = pd.DataFrame({"timestamp": ["2015-07-01 18:00:00"], "ambient_temp_c": [None],
                        "humidity_pct": [50.0], "solar_irradiance_wm2": [0.0]})
    pd.testing.assert_frame_equal(predict.build_features(raw), model_build_features(raw)[QUICKML_FEATURES])


# --- predict() -------------------------------------------------------------------


def test_one_post_with_all_rows_in_order(use_proxy):
    df = pd.read_csv(SAMPLE)
    preds = predict.predict(df)
    assert isinstance(preds, np.ndarray) and preds.dtype == float and len(preds) == len(df)
    np.testing.assert_allclose(preds, expected(df))
    assert use_proxy.batches == [1000]


def test_shuffled_input_keeps_its_own_order(use_proxy):
    df = pd.read_csv(SAMPLE).sample(frac=1, random_state=1)
    np.testing.assert_allclose(predict.predict(df), expected(df))


def test_missing_weather_goes_out_as_null(monkeypatch, no_endpoint_env):
    sent = {}

    def fake_post(url, json, timeout):
        sent.update(url=url, json=json, timeout=timeout)
        return FakeResponse(200, {"predictions": [100.0]})

    monkeypatch.setenv("PREDICT_PROXY_URL", "https://proxy.example/")
    monkeypatch.setattr(predict.requests, "post", fake_post)
    df = pd.DataFrame({"timestamp": ["2015-07-01 18:00:00"], "ambient_temp_c": [np.nan],
                       "humidity_pct": ["n/a"], "solar_irradiance_wm2": [12]})
    assert predict.predict(df).tolist() == [100.0]
    assert sent["url"] == "https://proxy.example/api/predict" and sent["timeout"] == 120
    assert sent["json"] == {"rows": [{"timestamp": "2015-07-01 18:00:00", "ambient_temp_c": None,
                                      "humidity_pct": None, "solar_irradiance_wm2": 12.0}]}


def test_server_errors_are_retried_then_raise(use_proxy, no_sleep, capsys):
    use_proxy.status = 502
    with pytest.raises(predict.PredictionError, match="failed after 3 attempt.*HTTP 502"):
        predict.predict(load_test())
    assert len(use_proxy.batches) == predict.ATTEMPTS == 3
    assert capsys.readouterr().err.count("retrying in") == 2  # one stderr line per retry


def test_backoff_is_10_then_30_seconds(use_proxy, monkeypatch):
    waits = []
    monkeypatch.setattr(predict.time, "sleep", waits.append)
    use_proxy.status = 503
    with pytest.raises(predict.PredictionError):
        predict.predict(load_test())
    assert waits == [10, 30]


@pytest.mark.parametrize("failures", [1, 2])
def test_failures_then_success_returns_the_predictions(monkeypatch, no_sleep, failures):
    monkeypatch.setenv("PREDICT_PROXY_URL", "https://proxy.example")
    calls = []

    def flaky(url, json=None, timeout=None):
        calls.append(1)
        if len(calls) <= failures:
            raise predict.requests.ReadTimeout("read timed out")
        return FakeResponse(200, {"predictions": [100.0] * len(json["rows"])})

    monkeypatch.setattr(predict.requests, "post", flaky)
    assert predict.predict(load_test()).tolist() == [100.0] * len(load_test())
    assert len(calls) == failures + 1


def test_timeouts_on_every_attempt_raise_loudly(monkeypatch, no_sleep):
    monkeypatch.setenv("PREDICT_PROXY_URL", "https://proxy.example")

    def dead(url, json=None, timeout=None):
        raise predict.requests.ConnectionError("connection refused")

    monkeypatch.setattr(predict.requests, "post", dead)
    with pytest.raises(predict.PredictionError, match="failed after 3 attempt.*ConnectionError"):
        predict.predict(load_test())


@pytest.mark.parametrize("status", [408, 429])
def test_gateway_timeouts_and_429_are_retried(use_proxy, no_sleep, status):
    use_proxy.status = status
    with pytest.raises(predict.PredictionError, match=f"failed after 3 attempt.*HTTP {status}"):
        predict.predict(load_test())
    assert len(use_proxy.batches) == 3


def test_client_errors_are_not_retried(use_proxy, no_sleep):
    use_proxy.status = 400
    with pytest.raises(predict.PredictionError, match="HTTP 400"):
        predict.predict(load_test())
    assert len(use_proxy.batches) == 1


@pytest.mark.parametrize(
    "body, message",
    [({"predictions": [1.0]}, "expected 3 predictions for rows 0-2, got 1 values"), ({"error": "x"}, "no 'predictions' list"),
     ({"predictions": [1, "a", 2]}, "non-numeric"), ({"predictions": [1, None, 2]}, "non-numeric"),
     ({"predictions": [1, float("inf"), 2]}, "NaN or infinite")],
)
def test_unusable_responses_raise(monkeypatch, no_endpoint_env, body, message):
    monkeypatch.setenv("PREDICT_PROXY_URL", "https://proxy.example")
    monkeypatch.setattr(predict.requests, "post", lambda url, json, timeout: FakeResponse(200, body))
    with pytest.raises(predict.PredictionError, match=message):
        predict.predict(load_test().head(3))


def test_no_proxy_configured_raises(no_endpoint_env, monkeypatch):
    monkeypatch.setattr(predict, "DEFAULT_PROXY_URL", "")
    with pytest.raises(predict.PredictionError, match="no proxy configured"):
        predict.predict(load_test())


def test_bad_input_fails_before_any_request(no_endpoint_env, monkeypatch):
    monkeypatch.setattr(predict.requests, "post", lambda *a, **k: pytest.fail("should not POST"))
    with pytest.raises(ValueError, match="missing columns: humidity_pct"):
        predict.predict(load_test().drop(columns="humidity_pct"))
    with pytest.raises(ValueError, match="no readable timestamps"):
        predict.predict(load_test().head(2).assign(timestamp=["garbage", None]))


def test_self_test_passes_against_the_fake_proxy(use_proxy, monkeypatch, capsys):
    import test_eval

    monkeypatch.chdir(ROOT)
    test_eval.test_student_submission()
    assert capsys.readouterr().out.rstrip().endswith("SUCCESS")


# --- CLI and the copy-alone run -----------------------------------------------------


def test_copied_alone_it_passes_the_self_test(proxy_server, tmp_path):
    for name in ["predict.py", "test_eval.py", "sample_test_input.csv"]:
        shutil.copy(ROOT / name, tmp_path / name)
    env = clean_env(PREDICT_PROXY_URL=proxy_server.url)

    assert run(["-c", "import model"], tmp_path, env).returncode != 0  # the repo is out of reach

    result = run(["test_eval.py"], tmp_path, env)
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.rstrip().endswith("SUCCESS")

    result = run(["predict.py", "--input", "sample_test_input.csv", "--output", "p.csv"], tmp_path, env)
    assert result.returncode == 0, result.stderr
    assert (tmp_path / "p.csv").read_text().startswith("timestamp,target_demand_kw\n")


def test_cli_writes_the_contract_format(proxy_server, tmp_path):
    out = tmp_path / "p.csv"
    result = run(["predict.py", "--input", str(SAMPLE), "--output", str(out)], ROOT,
                 clean_env(PREDICT_PROXY_URL=proxy_server.url))
    assert result.returncode == 0, result.stderr

    lines = out.read_text().splitlines()
    assert lines[0] == "timestamp,target_demand_kw"
    raw = pd.read_csv(SAMPLE, dtype=str)
    assert len(lines) == len(raw) + 1
    stamps, values = zip(*(line.split(",") for line in lines[1:]))
    assert list(stamps) == raw["timestamp"].tolist()  # original strings, original order
    assert all(re.fullmatch(r"\d+\.\d{2}", v) for v in values)
    np.testing.assert_allclose([float(v) for v in values], expected(pd.read_csv(SAMPLE)), atol=0.005)


def test_cli_fails_loudly_when_the_proxy_is_down(tmp_path):
    with socket.socket() as s:  # a port with nothing listening
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    out = tmp_path / "p.csv"
    result = run(["predict.py", "--input", str(SAMPLE), "--output", str(out)], ROOT,
                 clean_env(PREDICT_PROXY_URL=f"http://127.0.0.1:{port}"))
    assert result.returncode == 1
    assert "predict.py: error:" in result.stderr and "ConnectionError" in result.stderr
    assert not out.exists()


def test_cli_without_a_proxy_exits_non_zero(no_endpoint_env, monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(predict, "DEFAULT_PROXY_URL", "")
    out = tmp_path / "p.csv"
    assert predict.main(["--input", str(SAMPLE), "--output", str(out)]) == 1
    assert "no proxy configured" in capsys.readouterr().err
    assert not out.exists()


def test_cli_without_arguments_previews_the_sample(use_proxy, monkeypatch, capsys):
    monkeypatch.chdir(ROOT)
    assert predict.main([]) == 0
    assert "Generated 1000 predictions" in capsys.readouterr().out


# --- robustness: missing values, extra columns, unsorted input ----------------------


@pytest.fixture
def capture(monkeypatch, no_endpoint_env):
    """Fake proxy via requests.post: records the rows sent and answers fake predictions."""
    sent = []

    def fake_post(url, json, timeout):
        sent.append(json["rows"])
        return FakeResponse(200, {"predictions": fake_predictions(json["rows"])})

    monkeypatch.setenv("PREDICT_PROXY_URL", "https://proxy.example")
    monkeypatch.setattr(predict.requests, "post", fake_post)
    return sent


def frame(stamps, temps, hums=None):
    return pd.DataFrame({"timestamp": stamps, "ambient_temp_c": temps,
                         "humidity_pct": hums if hums is not None else [50.0] * len(stamps),
                         "solar_irradiance_wm2": [0.0] * len(stamps)})


def test_gaps_are_interpolated_in_time(capture):
    df = frame(["2015-07-01 00:00:00", "2015-07-01 01:00:00", "2015-07-01 03:00:00"], [20.0, np.nan, 32.0])
    predict.predict(df)
    assert [r["ambient_temp_c"] for r in capture[0]] == [20.0, 24.0, 32.0]  # 1 h of a 3 h gap


def test_edges_are_back_and_forward_filled(capture):
    df = frame([f"2015-07-01 0{h}:00:00" for h in range(4)], [np.nan, 25.0, 27.0, np.nan],
               hums=[np.nan, np.nan, 40.0, np.nan])
    predict.predict(df)
    assert [r["ambient_temp_c"] for r in capture[0]] == [25.0, 25.0, 27.0, 27.0]
    assert [r["humidity_pct"] for r in capture[0]] == [40.0, 40.0, 40.0, 40.0]


def test_unsorted_input_interpolates_by_time_and_keeps_row_order(capture):
    df = frame(["2015-07-01 02:00:00", "2015-07-01 00:00:00", "2015-07-01 01:00:00"], [30.0, 20.0, np.nan])
    preds = predict.predict(df)
    assert [r["timestamp"] for r in capture[0]] == df["timestamp"].tolist()
    assert [r["ambient_temp_c"] for r in capture[0]] == [30.0, 20.0, 25.0]
    np.testing.assert_allclose(preds, fake_predictions(capture[0]))


def test_a_column_with_no_values_stays_null(capture):
    df = frame(["2015-07-01 00:00:00", "2015-07-01 01:00:00"], [np.nan, np.nan])
    predict.predict(df)
    assert [r["ambient_temp_c"] for r in capture[0]] == [None, None]


def test_extra_columns_and_any_column_order(capture):
    df = load_test().head(48)
    df["timestamp"] = df["timestamp"].dt.strftime("%Y-%m-%d %H:%M:%S")
    base = predict.predict(df)
    messy = df.assign(site="A", target_demand_kw=999.0)[
        ["solar_irradiance_wm2", "site", "humidity_pct", "timestamp", "target_demand_kw", "ambient_temp_c"]]
    np.testing.assert_allclose(predict.predict(messy), base)
    assert set(capture[1][0]) == set(predict.INPUT_COLUMNS)  # extra columns are not sent


def test_unsorted_input_with_gaps_matches_the_sorted_answer(capture):
    df = load_test().head(72)
    df["timestamp"] = df["timestamp"].dt.strftime("%Y-%m-%d %H:%M:%S")
    df.loc[df.index[5:9], "ambient_temp_c"] = np.nan
    sorted_preds = predict.predict(df)
    shuffled = df.sample(frac=1, random_state=3)
    np.testing.assert_allclose(predict.predict(shuffled), pd.Series(sorted_preds, index=df.index)[shuffled.index])


# --- portability (M15): column names, timestamps, chunking --------------------------


def test_column_names_are_matched_ignoring_case_and_spaces(capture):
    df = frame(["2015-07-01 00:00:00", "2015-07-01 01:00:00"], [25.0, 26.0])
    df.columns = [" Timestamp", "AMBIENT_TEMP_C ", "Humidity_Pct", " solar_irradiance_wm2 "]
    predict.predict(df)
    assert [r["ambient_temp_c"] for r in capture[0]] == [25.0, 26.0]


def test_a_missing_timestamp_is_inferred_from_its_neighbours_and_kept_in_the_output(capture, tmp_path, monkeypatch):
    df = frame(["2015-07-01 17:00:00", None, "2015-07-01 19:00:00"], [30.0, 31.0, 32.0])
    predict.predict(df)
    assert [r["timestamp"] for r in capture[0]] == ["2015-07-01 17:00:00", "2015-07-01 18:00:00", "2015-07-01 19:00:00"]
    src, out = tmp_path / "in.csv", tmp_path / "out.csv"
    df.to_csv(src, index=False)
    assert predict.main(["--input", str(src), "--output", str(out)]) == 0
    written = pd.read_csv(out, keep_default_na=False)
    assert written["timestamp"].tolist() == ["2015-07-01 17:00:00", "", "2015-07-01 19:00:00"]  # the original values


def test_day_first_timestamps_are_read_only_when_not_iso(capture):
    df = frame(["16/06/2015 18:00", "05-06-2015 07:00", "2015-06-05 07:00:00"], [30.0, 25.0, 25.0])
    predict.predict(df)
    assert [r["timestamp"] for r in capture[0]] == ["2015-06-16 18:00:00", "2015-06-05 07:00:00", "2015-06-05 07:00:00"]


def test_utc_offsets_are_dropped_keeping_the_clock_time(capture):
    predict.predict(frame(["2015-06-16T18:00:00+05:30", "2015-06-16T19:00:00Z"], [30.0, 30.0]))
    assert [r["timestamp"] for r in capture[0]] == ["2015-06-16 18:00:00", "2015-06-16 19:00:00"]


def test_2500_rows_go_in_chunks_of_1000_and_come_back_in_order(monkeypatch):
    monkeypatch.setenv("PREDICT_PROXY_URL", "https://proxy.example")
    sizes = []

    def fake_post(url, json=None, timeout=None):
        sizes.append(len(json["rows"]))
        return FakeResponse(200, {"predictions": [float(r["ambient_temp_c"]) for r in json["rows"]]})

    monkeypatch.setattr(predict.requests, "post", fake_post)
    stamps = pd.date_range("2015-06-01", periods=2500, freq="h").strftime("%Y-%m-%d %H:%M:%S")
    temps = np.arange(2500, dtype=float) / 100
    preds = predict.predict(frame(list(stamps), list(temps)))
    assert sizes == [1000, 1000, 500]
    np.testing.assert_allclose(preds, temps)


def test_a_single_row_works(capture):
    predict.predict(frame(["2015-07-01 12:00:00"], [33.0]))
    assert len(capture) == 1 and len(capture[0]) == 1


def test_a_shuffled_frame_is_answered_in_its_own_order(capture):
    df = frame(["2015-07-01 02:00:00", "2015-07-01 00:00:00", "2015-07-01 01:00:00"], [22.0, 20.0, np.nan])
    predict.predict(df)
    sent = capture[0]
    assert [r["timestamp"] for r in sent] == ["2015-07-01 02:00:00", "2015-07-01 00:00:00", "2015-07-01 01:00:00"]
    assert sent[2]["ambient_temp_c"] == 21.0  # interpolated in time, sent in input order
