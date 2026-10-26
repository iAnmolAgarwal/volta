import type { ComponentType, FormEvent, ReactNode } from "react";
import { clsx } from "clsx";
import { CalendarClock, Droplets, Sun, Thermometer, WandSparkles } from "lucide-react";
import { Field } from "@/components/app/Field";
import { GlassCard } from "@/components/app/GlassCard";
import { Pill } from "@/components/app/Pill";
import { specErrors, type GenSpec, type Shape } from "./profile";

/* "Describe the day": the generator. Each variable is one line of a spec sheet
 * on the guides: a side-stat mark and spaced-caps name on the left, a small dock
 * (the MainChart range select's) choosing one value or a daily shape, and the
 * Fields on the right. "Generate 24 hours" fills the table below. */

type Icon = ComponentType<{ strokeWidth?: number; "aria-hidden"?: boolean }>;

function Shapes({ name, value, onChange, labels, disabled }: { name: string; value: Shape; onChange: (s: Shape) => void; labels: [string, string]; disabled?: boolean }) {
  return (
    <div className="va-range vi-shape" role="group" aria-label={`${name}: one value or a daily shape`}>
      {(["single", "profile"] as const).map((s, i) => (
        <button key={s} type="button" className={clsx("va-range-item", value === s && "is-on")} aria-pressed={value === s} onClick={() => onChange(s)} disabled={disabled}>
          {labels[i]}
        </button>
      ))}
    </div>
  );
}

function Line({ icon: I, name, note, control, children }: { icon: Icon; name: string; note?: ReactNode; control?: ReactNode; children: ReactNode }) {
  return (
    <div className="vi-line">
      <div className="vi-line-head">
        <span className="va-stat-mark vi-line-mark" aria-hidden="true"><I strokeWidth={1.4} aria-hidden /></span>
        <div className="vi-line-name">
          <h3>{name}</h3>
          {note != null && <p>{note}</p>}
        </div>
      </div>
      {control != null && <div className="vi-line-control">{control}</div>}
      <div className="vi-line-fields">{children}</div>
    </div>
  );
}

export interface DayFormProps {
  spec: GenSpec;
  onChange: (next: GenSpec) => void;
  onGenerate: () => void;
  hasRows: boolean;
  disabled?: boolean;
  delay?: number;
}

export function DayForm({ spec, onChange, onGenerate, hasRows, disabled, delay }: DayFormProps) {
  const e = specErrors(spec);
  const ok = Object.keys(e).length === 0;
  const put = <K extends "temp" | "hum" | "irr">(k: K, patch: Partial<GenSpec[K]>) => onChange({ ...spec, [k]: { ...spec[k], ...patch } });
  const dec = { inputMode: "decimal" as const, autoComplete: "off", disabled };

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (ok) onGenerate();
  };

  return (
    <GlassCard label="Manual · one day" title="Describe the 24 hours" delay={delay} className="vi-day">
      <form className="vi-day-form" onSubmit={submit} noValidate aria-describedby="vi-day-note">
        <Line icon={CalendarClock} name="Start" note="The first hour; 23 more follow, one an hour">
          <Field
            label="First hour"
            value={spec.start}
            onChange={(ev) => onChange({ ...spec, start: ev.target.value })}
            error={e.start}
            hint={e.start ? undefined : "24-hour, as the table writes it"}
            placeholder="2015-06-17 00:00"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            className="vi-wide"
          />
        </Line>

        <Line
          icon={Thermometer}
          name="Temperature"
          note={spec.temp.shape === "single" ? "The same every hour" : "Coolest at 03:00, warmest at 15:00"}
          control={<Shapes name="Temperature" value={spec.temp.shape} onChange={(shape) => put("temp", { shape })} labels={["One value", "Low · high"]} disabled={disabled} />}
        >
          {spec.temp.shape === "single" ? (
            <Field label="Temperature" suffix="°C" value={spec.temp.value} onChange={(ev) => put("temp", { value: ev.target.value })} error={e.tempValue} {...dec} />
          ) : (
            <>
              <Field label="Low" suffix="°C" value={spec.temp.low} onChange={(ev) => put("temp", { low: ev.target.value })} error={e.tempLow} {...dec} />
              <Field label="High" suffix="°C" value={spec.temp.high} onChange={(ev) => put("temp", { high: ev.target.value })} error={e.tempHigh} {...dec} />
            </>
          )}
        </Line>

        <Line
          icon={Droplets}
          name="Humidity"
          note={spec.hum.shape === "single" ? "The same every hour" : "Driest at 15:00, dampest at 03:00"}
          control={<Shapes name="Humidity" value={spec.hum.shape} onChange={(shape) => put("hum", { shape })} labels={["One value", "Low · high"]} disabled={disabled} />}
        >
          {spec.hum.shape === "single" ? (
            <Field label="Humidity" suffix="%" value={spec.hum.value} onChange={(ev) => put("hum", { value: ev.target.value })} error={e.humValue} {...dec} />
          ) : (
            <>
              <Field label="Low" suffix="%" value={spec.hum.low} onChange={(ev) => put("hum", { low: ev.target.value })} error={e.humLow} {...dec} />
              <Field label="High" suffix="%" value={spec.hum.high} onChange={(ev) => put("hum", { high: ev.target.value })} error={e.humHigh} {...dec} />
            </>
          )}
        </Line>

        <Line
          icon={Sun}
          name="Solar irradiance"
          note={spec.irr.shape === "single" ? "The same every hour" : "A bell over daylight, dark outside it"}
          control={<Shapes name="Solar irradiance" value={spec.irr.shape} onChange={(shape) => put("irr", { shape })} labels={["One value", "Daylight"]} disabled={disabled} />}
        >
          {spec.irr.shape === "single" ? (
            <Field label="Irradiance" suffix="W/m²" value={spec.irr.value} onChange={(ev) => put("irr", { value: ev.target.value })} error={e.irrValue} {...dec} />
          ) : (
            <>
              <Field label="Peak" suffix="W/m²" value={spec.irr.peak} onChange={(ev) => put("irr", { peak: ev.target.value })} error={e.irrPeak} {...dec} />
              <Field label="Sunrise" suffix=":00" value={spec.irr.rise} onChange={(ev) => put("irr", { rise: ev.target.value })} error={e.irrRise} {...dec} inputMode="numeric" />
              <Field label="Sunset" suffix=":00" value={spec.irr.set} onChange={(ev) => put("irr", { set: ev.target.value })} error={e.irrSet} {...dec} inputMode="numeric" />
            </>
          )}
        </Line>

        <div className="vi-day-foot">
          <p id="vi-day-note" className="vi-note">
            {hasRows ? "Generating again replaces the table below." : "Fills an editable table below: change any hour, add or remove rows."}
          </p>
          <Pill type="submit" icon={WandSparkles} tone="volt" disabled={!ok || disabled}>
            {hasRows ? "Regenerate 24 hours" : "Generate 24 hours"}
          </Pill>
        </div>
      </form>
    </GlassCard>
  );
}
