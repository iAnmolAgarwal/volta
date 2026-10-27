"""Portability check for predict.py on any interpreter, with requests.post mocked (no network).

Copy this file, predict.py and sample_test_input.csv into an empty folder, then run it with the
Python you want to check (it was run on 3.9.6 + pandas 1.5.3 and 3.11 + pandas 3.1)."""
import sys, warnings
warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
import predict

sent = []
class Resp:
    status_code = 200
    def __init__(self, body): self.body = body; self.text = ""
    def json(self): return self.body
def fake_post(url, json=None, timeout=None):
    sent.append(json["rows"])
    return Resp({"predictions": [100.0 + float(r["ambient_temp_c"] or 0) for r in json["rows"]]})
predict.requests.post = fake_post
predict.DEFAULT_PROXY_URL = "https://proxy.example"

def frame(stamps, temps):
    return pd.DataFrame({"timestamp": stamps, "ambient_temp_c": temps, "humidity_pct": [50.0] * len(stamps),
                         "solar_irradiance_wm2": [0.0] * len(stamps)})
ok = []
def check(name, cond):
    ok.append(bool(cond)); print(("PASS " if cond else "FAIL ") + name)

df = pd.read_csv("sample_test_input.csv"); sent.clear()
p = predict.predict(df); check("sample: 1000 predictions, one request", len(p) == 1000 and [len(c) for c in sent] == [1000])
d = frame(["2015-07-01 00:00:00", "2015-07-01 01:00:00"], [25.0, 26.0]); d.columns = [" Timestamp", "AMBIENT_TEMP_C ", "Humidity_Pct", " solar_irradiance_wm2 "]
sent.clear(); predict.predict(d); check("column names ignoring case and spaces", [r["ambient_temp_c"] for r in sent[0]] == [25.0, 26.0])
sent.clear(); predict.predict(frame(["2015-07-01 17:00:00", None, "2015-07-01 19:00:00"], [30.0, 31.0, 32.0]))
check("missing timestamp inferred", [r["timestamp"] for r in sent[0]] == ["2015-07-01 17:00:00", "2015-07-01 18:00:00", "2015-07-01 19:00:00"])
sent.clear(); predict.predict(frame(["16/06/2015 18:00", "05-06-2015 07:00", "2015-06-05 07:00:00"], [30.0, 25.0, 25.0]))
check("dd-mm-yyyy only when not ISO", [r["timestamp"] for r in sent[0]] == ["2015-06-16 18:00:00", "2015-06-05 07:00:00", "2015-06-05 07:00:00"])
stamps = pd.date_range("2015-06-01", periods=2500, freq="h").strftime("%Y-%m-%d %H:%M:%S"); sent.clear()
p = predict.predict(frame(list(stamps), list(np.arange(2500) / 100.0)))
check("2,500 rows in chunks of 1,000, in order", [len(c) for c in sent] == [1000, 1000, 500] and np.allclose(p, 100 + np.arange(2500) / 100.0))
sent.clear(); p = predict.predict(frame(["2015-07-01 02:00:00", "2015-07-01 00:00:00", "2015-07-01 01:00:00"], [22.0, 20.0, None]))
check("shuffled rows keep their order", [r["timestamp"] for r in sent[0]] == ["2015-07-01 02:00:00", "2015-07-01 00:00:00", "2015-07-01 01:00:00"] and sent[0][2]["ambient_temp_c"] == 21.0)
sent.clear(); check("single row", len(predict.predict(frame(["2015-07-01 12:00:00"], [33.0]))) == 1)
check("main() writes timestamp,target_demand_kw", predict.main(["--input", "sample_test_input.csv", "--output", "out.csv"]) == 0
      and list(pd.read_csv("out.csv").columns) == ["timestamp", "target_demand_kw"] and len(pd.read_csv("out.csv")) == 1000)
print(f"python {sys.version.split()[0]}, pandas {pd.__version__}: {sum(ok)}/{len(ok)} passed")
sys.exit(0 if all(ok) else 1)
