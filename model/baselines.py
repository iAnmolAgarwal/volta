"""Baselines, feature ablation, residual analysis and the formula search.

Every model is fitted on FIT and scored on VAL (model/split.py). Prints the
RMSE table and writes docs/model_report.md.

Usage: python model/baselines.py
"""

import sys
from pathlib import Path

if __package__ in (None, ""):  # run as `python model/baselines.py`
    sys.path[0] = str(Path(__file__).resolve().parents[1])

import numpy as np
import pandas as pd
from scipy import stats
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import LinearRegression, Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from model.data import DOCS_DIR, TARGET, load_test, load_train
from model.features import (
    COOL_THRESHOLDS,
    FEATURE_COLUMNS,
    FEATURE_GROUPS,
    HOUR_BLOCKS,
    QUICKML_FEATURES,
    QUICKML_REFERENCE,
    build_features,
)
from model.report import Report
from model.split import describe_split, time_split

try:
    from lightgbm import LGBMRegressor
except ImportError:  # optional dependency
    LGBMRegressor = None

# Dropping a group that changes VAL RMSE by less than this is a tie (the group
# is fully explained by the others), and ties go to the smaller feature set.
TIE_KW = 1e-6
TEMP_BANDS = [-5, 0, 5, 10, 15, 20, 22, 24, 26, 28, 30, 32, 35, 40]
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def rmse(y, pred) -> float:
    return float(np.sqrt(np.mean((np.asarray(y) - np.asarray(pred)) ** 2)))


def cols_of(groups) -> list[str]:
    return [c for g in groups for c in FEATURE_GROUPS[g]]


def starter_formula(df: pd.DataFrame) -> np.ndarray:
    """The dummy curve from the starter predict.py, copied so later edits there don't move it."""
    hours = df["timestamp"].dt.hour
    base = 120.0 + 30.0 * np.sin(2 * np.pi * (hours - 6) / 24)
    return (base + np.maximum(0.0, df["ambient_temp_c"] - 24.0) * 8.5).to_numpy()


def model_zoo() -> dict:
    zoo = {
        "OLS": lambda: LinearRegression(),
        "Ridge (alpha=1, scaled)": lambda: make_pipeline(StandardScaler(), Ridge(alpha=1.0)),
        "RandomForest": lambda: RandomForestRegressor(
            n_estimators=300, min_samples_leaf=3, n_jobs=-1, random_state=0
        ),
        "GradientBoosting": lambda: GradientBoostingRegressor(
            n_estimators=400, learning_rate=0.05, max_depth=3, random_state=0
        ),
    }
    if LGBMRegressor is not None:
        zoo["LightGBM"] = lambda: LGBMRegressor(
            n_estimators=600, learning_rate=0.03, num_leaves=15, subsample=0.8,
            subsample_freq=1, colsample_bytree=0.8, random_state=0, verbose=-1,
        )
    return zoo


class Experiment:
    """Holds the FIT/VAL feature matrices and scores models on them."""

    def __init__(self, train: pd.DataFrame):
        self.fit_raw, self.val_raw = time_split(train)
        self.X_fit, self.X_val = build_features(self.fit_raw), build_features(self.val_raw)
        self.y_fit, self.y_val = self.fit_raw[TARGET], self.val_raw[TARGET]

    def score(self, model, cols) -> tuple[float, float, np.ndarray]:
        """Fit on FIT; return (RMSE FIT in-sample, RMSE VAL, VAL predictions)."""
        model.fit(self.X_fit[cols], self.y_fit)
        pred = model.predict(self.X_val[cols])
        return rmse(self.y_fit, model.predict(self.X_fit[cols])), rmse(self.y_val, pred), pred

    def ols_val(self, cols, extra_fit=None, extra_val=None) -> float:
        X_fit, X_val = self.X_fit[cols], self.X_val[cols]
        if extra_fit is not None:
            X_fit, X_val = X_fit.assign(extra=extra_fit), X_val.assign(extra=extra_val)
        return self.score_xy(X_fit, X_val)

    def score_xy(self, X_fit, X_val) -> float:
        model = LinearRegression().fit(X_fit, self.y_fit)
        return rmse(self.y_val, model.predict(X_val))


def ablate(exp: Experiment):
    """Backward elimination of feature groups with OLS, judged on VAL RMSE.

    Drops, at every step, the group whose removal hurts VAL RMSE least, all the
    way down to one group. Two stopping rules read the same path:
    - strict: stop at the first drop that raises VAL RMSE (keeps every group
      that lowers it at all, however little);
    - one-SE: the smallest set within one standard error of the best VAL RMSE.
    Returns (first_pass, path, strict_groups, one_se_groups, se).
    """
    groups = list(FEATURE_GROUPS)
    full = exp.ols_val(cols_of(groups))
    first_pass = pd.DataFrame(
        [
            (g, len(FEATURE_GROUPS[g]), exp.ols_val(cols_of([k for k in groups if k != g])))
            for g in groups
        ],
        columns=["group", "columns", "VAL RMSE without it"],
    ).set_index("group")
    first_pass["delta vs all groups"] = first_pass["VAL RMSE without it"] - full

    current, steps = groups[:], [("(none)", groups[:], full)]
    while len(current) > 1:
        trials = {g: exp.ols_val(cols_of([k for k in current if k != g])) for g in current}
        drop, after = min(trials.items(), key=lambda kv: kv[1])
        current = [k for k in current if k != drop]
        steps.append((drop, current, after))

    path = pd.DataFrame(
        [(d, len(cols_of(left)), r) for d, left, r in steps],
        columns=["dropped", "columns left", "VAL RMSE"],
    )
    path["change"] = path["VAL RMSE"].diff()
    path.index.name = "step"

    first_rise = next((i for i in range(1, len(steps)) if path["change"][i] >= TIE_KW), len(steps))
    strict = steps[first_rise - 1][1]
    best = path["VAL RMSE"].min()
    se = best / np.sqrt(2 * len(exp.y_val))
    one_se = steps[max(i for i in range(len(steps)) if path["VAL RMSE"][i] <= best + se)][1]
    return first_pass, path, strict, one_se, se


def refine_cooling(exp: Experiment, kept: list[str]):
    """Replace the cooling group with one hinge max(0, T - t), t on a 0.25 °C grid."""
    base_cols = cols_of([g for g in kept if g != "cooling"])
    T_fit, T_val = exp.fit_raw["ambient_temp_c"], exp.val_raw["ambient_temp_c"]
    grid = pd.DataFrame(
        [
            (t, exp.ols_val(base_cols, (T_fit - t).clip(lower=0), (T_val - t).clip(lower=0)))
            for t in np.arange(22.0, 26.0001, 0.25)
        ],
        columns=["threshold C", "VAL RMSE"],
    ).set_index("threshold C")
    return base_cols, grid


def residual_tables(exp: Experiment, cols: list[str], train: pd.DataFrame):
    """VAL residuals of the FIT model, and in-sample residuals of a model fitted on ALL rows."""
    _, _, pred_val = exp.score(LinearRegression(), cols)
    val = exp.val_raw.assign(resid=exp.y_val - pred_val)
    X_all = build_features(train)[cols]
    all_rows = train.assign(resid=train[TARGET] - LinearRegression().fit(X_all, train[TARGET]).predict(X_all))

    keys = {
        "hour": lambda d: d["timestamp"].dt.hour,
        "temperature band, °C": lambda d: pd.cut(d["ambient_temp_c"], TEMP_BANDS).astype(str),
        "weekday": lambda d: d["timestamp"].dt.day_of_week.map(dict(enumerate(WEEKDAYS))),
        "month": lambda d: d["timestamp"].dt.strftime("%Y-%m"),
    }
    tables = {}
    for name, key in keys.items():
        v = val.groupby(key(val))["resid"].agg(["mean", lambda r: np.sqrt((r**2).mean()), "count"])
        v.columns = ["VAL mean resid", "VAL RMSE", "VAL rows"]
        a = all_rows.groupby(key(all_rows))["resid"].agg(["mean", "count"])
        a.columns = ["ALL mean resid (in-sample)", "ALL rows"]
        t = v.join(a, how="outer").astype({"VAL rows": "Int64", "ALL rows": "Int64"})
        t.index.name = name
        if name == "weekday":
            t = t.reindex(WEEKDAYS)
        elif name == "temperature band, °C":
            t = t.reindex([str(b) for b in pd.cut(pd.Series([b + 0.1 for b in TEMP_BANDS[:-1]]), TEMP_BANDS)])
        tables[name] = t.astype(object).where(t.notna(), "")

    def trend(d):
        days = (d["timestamp"] - d["timestamp"].min()).dt.total_seconds() / 86400
        fit = stats.linregress(days, d["resid"])
        r = d["resid"].to_numpy()
        return {
            "slope kW per 30 days": 30 * fit.slope,
            "slope SE": 30 * fit.stderr,
            "p-value": fit.pvalue,
            "lag-1 autocorr": np.corrcoef(r[1:], r[:-1])[0, 1],
            "lag-24 autocorr": np.corrcoef(r[24:], r[:-24])[0, 1],
        }

    trends = pd.DataFrame({"VAL (out of sample)": trend(val), "ALL (in-sample)": trend(all_rows)}).T
    return tables, trends


def block_design(hours: pd.Series) -> np.ndarray:
    return np.column_stack([hours.isin(h).to_numpy() for h in HOUR_BLOCKS.values()]).astype(float)


def ols_fit(X: np.ndarray, y: np.ndarray):
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ beta
    dof = len(y) - np.linalg.matrix_rank(X)
    sigma2 = resid @ resid / dof
    se = np.sqrt(np.diag(sigma2 * np.linalg.pinv(X.T @ X)))
    return beta, se, resid, dof


def f_test(X_small: np.ndarray, X_big: np.ndarray, y: np.ndarray) -> tuple[float, float]:
    """Nested-model F test: does X_big explain significantly more than X_small?"""
    *_, r0, dof0 = ols_fit(X_small, y)
    *_, r1, dof1 = ols_fit(X_big, y)
    q = dof0 - dof1
    f = ((r0 @ r0 - r1 @ r1) / q) / (r1 @ r1 / dof1)
    return float(f), float(stats.f.sf(f, q, dof1))


def formula_search(train: pd.DataFrame, exp: Experiment):
    """Fit demand = c[hour block] + slope * max(0, T - t) on all rows and test what it leaves out."""
    y = train[TARGET].to_numpy()
    T = train["ambient_temp_c"]
    hours = train["timestamp"].dt.hour
    B = block_design(hours)

    grid = np.arange(22.0, 26.0001, 0.05)
    sse = [ols_fit(np.column_stack([B, (T - t).clip(lower=0)]), y)[2] for t in grid]
    t_best = float(grid[int(np.argmin([r @ r for r in sse]))])
    hinge = (T - t_best).clip(lower=0).to_numpy()
    X = np.column_stack([B, hinge])
    beta, se, resid, dof = ols_fit(X, y)
    sigma = float(np.sqrt(resid @ resid / dof))

    coef = pd.DataFrame(
        {
            "hours": [f"{h.start}-{h.stop - 1}" if len(h) > 1 else str(h.start) for h in HOUR_BLOCKS.values()]
            + [f"T > {t_best:.2f} °C"],
            "estimate": beta,
            "SE": se,
        },
        index=pd.Index([f"base_{b}" for b in HOUR_BLOCKS] + ["cooling slope (kW per °C)"], name="term"),
    )

    H24 = np.eye(24)[hours.to_numpy()]
    wd = np.eye(7)[train["timestamp"].dt.day_of_week.to_numpy()][:, 1:]
    feats = build_features(train)
    others = np.column_stack([feats[["humidity", "solar", "doy_sin", "doy_cos", "heat15"]].to_numpy(), wd])
    tests = pd.DataFrame(
        [
            ("24 hourly constants instead of 6 blocks", *f_test(X, np.column_stack([H24, hinge]), y)),
            ("a separate cooling slope per block", *f_test(X, np.column_stack([B, B * hinge[:, None]]), y)),
            ("humidity, solar, day of year, heat15, weekday", *f_test(X, np.column_stack([X, others]), y)),
        ],
        columns=["does adding ... help?", "F", "p-value"],
    ).set_index("does adding ... help?")

    noise = {
        "sigma (kW)": sigma,
        "skew": float(stats.skew(resid)),
        "excess kurtosis": float(stats.kurtosis(resid)),
        "lag-1 autocorr": float(np.corrcoef(resid[1:], resid[:-1])[0, 1]),
    }

    # The same formula, fitted on FIT only and scored on VAL (threshold 24 from the VAL grid).
    B_fit, B_val = block_design(exp.fit_raw["timestamp"].dt.hour), block_design(exp.val_raw["timestamp"].dt.hour)
    h_fit = (exp.fit_raw["ambient_temp_c"] - 24).clip(lower=0).to_numpy()
    h_val = (exp.val_raw["ambient_temp_c"] - 24).clip(lower=0).to_numpy()
    b_fit, *_ = ols_fit(np.column_stack([B_fit, h_fit]), exp.y_fit.to_numpy())
    val_rmse = rmse(exp.y_val, np.column_stack([B_val, h_val]) @ b_fit)
    return t_best, coef, tests, noise, val_rmse


def main() -> None:
    train = load_train()
    exp = Experiment(train)
    rep = Report("Model report", "python model/baselines.py")
    rep.add(
        "## Validation split",
        "Forward in time, never random: fit on the first 80% of `train_telemetry.csv` by "
        "timestamp, score on the last 20%. FIT RMSE is in-sample; VAL RMSE is out of sample.",
        describe_split(exp.fit_raw, exp.val_raw),
    )

    rows = []

    def record(name, features, n, fit_rmse, val_rmse):
        rows.append((name, features, n, fit_rmse, val_rmse))

    record("Starter dummy formula (no fitting)", "hour, temp", 0,
           rmse(exp.y_fit, starter_formula(exp.fit_raw)), rmse(exp.y_val, starter_formula(exp.val_raw)))
    record("Constant (FIT mean)", "none", 0, rmse(exp.y_fit, np.full(len(exp.y_fit), exp.y_fit.mean())),
           rmse(exp.y_val, np.full(len(exp.y_val), exp.y_fit.mean())))
    hour_cool = FEATURE_GROUPS["hour_onehot"] + ["cool_24"]
    record("OLS", "hour one-hot + cool_24", len(hour_cool), *exp.score(LinearRegression(), hour_cool)[:2])
    zoo = model_zoo()
    for name, make in zoo.items():
        if name == "OLS":
            continue
        record(name, "all features", len(FEATURE_COLUMNS), *exp.score(make(), FEATURE_COLUMNS)[:2])
    if LGBMRegressor is None:
        rep.add("LightGBM is not installed, so it is skipped.")

    # Ablation: backward elimination, read with the strict and the one-SE rule.
    first_pass, path, strict, kept, se = ablate(exp)
    base_cols, cool_grid = refine_cooling(exp, kept)
    t_star = float(cool_grid["VAL RMSE"].idxmin())
    group_rmse = exp.ols_val(cols_of(kept))
    if cool_grid["VAL RMSE"].min() <= group_rmse:
        assert t_star in COOL_THRESHOLDS, f"best threshold {t_star} has no column; add it to COOL_THRESHOLDS"
        best_cols = base_cols + [f"cool_{t_star:g}"]
    else:
        best_cols = cols_of(kept)
    strict_cols = [c for c in cols_of(strict) if not c.startswith("cool_")] + [f"cool_{t_star:g}"]
    record("OLS", "strict-rule set", len(strict_cols), *exp.score(LinearRegression(), strict_cols)[:2])

    family = []
    for name, make in zoo.items():
        fit_rmse, val_rmse, _ = exp.score(make(), best_cols)
        family.append((name, fit_rmse, val_rmse))
        record(name, "best set (one-SE rule)", len(best_cols), fit_rmse, val_rmse)
    record("OLS with intercept", f"QuickML columns ({QUICKML_REFERENCE} as reference)",
           len(QUICKML_FEATURES), *exp.score(LinearRegression(), QUICKML_FEATURES)[:2])
    quickml_matches = [c for c in best_cols if c != QUICKML_REFERENCE] == QUICKML_FEATURES

    t_best, coef, tests, noise, formula_val = formula_search(train, exp)

    table = pd.DataFrame(rows, columns=["model", "features", "n features", "RMSE FIT (in-sample)", "RMSE VAL"])

    rep.add("## RMSE table (fit on FIT, scored on VAL)")
    rep.table(table, floatfmt=".3f", index=False)
    rep.add(
        f"A VAL RMSE near {path['VAL RMSE'].min():.2f} kW over {len(exp.y_val)} rows has a standard "
        f"error of about {se:.2f} kW (RMSE / sqrt(2n)), so gaps under ~0.2 kW are within noise."
    )

    rep.add(
        "## Feature-group ablation (OLS, VAL RMSE)",
        "Backward elimination: at each step drop the group whose removal hurts VAL RMSE least, "
        "down to one group. Two rules read the path:",
        f"- **strict**: stop at the first drop that raises VAL RMSE (changes under {TIE_KW:g} kW are "
        "ties, i.e. the group is fully explained by others, and go to the smaller set). This keeps "
        "any group that lowers VAL RMSE at all;\n"
        f"- **one-SE**: the smallest set whose VAL RMSE is within one standard error ({se:.3f} kW) "
        "of the best on the path (Breiman et al.'s one-standard-error rule).",
        "Drop one group from the full set (delta > 0 means the group helps):",
    )
    rep.table(first_pass, floatfmt=".4f")
    rep.add("Elimination path:")
    rep.table(path.astype(object).where(path.notna(), ""), floatfmt=".4f")
    rep.add(
        f"- Strict rule keeps: {', '.join(strict)}.\n"
        f"- One-SE rule keeps: {', '.join(kept)}.",
        "The groups the strict rule adds on top move VAL RMSE by a few hundredths of a kW, far "
        "inside one standard error, and the F test on all 4,000 rows (formula section) finds no "
        "humidity, solar, day-of-year or weekday effect. Day of year is also an extrapolation risk: "
        "the test window (mid-June to late July) lies past every training date. "
        "**The one-SE set is used.**",
    )

    rep.add(
        "## Cooling threshold, 0.25 °C steps (OLS, VAL RMSE)",
        f"One-SE groups without `cooling`, plus one hinge max(0, T - t). The full four-hinge "
        f"group scores {group_rmse:.4f}.",
    )
    rep.table(cool_grid.T, floatfmt=".3f")
    rep.add(
        f"Best threshold: {t_star:.2f} °C (VAL RMSE {cool_grid['VAL RMSE'].min():.4f}).",
        f"**Best feature set ({len(best_cols)} columns):** `{', '.join(best_cols)}`",
        f"QUICKML_FEATURES in model/features.py is this set with `{QUICKML_REFERENCE}` left out as "
        "the reference level (same predictions under a linear model with an intercept): "
        + ("**matches**." if quickml_matches else "**DOES NOT MATCH; update QUICKML_FEATURES.**"),
    )

    rep.add("## Best feature set by model family (fit on FIT, scored on VAL)")
    rep.table(pd.DataFrame(family, columns=["model", "RMSE FIT (in-sample)", "RMSE VAL"]), floatfmt=".3f", index=False)
    hot = {name: d["ambient_temp_c"] for name, d in [("FIT", exp.fit_raw), ("VAL", exp.val_raw), ("test", load_test())]}
    rep.add(
        "Tree models cannot extend the cooling line past the hottest temperature they were fitted on. "
        + "; ".join(f"{k}: max {t.max():.1f} °C, {(t > 30).mean():.0%} of rows above 30 °C" for k, t in hot.items())
        + ". **In QuickML, use a linear algorithm (linear or ridge regression), not a tree ensemble.**"
    )

    tables, trends = residual_tables(exp, best_cols, train)
    rep.add(
        "## Residual analysis (OLS on the best set)",
        "VAL columns: model fitted on FIT, residuals on VAL. ALL columns: model fitted on all "
        "4,000 rows, in-sample residuals. Residual = actual - predicted.",
    )
    for name, t in tables.items():
        rep.add(f"### By {name}")
        rep.table(t.T if name == "hour" else t, floatfmt=".2f")
    rep.add("### Time trend and autocorrelation")
    rep.table(trends, floatfmt=".3f")

    rep.add(
        "## Generating formula (fitted on all 4,000 rows)",
        "demand_kw = base[hour block] + slope * max(0, T - threshold) + noise. "
        f"Threshold grid 22-26 °C in 0.05 steps; best {t_best:.2f} °C.",
    )
    rep.table(coef, floatfmt=".3f")
    rep.add("Nested F tests against this formula (small p means the extra terms matter):")
    rep.table(tests, floatfmt=".3g")
    rep.add("Noise left over:")
    rep.table(pd.DataFrame([noise]), floatfmt=".3f", index=False)
    rep.add(
        f"The noise floor is about {noise['sigma (kW)']:.2f} kW RMSE: the leftover looks like "
        "white Gaussian noise (no autocorrelation, skew and excess kurtosis near 0), so no "
        "row-local feature can remove it. The same formula fitted on FIT scores "
        f"{formula_val:.3f} on VAL.",
        f"The fitted slope ({coef['estimate'].iloc[-1]:.2f} ± {coef['SE'].iloc[-1]:.2f}) and threshold "
        f"({t_best:.2f} °C) match the cooling term in the starter predict.py, 8.5 * max(0, T - 24). "
        "The starter curve's cooling term is right; its sine base, which smooths over the hour "
        "blocks, is what costs it.",
    )

    rep.write(DOCS_DIR / "model_report.md")


if __name__ == "__main__":
    main()
