import { useId, useRef, useState, type DragEvent } from "react";
import { clsx } from "clsx";
import { FileText, Upload } from "lucide-react";

/* A dashed, rounded drop zone in Sylva's portal radius. Drop a file on it, or
 * click anywhere in it (or press Enter/Space on its focused input) to browse.
 * Files that don't match `accept` call onReject instead of onFile. */

export interface DropZoneProps {
  onFile: (file: File) => void;
  onReject?: (file: File, why: string) => void;
  /** Extensions and MIME types, as for <input accept>. Default CSV. */
  accept?: string;
  title?: string;
  hint?: string;
  /** The chosen file's name, shown as a chip. */
  fileName?: string | null;
  busy?: boolean;
  busyText?: string;
  disabled?: boolean;
  className?: string;
}

function matches(file: File, accept: string): boolean {
  const name = file.name.toLowerCase();
  return accept.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).some((a) =>
    a.startsWith(".") ? name.endsWith(a) : a.endsWith("/*") ? file.type.startsWith(a.slice(0, -1)) : file.type === a,
  );
}

export function DropZone({
  onFile,
  onReject,
  accept = ".csv,text/csv",
  title = "Drop a CSV here",
  hint = "or click to browse · timestamp and ambient_temp_c required · up to 2,000 rows",
  fileName,
  busy,
  busyText = "Uploading",
  disabled,
  className,
}: DropZoneProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const off = disabled || busy;

  const take = (file: File | undefined) => {
    if (!file || off) return;
    if (matches(file, accept)) onFile(file);
    else onReject?.(file, `${file.name} is not a ${accept.split(",")[0].replace(".", "").toUpperCase()} file`);
  };

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer.files?.[0]);
  };

  return (
    <label
      htmlFor={id}
      className={clsx("va-drop", over && "is-over", busy && "is-busy", disabled && "is-disabled", className)}
      onDragEnter={(e) => { e.preventDefault(); if (!off) setOver(true); }}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = off ? "none" : "copy"; }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
      onDrop={onDrop}
    >
      <input
        ref={input}
        id={id}
        type="file"
        accept={accept}
        className="va-drop-input"
        disabled={off}
        aria-describedby={`${id}-hint`}
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = ""; // the same file can be chosen again
        }}
      />
      <span className="va-drop-mark" aria-hidden="true"><Upload strokeWidth={1.3} aria-hidden /></span>
      <span className="va-drop-title">{busy ? busyText : title}</span>
      <span className="va-drop-hint" id={`${id}-hint`}>{hint}</span>
      {fileName && (
        <span className="va-pill va-pill--sm va-drop-file">
          <span className="va-pill-glyph" aria-hidden="true"><FileText strokeWidth={1.5} aria-hidden /></span>
          <span className="va-pill-label">{fileName}</span>
        </span>
      )}
      {busy && <span className="va-shimmer va-shimmer--overlay" aria-hidden="true" />}
    </label>
  );
}
