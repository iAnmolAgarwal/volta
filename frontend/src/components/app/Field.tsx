import { useId, type ComponentProps, type ReactNode } from "react";
import { clsx } from "clsx";
import { CircleAlert } from "lucide-react";

/* A rounded input on the dock's glass: a spaced-caps label above, an optional
 * unit suffix inside, a hint or an error under it. All other props go to the
 * <input> (value, onChange, type, inputMode, ref …). */

export interface FieldProps extends Omit<ComponentProps<"input">, "size"> {
  label: ReactNode;
  hint?: ReactNode;
  /** Shown in --overload with an icon; sets aria-invalid. */
  error?: ReactNode;
  /** A unit inside the box, e.g. "°C". */
  suffix?: ReactNode;
  className?: string;
  inputClassName?: string;
}

export function Field({ label, hint, error, suffix, className, inputClassName, id, ...input }: FieldProps) {
  const auto = useId();
  const fid = id ?? auto;
  const note = error ? `${fid}-error` : hint ? `${fid}-hint` : undefined;
  return (
    <div className={clsx("va-field", error != null && error !== false && "is-invalid", input.disabled && "is-disabled", className)}>
      <label className="va-field-label" htmlFor={fid}>{label}</label>
      <div className="va-field-box">
        <input
          id={fid}
          className={clsx("va-field-input", inputClassName)}
          aria-invalid={error ? true : undefined}
          aria-describedby={note}
          {...input}
        />
        {suffix != null && <span className="va-field-suffix" aria-hidden="true">{suffix}</span>}
      </div>
      {error ? (
        <p className="va-field-error" id={`${fid}-error`}><CircleAlert strokeWidth={1.5} aria-hidden />{error}</p>
      ) : hint ? (
        <p className="va-field-hint" id={`${fid}-hint`}>{hint}</p>
      ) : null}
    </div>
  );
}
