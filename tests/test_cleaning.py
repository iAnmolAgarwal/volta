
import pandas as pd
import pytest

from backend.cleaning import FIXES, CleaningError, clean, read_csv, rows_frame
from backend.service import MAX_ROWS
from model.features import FILL_VALUES


def frame(rows):
    return rows_frame(rows)


def row(ts, temp=25.0, hum=50.0, sol=100.0):
    return {"timestamp": ts, "ambient_temp_c": temp, "humidity_pct": hum, "solar_irradiance_wm2": sol}


def fixes(report):
    return {f["code"]: f["count"] for f in report["fixes"]}


def stamps(df):
    return df["timestamp"].dt.strftime("%Y-%m-%d %H:%M").tolist()


def test_clean_input_passes_through_unchanged():
    rows = [row(f"2015-06-16 {h:02d}:00:00", 20 + h) for h in range(5)]
    out, report = clean(frame(rows))
    assert stamps(out) == [f"2015-06-16 {h:02d}:00" for h in range(5)]
    assert out["ambient_temp_c"].tolist() == [20, 21, 22, 23, 24]
    assert report["rows_in"] == report["rows_out"] == 5
    assert report["rejected"] == [] and report["rejected_count"] == 0
    assert set(fixes(report).values()) == {0}
    assert [f["code"] for f in report["fixes"]] == list(FIXES)  # every fix is reported, zero or not


@pytest.mark.parametrize(
    "values, label",
    [
        (["2015-06-16 15:00:00", "2015-06-16 16:00:00"], "ISO 8601"),
        (["2015-06-16T15:00", "2015-06-16T16:00"], "ISO 8601"),
        (["16/06/2015 15:00", "16/06/2015 16:00"], "DD/MM/YYYY HH:MM"),
        (["16-06-2015 15:00", "16-06-2015 16:00"], "DD/MM/YYYY HH:MM"),
        (["16/06/2015 15:00:00", "16/06/2015 16:00:00"], "DD/MM/YYYY HH:MM:SS"),
        (["06/16/2015 15:00", "06/16/2015 16:00"], "MM/DD/YYYY HH:MM"),
        (["06/16/2015 03:00 PM", "06/16/2015 04:00 PM"], "MM/DD/YYYY hh:MM AM/PM"),
        (["2015/06/16 15:00", "2015/06/16 16:00"], "ISO 8601"),
    ],
)
def test_timestamp_formats(values, label):
    out, report = clean(frame([row(v) for v in values]))
    assert stamps(out) == ["2015-06-16 15:00", "2015-06-16 16:00"]
    assert report["timestamp_formats"] == {label: 2}


def test_ambiguous_slashes_read_day_first_and_one_format_per_column():
    # 05/06 could be 5 June or 6 May; 13/06 settles the column as day-first.
    out, report = clean(frame([row("05/06/2015 10:00"), row("13/06/2015 10:00")]))
    assert stamps(out) == ["2015-06-05 10:00", "2015-06-13 10:00"]
    assert report["timestamp_formats"] == {"DD/MM/YYYY HH:MM": 2}
    out, _ = clean(frame([row("05/06/2015 10:00"), row("06/13/2015 10:00")]))  # month-first reads both
    assert stamps(out) == ["2015-05-06 10:00", "2015-06-13 10:00"]


def test_utc_offset_dropped_keeping_local_clock_time():
    out, report = clean(frame([row("2015-06-16T19:00:00+05:30"), row("2015-06-16T20:00:00Z")]))
    assert stamps(out) == ["2015-06-16 19:00", "2015-06-16 20:00"]
    assert fixes(report)["dropped_utc_offset"] == 2


def test_rows_without_a_usable_timestamp_are_rejected_with_reasons():
    rows = [row("2015-06-16 10:00"), row(""), row(None), row("   "), row("yesterday"), row("2015-06-16 11:00")]
    out, report = clean(frame(rows))
    assert len(out) == 2
    assert fixes(report)["rejected_no_timestamp"] == 3
    assert fixes(report)["rejected_bad_timestamp"] == 1
    assert report["rejected"] == [
        {"row": 2, "reason": "no timestamp"},
        {"row": 3, "reason": "no timestamp"},
        {"row": 4, "reason": "no timestamp"},
        {"row": 5, "reason": "unreadable timestamp 'yesterday'"},
    ]
    assert report["rows_in"] == 6 and report["rows_out"] == 2


@pytest.mark.parametrize("temp, kept", [(60.0, True), (60.01, False), (-60.0, True), (-60.01, False), (999, False)])
def test_impossible_temperature_boundaries(temp, kept):
    out, report = clean(frame([row("2015-06-16 10:00", temp), row("2015-06-16 11:00", 20.0)]))
    assert (len(out) == 2) is kept
    assert fixes(report)["rejected_impossible_temp"] == (0 if kept else 1)
    if not kept:
        assert report["rejected"][0]["row"] == 1
        assert "impossible temperature" in report["rejected"][0]["reason"]


def test_humidity_and_solar_are_clipped():
    rows = [row("2015-06-16 10:00", hum=-5, sol=-20), row("2015-06-16 11:00", hum=104, sol=0),
            row("2015-06-16 12:00", hum=100, sol=850)]
    out, report = clean(frame(rows))
    assert out["humidity_pct"].tolist() == [0, 100, 100]
    assert out["solar_irradiance_wm2"].tolist() == [0, 0, 850]
    assert fixes(report)["clipped_humidity"] == 2
    assert fixes(report)["clipped_solar"] == 1


def test_sorted_and_duplicates_dropped_keeping_the_first():
    rows = [row("2015-06-16 12:00", 30), row("2015-06-16 10:00", 10), row("2015-06-16 11:00", 20),
            row("2015-06-16 10:00", 15)]
    out, report = clean(frame(rows))
    assert stamps(out) == ["2015-06-16 10:00", "2015-06-16 11:00", "2015-06-16 12:00"]
    assert out["ambient_temp_c"].tolist() == [10, 20, 30]
    assert fixes(report)["dropped_duplicates"] == 1
    assert fixes(report)["sorted"] > 0


def test_missing_values_interpolated_against_time_and_ends_filled():
    rows = [row("2015-06-16 09:00", None), row("2015-06-16 10:00", 10), row("2015-06-16 11:00", None),
            row("2015-06-16 14:00", 40), row("2015-06-16 15:00", None)]
    out, report = clean(frame(rows))
    # 11:00 sits 1/4 of the way from 10:00 to 14:00, so time interpolation gives 17.5, not 25.
    assert out["ambient_temp_c"].tolist() == [10, 10, 17.5, 40, 40]
    assert fixes(report)["interpolated_ambient_temp_c"] == 3


def test_non_numeric_values_become_missing_then_interpolated():
    rows = [row("2015-06-16 10:00", "20"), row("2015-06-16 11:00", "n/a"), row("2015-06-16 12:00", 30)]
    out, report = clean(frame(rows))
    assert out["ambient_temp_c"].tolist() == [20, 25, 30]
    assert fixes(report)["unreadable_numbers"] == 1


def test_column_with_no_values_gets_the_training_median():
    rows = [{"timestamp": "2015-06-16 10:00", "ambient_temp_c": 25}, {"timestamp": "2015-06-16 11:00", "ambient_temp_c": 26}]
    out, report = clean(frame(rows))  # no humidity or solar columns at all
    assert out["humidity_pct"].tolist() == [FILL_VALUES["humidity_pct"]] * 2
    assert fixes(report)["filled_default_humidity_pct"] == 2
    assert fixes(report)["filled_default_solar_irradiance_wm2"] == 2


def test_csv_upload_with_bom_odd_header_case_and_spaces():
    data = "﻿Timestamp, Ambient_Temp_C,humidity_pct,solar_irradiance_wm2\n2015-06-16 10:00,25,50,100\n".encode()
    out, report = clean(read_csv(data))
    assert stamps(out) == ["2015-06-16 10:00"] and out["ambient_temp_c"].tolist() == [25]


def test_the_sample_csv_is_already_clean():
    with open("sample_test_input.csv", "rb") as f:
        out, report = clean(read_csv(f.read()))
    assert report["rows_in"] == report["rows_out"] == 1000
    assert set(fixes(report).values()) == {0}


@pytest.mark.parametrize(
    "rows, message",
    [
        ([], "no rows"),
        ([{"ambient_temp_c": 20}], "missing required column(s): timestamp"),
        ([{"timestamp": "2015-06-16 10:00"}], "missing required column(s): ambient_temp_c"),
        ([row(""), row("nonsense")], "no usable rows"),
        ([row("2015-06-16 10:00", 500)], "no usable rows"),
    ],
)
def test_unusable_input_raises(rows, message):
    with pytest.raises(CleaningError, match=message.replace("(", r"\(").replace(")", r"\)")) as e:
        clean(frame(rows))
    assert e.value.status == 400


def test_no_usable_rows_lists_the_reasons():
    with pytest.raises(CleaningError) as e:
        clean(frame([row(""), row("2015-06-16 10:00", 500)]))
    assert e.value.details == ["row 1: no timestamp", "row 2: impossible temperature 500 °C"]


def test_too_many_rows_is_413():
    rows = [row(str(pd.Timestamp("2015-01-01") + pd.Timedelta(hours=i))) for i in range(MAX_ROWS + 1)]
    with pytest.raises(CleaningError) as e:
        clean(frame(rows))
    assert e.value.status == 413
    out, _ = clean(frame(rows[:MAX_ROWS]))
    assert len(out) == MAX_ROWS


@pytest.mark.parametrize("data", [b"", b"   \n", b'timestamp,ambient_temp_c\n"2015-06-16,1\n'])
def test_unreadable_csv(data):
    with pytest.raises(CleaningError):
        clean(read_csv(data))


def test_manual_rows_must_be_objects():
    with pytest.raises(CleaningError, match="not objects"):
        rows_frame([row("2015-06-16 10:00"), 5])
    with pytest.raises(CleaningError, match="must be a list"):
        rows_frame({"timestamp": "x"})
