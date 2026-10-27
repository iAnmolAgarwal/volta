# Shared app components (M2 shell)

These are frozen for the screen builders: use them, don't edit them. Every look is in `src/styles/app.css` and every value is a token (`src/styles/tokens.css`). Each component is built from Sylva's vocabulary (`.refs/sylva/index.html`). If you need something new, add it in your page and log it in `design/QUESTIONS.md`.

Data comes only through `src/lib/api.ts`, the typed client for `docs/api.md`:

- **Endpoints:** `forecastCsv`, `forecastSample`, `forecastRows`, `getRun`, `listRuns`, `getSample`, `predict`.
- **The viewer's last run:** `getLastRunId` and `setLastRunId`.
- **Errors:** every failure throws an `ApiError` with a `kind` (`bad_request`, `not_found`, `too_large`, `upstream`, `not_configured`, `network`, `timeout`, `parse`), plus `status` and `details`. `errorTitle(e)` gives a human headline for it.
- **Helpers:** `hhmm`, `dayMonth`, `shortMode`, `isStorage`.
- **Constants:** `STORAGE_ABOVE_KW`, `OVERLOAD_AT_KW`, `PEAK_HOURS`, `CAPACITY_KWH`, `MIN_SOC_PCT`, `MAX_ROWS`.

## Layout

| Component | Props | Sylva source |
|---|---|---|
| `AppLayout` (route element, default export) | none. It renders the `<Outlet/>` | the hero field, `.guides` and the ghost word; the landing's `Dock`, fixed, with the route's item active |
| `PageHeader` | `eyebrow?`, `title`, `lede?`, `actions?` | `.headline` (light Lexend on the 46-unit rail) and `.lede` (x 520), in a grid on the guides. The headline rises, the lede wipes in |

A page's root is `<div className="va-page">`, a centred 1600-unit column with Sylva's rails that stacks its children with `--a-gap`. Below 900 px everything is one column; lay your own grids out the same way. `src/pages/*` shows the pattern.

## Components

| Component | Props | Sylva source |
|---|---|---|
| `GlassCard` | `variant?: "paper" \| "glass"`, `label?`, `title?`, `aside?` (header right), `knob?: {label, icon?, to? \| onClick?}`, `delay?` (ms, entrance stagger), `still?`, `as?`, `className?` | `.card` (paper: label 15.5, title 26.2, deep shadow that grows on hover) and the plate's moss glass; `.knob` on the lower-right corner; the `.mask` wipe |
| `Pill` | `children`, `icon?`, `tone?: "default" \| "volt" \| "overload"`, `size?: "sm" \| "md"`, `pressed?`, `current?`, `onClick?` (button), `to?` (route link), `disabled?` | `.dock-item`: spaced caps, a glass chip, paper when pressed or current |
| `ModeBadge` | `mode`, `reason?`, `overload?`, `eyebrow?`, `size?: "md" \| "lg"`, `live?` (aria-live) | the dock bar with its mark tile. Storage is a battery icon in `--mode-storage`; Main Grid is a pole icon in `--mode-grid`. Overload is card 2's flag |
| `RingGauge` | `socPct`, `batteryKw` (> 0 discharging, < 0 charging), `pvKw`, `capacityKwh?` (800), `label?` | the `.stat .mark` dotted ring, grown, with a lime arc, the 10% reserve tick, and two side stats under it (battery state, solar) |
| `LogItem` | `label` (caps), `title`, `kind?: "switch" \| "overload" \| "info"`, `meta?`, `icon?`, `active?`, `onClick?` \| `to?` | the Field Note (small label, then a headline); `active` wears the paper |
| `DropZone` | `onFile(file)`, `onReject?(file, why)`, `accept?` (CSV), `title?`, `hint?`, `fileName?`, `busy?`, `busyText?`, `disabled?` | a dashed `--r-portal` plate with a dotted ring mark; lime when a file is dragged over it. Click anywhere to browse |
| `Field` | `label`, `hint?`, `error?`, `suffix?`, plus every `<input>` prop | the dock's glass, 46 tall, `--r-dock`. The label is in spaced caps; an error is in `--overload` with an icon and `aria-invalid` |
| `Shimmer` | `variant?: "overlay" \| "card" \| "chart" \| "text"`, `lines?`, `label?` | the landing's `.vl-shimmer` sheen |
| `EmptyState` | `title`, `children` (body), `action?`, `icon?`, `surface?: "card" \| "plain"` | a side-stat mark grown into a ringed dotted disc, a light title and an action |
| `ErrorState` | `error` (`ApiError` or any), `title?`, `action?`, `surface?` | the same, in `--overload`; shows `errorTitle`, the message, the HTTP code and up to 5 `details` |

## Rules

- **The focused hour.** The page keeps one focused hour (the chart's hover or tap, else the stepper's hour) and passes it to `ModeBadge` (with that hour's `reason`), `RingGauge` and the `LogItem` `active` flags.
- **Removed 2026-10-27:** the shared `MainChart` and `AlertBanner`. The Dashboard needed a charging series and grouped overload stretches that they couldn't take, so it has its own `pages/dashboard/LoadChart.tsx` and `OverloadBanner.tsx`, built from the same styles (`.va-chart*` in app.css).
- **Entrances.** A `delay` prop staggers the mask wipe, in Sylva's ~100 ms steps after the header (380, 460, 560 …). Reduced motion turns every entrance and animation off.
- **Colour is never the only signal.** Mode and overload always come with an icon and a word; keep it that way in your pages.
- **CORS.** JSON POSTs (`forecastRows`, `predict`) go out as `text/plain;charset=UTF-8`. They will 400 until the backend force-parses JSON (planned with the Slate deploy). CSV and sample uploads (multipart) and every GET already work.
