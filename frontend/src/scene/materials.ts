// Materials for the solids. All of them light with the shared key/fill/ambient
// model and write premultiplied alpha, so the whole world dissolves into the page
// the same way. The places the current serves (city, battery bank, solar field)
// take no air and no mist: they stay crisp.
import { NoBlending, ShaderMaterial } from "three";
import { INSTANCE_VERT, LIGHT_GLSL, OUT_PREMUL, shared } from "./glsl";
import type { Palette } from "./palette";

/** Activity levels the engine eases toward the controller state. */
export const activity = {
  uCity: { value: 0 }, // the city's lights (0 while the grid powers up)
  uSolar: { value: 0 }, // solar generation
  uCharge: { value: 0 }, // battery charging
  uDischarge: { value: 0 }, // battery discharging into the city
  uAlarm: { value: 0 }, // overload
};

const solid = (vertexShader: string, fragmentShader: string, uniforms: Record<string, { value: unknown }>) =>
  new ShaderMaterial({ uniforms: { ...shared, ...activity, ...uniforms }, vertexShader, fragmentShader, blending: NoBlending });

const BOX_VERT = /* glsl */ `
  attribute float aSeed;
  varying vec3 vW, vN, vL, vLN, vScale;
  varying float vSeed;
  void main() {
    ${INSTANCE_VERT}
    vW = wp.xyz; vN = wn; vL = position; vLN = normal; vSeed = aSeed;
    vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

/** One-pixel antialiased band: 1 inside [a, b], 0 outside, measured on x. */
const BAND_GLSL = /* glsl */ `
  float band(float x, float a, float b) {
    float w = fwidth(x) * 0.75;
    return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x));
  }
`;

/**
 * Galvanised steel: pylons, poles, gantries, switchgear. Dark, so the hero line
 * reads as a silhouette against the mist and across the paper card, with a thin
 * lit edge where a member turns to the light. Far towers sink into the air.
 */
export function steelMaterial(pal: Palette) {
  return solid(
    /* glsl */ `
      varying vec3 vW, vN;
      varying float vY;
      void main() {
        ${INSTANCE_VERT}
        vW = wp.xyz; vN = wn; vY = position.y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    /* glsl */ `
      ${LIGHT_GLSL}
      uniform vec3 uAlbedo, uEdge;
      varying vec3 vW, vN;
      varying float vY;
      void main() {
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        float dist = distance(vW, cameraPosition);
        float ao = mix(0.6, 1.0, smoothstep(0.0, 60.0, vY));
        vec3 col = shade(N, uAlbedo, ao);
        float k = max(dot(N, uKeyDir), 0.0);
        col += uEdge * pow(k, 5.0) * 0.16 + uEdge * max(N.y, 0.0) * 0.03;
        col = air(col, dist * 0.92);
        float alpha = landAlpha(dist);
        float mist = mistAlpha(vW);
        ${OUT_PREMUL}
      }`,
    {
      uAlbedo: { value: pal.paper.clone().multiplyScalar(0.085) },
      uEdge: { value: pal.flowSolar.clone() },
    },
  );
}

/** Pale architectural-model blocks with lit windows: bright, crisp, never hazed. */
export function buildingMaterial(pal: Palette) {
  return solid(
    BOX_VERT,
    /* glsl */ `
      ${LIGHT_GLSL}
      ${BAND_GLSL}
      uniform vec3 uPaper, uLabel, uWarm, uPale, uGlass, uOver;
      uniform float uCity, uAlarm;
      varying vec3 vW, vN, vL, vLN, vScale;
      varying float vSeed;
      void main() {
        vec3 N = normalize(vN);
        float dist = distance(vW, cameraPosition);
        float up = (vL.y + 0.5) * vScale.y;
        vec3 albedo = mix(uPaper, uLabel, 0.06 + 0.22 * vSeed) * mix(0.74, 0.9, fract(vSeed * 7.3));
        float ao = mix(0.62, 1.0, smoothstep(0.0, 18.0, up));
        vec3 col = shade(N, albedo, ao);
        if (abs(vLN.y) < 0.5) {
          float half_ = (abs(vLN.x) > 0.5 ? vScale.z : vScale.x) * 0.5;
          float across = abs(vLN.x) > 0.5 ? vL.z * vScale.z : vL.x * vScale.x;
          // windows on a grid that starts and ends a margin in from the corners
          float cw = 8.5, ch = 11.0;
          float n = max(1.0, floor((half_ * 2.0 - 5.0) / cw));
          float x0 = across + n * cw * 0.5;
          vec2 cell = vec2(x0 / cw, (up - 6.0) / ch);
          vec2 f = fract(cell), id = floor(cell);
          float win = band(f.x, 0.22, 0.78) * band(f.y, 0.26, 0.8);
          win *= step(0.0, cell.x) * step(cell.x, n) * step(0.0, cell.y) * step(up, vScale.y - 6.0);
          float h = hash12(id + vec2(vSeed * 91.0, vLN.x * 13.0 + vLN.z * 29.0));
          float lit = step(h, 0.62);
          vec3 lamp = mix(uWarm, uPale, step(0.66, fract(h * 13.7)));
          float flick = 1.0 - uAlarm * 0.35 * step(0.6, fract(h * 5.1 + floor(uTime * 6.0) * 0.37));
          col = mix(col, uGlass * (0.45 + 0.4 * ao), win * 0.82);
          col += win * lit * lamp * uCity * flick * mix(1.1, 1.9, fract(h * 3.1));
          col = mix(col, col * 0.7 + uOver * 0.5 * win * lit * uCity, uAlarm * 0.18);
          // the parapet catches the light: a crisp line where the wall meets the roof
          col *= 1.0 + 0.16 * band(up, vScale.y - 2.2, vScale.y + 1.0);
          // and every corner reads as a corner
          col *= 1.0 - 0.18 * band(abs(across), half_ - 0.9, half_ + 1.0);
        } else if (vLN.y > 0.5) {
          // the roof: a parapet rim and a little plant on top
          float ex = (0.5 - abs(vL.x)) * vScale.x, ez = (0.5 - abs(vL.z)) * vScale.z;
          float rim = 1.0 - band(min(ex, ez), 1.6, 1e4);
          col *= mix(0.86, 1.08, rim);
        }
        float alpha = 1.0;
        float mist = 1.0;
        ${OUT_PREMUL}
      }`,
    {
      uPaper: { value: pal.paper.clone() },
      uLabel: { value: pal.paperLabel.clone() },
      uWarm: { value: pal.flowSolar.clone() },
      uPale: { value: pal.voltPale.clone() },
      uGlass: { value: pal.bgDeep.clone() },
      uOver: { value: pal.flowOverload.clone() },
    },
  );
}

/** Battery containers: ribbed pale boxes with a status strip that shows the flow. */
export function batteryMaterial(pal: Palette) {
  return solid(
    BOX_VERT,
    /* glsl */ `
      ${LIGHT_GLSL}
      ${BAND_GLSL}
      uniform vec3 uPaper, uChargeCol, uDisCol, uIdle, uOver;
      uniform float uCharge, uDischarge, uAlarm;
      varying vec3 vW, vN, vL, vLN, vScale;
      varying float vSeed;
      void main() {
        vec3 N = normalize(vN);
        float up = (vL.y + 0.5) * vScale.y;
        float along = (vL.x + 0.5) * vScale.x;
        float rib = 0.88 + 0.12 * band(fract(along / 2.8), 0.0, 0.5);
        vec3 albedo = uPaper * 0.78 * (abs(vLN.y) > 0.5 ? 1.0 : rib);
        vec3 col = shade(N, albedo, mix(0.6, 1.0, smoothstep(0.0, 6.0, up)));
        if (abs(vLN.z) > 0.5) {
          float strip = band(up / vScale.y, 0.62, 0.84);
          float x = vL.x + 0.5;
          // charging: a level that fills and sweeps; discharging: a steady draw that pulses outward
          float sweep = smoothstep(0.0, 0.25, 1.0 - abs(fract(x - uTime * 0.45 - vSeed) - 0.5) * 2.0);
          vec3 lit = uIdle * 0.25
                   + uChargeCol * uCharge * (0.6 + 1.4 * sweep)
                   + uDisCol * uDischarge * (1.6 + 0.8 * sweep);
          lit = mix(lit, uOver * (0.9 + 0.6 * sin(uTime * 7.0)), uAlarm * uDischarge);
          col = mix(col, lit * 1.6, strip);
        }
        float alpha = 1.0;
        float mist = 1.0;
        ${OUT_PREMUL}
      }`,
    {
      uPaper: { value: pal.paper.clone() },
      uChargeCol: { value: pal.flowSolar.clone() },
      uDisCol: { value: pal.flowBattery.clone() },
      uIdle: { value: pal.haze.clone() },
      uOver: { value: pal.flowOverload.clone() },
    },
  );
}

/** Solar tables: dark glass with a crisp cell grid, a glint, and a warm sheen when generating. */
export function panelMaterial(pal: Palette) {
  return solid(
    BOX_VERT,
    /* glsl */ `
      ${LIGHT_GLSL}
      uniform vec3 uGlass, uFrame, uSun;
      uniform float uSolar;
      varying vec3 vW, vN, vL, vLN, vScale;
      varying float vSeed;
      void main() {
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vW);
        vec3 col;
        if (vLN.y > 0.5) {
          vec2 c = vec2((vL.x + 0.5) * vScale.x / 6.4, (vL.z + 0.5) * vScale.z / 5.4);
          vec2 f = abs(fract(c) - 0.5);
          vec2 aa = fwidth(c) * 1.2;
          float line = max(smoothstep(0.5 - aa.x, 0.5, f.x), smoothstep(0.5 - aa.y, 0.5, f.y));
          // the frame round each table
          vec2 e = (0.5 - abs(vL.xz)) * vScale.xz;
          float edge = 1.0 - smoothstep(0.6, 0.6 + fwidth(e.x) * 1.5, min(e.x, e.y));
          col = uGlass;
          float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
          col += uAirCol * 0.22 * fres;
          float spec = pow(max(dot(reflect(-uKeyDir, N), V), 0.0), 24.0);
          col += uKeyCol * spec * 0.4;
          float shimmer = 0.75 + 0.25 * sin(uTime * 1.1 + vW.x * 0.021 + vW.z * 0.013);
          col += uSun * uSolar * 0.12 * shimmer;
          col += uKeyCol * spec * uSolar * 0.5;
          col = mix(col, uFrame, max(line * 0.35, edge * 0.9));
        } else {
          col = shade(N, uFrame, 1.0);
        }
        float alpha = 1.0;
        float mist = 1.0;
        ${OUT_PREMUL}
      }`,
    {
      uGlass: { value: pal.bgNight.clone().multiplyScalar(1.2) },
      uFrame: { value: pal.paper.clone().multiplyScalar(0.42) },
      uSun: { value: pal.flowSolar.clone() },
    },
  );
}

/** Model-railway trees: impostor clumps with a lumpy outline and round relief. */
export function treeMaterial(pal: Palette) {
  return solid(
    /* glsl */ `
      attribute vec3 iPos;
      attribute vec2 iSize;
      attribute float iSeed;
      varying vec2 vUv;
      varying vec3 vW;
      varying float vSeed;
      void main() {
        vec4 mv = viewMatrix * vec4(iPos, 1.0);
        mv.xy += position.xy * iSize;
        vUv = position.xy;
        vSeed = iSeed;
        vW = iPos + vec3(0.0, position.y * iSize.y, 0.0);
        gl_Position = projectionMatrix * mv;
      }`,
    /* glsl */ `
      ${LIGHT_GLSL}
      uniform vec3 uMossA, uMossB, uTint;
      varying vec2 vUv;
      varying vec3 vW;
      varying float vSeed;
      void main() {
        vec2 p = vUv;
        // a lumpy outline: three or four bulges, a flatter base
        float ang = atan(p.y, p.x);
        float lump = 0.84 + 0.1 * sin(ang * 3.0 + vSeed * 40.0) + 0.06 * sin(ang * 7.0 + vSeed * 17.0);
        float rr = length(p * vec2(1.0, p.y < 0.0 ? 1.18 : 1.0));
        if (rr > lump) discard;
        // view-space normal of a bumpy dome, turned into world space
        float zz = sqrt(max(0.0, 1.0 - (rr / lump) * (rr / lump)));
        vec3 nv = normalize(vec3(p / lump, zz * 0.9));
        vec2 q = p * 3.2 + vSeed * 13.0;
        nv = normalize(nv + vec3(vnoise(q) - 0.5, vnoise(q + 7.1) - 0.5, 0.0) * 0.9);
        vec3 N = normalize(transpose(mat3(viewMatrix)) * nv);
        float dist = distance(vW, cameraPosition);
        vec3 albedo = mix(uMossA, uMossB, vSeed) * mix(vec3(1.0), uTint, 0.3) * 2.25;
        albedo *= 0.8 + 0.4 * vnoise(p * 6.0 + vSeed * 31.0);
        float wrap = dot(N, uKeyDir) * 0.5 + 0.5;
        float ao = mix(0.42, 1.0, smoothstep(-0.95, 0.5, p.y)) * mix(0.7, 1.0, zz);
        vec3 col = albedo * (uKeyCol * (0.04 + 0.96 * wrap * wrap) + uAmbCol * (0.32 + 0.68 * (0.5 + 0.5 * N.y))) * ao;
        // the foreground falls into shade: the light lives in the valley
        col *= mix(0.4, 1.0, smoothstep(1000.0, 2100.0, dist));
        col = air(col, dist);
        float alpha = landAlpha(dist);
        float mist = mistAlpha(vW);
        ${OUT_PREMUL}
      }`,
    {
      uMossA: { value: pal.bgDeep.clone() },
      uMossB: { value: pal.haze.clone() },
      uTint: { value: pal.voltPale.clone() },
    },
  );
}
