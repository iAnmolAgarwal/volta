# Battery model

`backend/battery.py` simulates the microgrid battery hour by hour, behind the controller. Every number is a field of `BatteryParams`. The controller's rules (`backend/controller.py`) decide the mode, and the battery only follows it: it never changes the mode, the overload flag or the prediction.

## Each hour

1. **PV.** `pv_kw = pv_kw_per_wm2 × solar_irradiance_wm2`.
   - PV charges the battery first, in either mode, up to `charge_kw`.
   - PV the battery can't take serves the load.
   - PV beyond the load is curtailed; nothing is exported.
2. **Renewable Storage Mode: peak shaving.**
   - The import is the demand minus the PV serving the load.
   - The battery discharges `min(import − grid_cap_kw, max_discharge_kw)`, and only when the import is above `grid_cap_kw`.
   - The grid supplies the rest.
3. **Main Grid Mode.** The battery never discharges. The grid adds up to `grid_charge_kw` of charging, within `charge_kw` together with PV.
4. **Limits.** The state of charge stays in `[min_soc, max_soc]`. Near a limit the battery does less:
   - near the floor it discharges less;
   - near full it charges less, cutting grid charging before PV.

   Shortfalls always come from the main grid, so the load is always met.

Signs: `battery_kw` is greater than 0 while discharging and less than 0 while charging. `grid_kw` is the total drawn from the main grid, for the load plus any grid charging.

## Parameters

| Field | Value | Realistic range | Why this value |
|---|---|---|---|
| `capacity_kwh` | 800 | 200–1,000 kWh for a site of about 100–300 kW | Holds one evening peak (18–22 h, about 200 kW against a 120 kW cap) plus a hot afternoon |
| `start_soc` | 0.80 | 0.5–0.9 | Starts most of the way charged, as after a night of off-peak charging |
| `min_soc` | 0.10 | 0.05–0.20 | Reserve kept to protect the cells (depth of discharge 90%) |
| `max_soc` | 1.00 | 0.9–1.0 | Full capacity is usable |
| `max_discharge_kw` | 100 | 0.1C–1C | 0.125C. Spreads the energy over the whole evening peak instead of emptying in two hours |
| `charge_kw` | 150 | 0.1C–0.5C | 0.19C. Lets a sunny noon (about 120 kW of PV) charge at full PV output |
| `grid_charge_kw` | 75 | 0 to `charge_kw` | Gentle off-peak top-up in Main Grid Mode. A higher value keeps the battery full too often |
| `grid_cap_kw` | 120 | between base and peak load | Above the night base (about 90 kW) and below the evening base (about 198 kW), so the battery works on every evening |
| `pv_kw_per_wm2` | 0.25 | 0.1–0.5 | A 250 kWp array including its derating: 0.25 kW per W/m², so about 122 kW at the sample's 489 W/m² maximum |
| `step_hours` | 1.0 | n/a | The data is hourly |

## Assumptions

- **No losses.** Charge and discharge are 100% efficient (real Li-ion is about 90% round trip) and there is no self-discharge. The PV factor already includes inverter and temperature derating.
- **No export.** Surplus PV is curtailed.
- **No ageing.** Capacity stays fixed and there is no degradation.
- **Grid supply.** The main grid can always supply whatever the battery and PV don't.
- **Rule-based, not optimised.** The battery doesn't look ahead at the forecast, and there is no price signal.
- **Hourly averages.** Power within an hour is taken as constant.

## Tuning

Method:
- **Grid search:** a few thousand parameter combinations within the ranges above, run on the live QuickML predictions for `sample_test_input.csv` (1,000 hours), with modes from the controller.
- **Targets:**
  - at the floor in < 15% of hours;
  - full in < 30%;
  - every 24-hour window both charging and discharging, with a state-of-charge swing ≥ 20 points.
- **Choice:** a passing combination with margin on both limits and realistic C-rates.

| Model, on the sample | At floor (10%) | Full (100%) | Smallest 24-hour swing |
|---|---|---|---|
| Before: 500 kWh, discharge 150 kW to cover all demand, grid charge 100 kW, no PV | 58.8% of hours | 16.0% | n/a |
| **Now: live QuickML predictions** | **5.1%** | **6.9%** | **69.5 points** |
| Now: reference-formula predictions (what the test uses) | 4.9% | 7.2% | 69.5 points |
| Now: formula predictions × 0.9 (modes re-decided) | 1.1% | 23.8% | 68.2 points |
| Now: formula predictions × 1.1 (modes re-decided) | 11.0% | 0.8% | 60.2 points |

The targets still hold with demand 10% higher or lower. `tests/test_battery.py::test_sample_soc_is_lively_with_the_default_params` checks them on every run, against the reference formula, which agrees with the live endpoint to 0.12 kW RMS.
