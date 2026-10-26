// The scene's colours, read from the design tokens at runtime, so the 3D world
// and the CSS stay one palette (frontend/src/styles/tokens.css).
import { Color, SRGBColorSpace } from "three";

const TOKENS = {
  flowGrid: "--flow-grid",
  flowBattery: "--flow-battery",
  flowSolar: "--flow-solar",
  flowOverload: "--flow-overload",
  bgNight: "--bg-night",
  bgDeep: "--bg-deep",
  haze: "--haze",
  bg: "--bg",
  bgHero: "--bg-hero",
  paper: "--paper",
  paperLabel: "--paper-label",
  volt: "--volt",
  voltPale: "--volt-pale",
  ink: "--ink",
} as const;

export type Palette = Record<keyof typeof TOKENS, Color>;

/** Parses #rgb, #rrggbb, rgb() and rgba() (alpha ignored) into sRGB 0..1. */
function parseCss(value: string): [number, number, number] | null {
  const v = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (rgb) {
    const p = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (p.length >= 3 && p.slice(0, 3).every((x) => Number.isFinite(x))) return [p[0] / 255, p[1] / 255, p[2] / 255];
  }
  return null;
}

/** Reads every token; a missing token falls back to mid-grey rather than throwing. */
export function readPalette(el: Element = document.documentElement): Palette {
  const cs = getComputedStyle(el);
  const out = {} as Palette;
  for (const [key, name] of Object.entries(TOKENS) as [keyof typeof TOKENS, string][]) {
    const rgb = parseCss(cs.getPropertyValue(name)) ?? [0.5, 0.5, 0.5];
    // tokens are sRGB; the shaders light in linear space
    out[key] = new Color().setRGB(rgb[0], rgb[1], rgb[2], SRGBColorSpace);
  }
  return out;
}
