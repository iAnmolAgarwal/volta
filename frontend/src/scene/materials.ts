// Materials for the solids. All of them light with the shared key/fill/ambient
// model, sink into the air with distance and write premultiplied alpha, so the
// whole world dissolves into the page the same way.
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

/** Galvanised steel: pylons, poles, gantries, switchgear. */
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
      uniform vec3 uAlbedo;
      varying vec3 vW, vN;
      varying float vY;
      void main() {
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        float dist = distance(vW, cameraPosition);
        float ao = mix(0.55, 1.0, smoothstep(0.0, 40.0, vY));
        vec3 col = shade(N, uAlbedo, ao);
        // a thin bright edge where the member turns to the light
        col += uKeyCol * pow(max(dot(N, uKeyDir), 0.0), 6.0) * 0.12;
        col = air(col, dist * 1.04);
        float alpha = landAlpha(dist);
        ${OUT_PREMUL}
      }`,
    { uAlbedo: { value: pal.paper.clone().multiplyScalar(0.46) } },
  );
}

/** Pale architectural-model blocks with lit windows. */
export function buildingMaterial(pal: Palette) {
  return solid(
    /* glsl */ `
      attribute float aSeed;
      varying vec3 vW, vN, vL, vLN, vScale;
      varying float vSeed;
      void main() {
        ${INSTANCE_VERT}
        vW = wp.xyz; vN = wn; vL = position; vLN = normal; vSeed = aSeed;
        vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    /* glsl */ `
      ${LIGHT_GLSL}
      uniform vec3 uPaper, uLabel, uWarm, uPale, uGlass, uOver;
      uniform float uCity, uAlarm;
      varying vec3 vW, vN, vL, vLN, vScale;
      varying float vSeed;
      void main() {
        vec3 N = normalize(vN);
        float dist = distance(vW, cameraPosition);
        float up = (vL.y + 0.5) * vScale.y;
        vec3 albedo = mix(uPaper, uLabel, 0.18 + 0.3 * vSeed) * mix(0.5, 0.68, fract(vSeed * 7.3));
        float ao = mix(0.5, 1.0, smoothstep(0.0, 22.0, up));
        vec3 col = shade(N, albedo, ao);
        if (abs(vLN.y) < 0.5) {
          float across = abs(vLN.x) > 0.5 ? vL.z * vScale.z : vL.x * vScale.x;
          vec2 cell = vec2(across / 7.0, up / 9.5);
          vec2 f = fract(cell), id = floor(cell);
          vec2 aa = fwidth(cell) * 0.7;
          float win = smoothstep(0.24 - aa.x, 0.24 + aa.x, f.x) * (1.0 - smoothstep(0.76 - aa.x, 0.76 + aa.x, f.x))
                    * smoothstep(0.3 - aa.y, 0.3 + aa.y, f.y) * (1.0 - smoothstep(0.8 - aa.y, 0.8 + aa.y, f.y));
          win *= step(1.0, id.y) * step(up, vScale.y - 5.0);
          float h = hash12(id + vec2(vSeed * 91.0, vLN.x * 13.0 + vLN.z * 29.0));
          float lit = step(h, 0.58);
          vec3 lamp = mix(uWarm, uPale, step(0.7, fract(h * 13.7)));
          float flick = 1.0 - uAlarm * 0.35 * step(0.6, fract(h * 5.1 + floor(uTime * 6.0) * 0.37));
          col = mix(col, uGlass * (0.5 + 0.5 * ao), win * 0.75);
          col += win * lit * lamp * uCity * flick * mix(1.2, 2.1, fract(h * 3.1));
          col = mix(col, col * 0.7 + uOver * 0.5 * win * lit * uCity, uAlarm * 0.18);
        }
        col = air(col, dist);
        float alpha = landAlpha(dist);
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
    /* glsl */ `
      attribute float aSeed;
      varying vec3 vW, vN, vL, vLN, vScale;
      varying float vSeed;
      void main() {
        ${INSTANCE_VERT}
        vW = wp.xyz; vN = wn; vL = position; vLN = normal; vSeed = aSeed;
        vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    /* glsl */ `
      ${LIGHT_GLSL}
      uniform vec3 uPaper, uChargeCol, uDisCol, uIdle, uOver;
      uniform float uCharge, uDischarge, uAlarm;
      varying vec3 vW, vN, vL, vLN, vScale;
      varying float vSeed;
      void main() {
        vec3 N = normalize(vN);
        float dist = distance(vW, cameraPosition);
        float up = (vL.y + 0.5) * vScale.y;
        float along = (vL.x + 0.5) * vScale.x;
        float rib = 0.9 + 0.1 * step(0.5, fract(along / 2.6));
        vec3 albedo = uPaper * 0.62 * (abs(vLN.y) > 0.5 ? 1.0 : rib);
        vec3 col = shade(N, albedo, mix(0.55, 1.0, smoothstep(0.0, 6.0, up)));
        if (abs(vLN.z) > 0.5) {
          float strip = smoothstep(0.6, 1.1, up / vScale.y * 1.25 - 0.1) * (1.0 - smoothstep(0.86, 0.9, up / vScale.y));
          float x = vL.x + 0.5;
          // charging: a level that fills and sweeps; discharging: a steady draw that pulses outward
          float sweep = smoothstep(0.0, 0.25, 1.0 - abs(fract(x - uTime * 0.45 - vSeed) - 0.5) * 2.0);
          vec3 lit = uIdle * 0.25
                   + uChargeCol * uCharge * (0.6 + 1.4 * sweep)
                   + uDisCol * uDischarge * (1.4 + 0.8 * sweep);
          lit = mix(lit, uOver * (0.8 + 0.6 * sin(uTime * 7.0)), uAlarm * uDischarge);
          col = mix(col, lit * 1.6, strip);
        }
        col = air(col, dist);
        float alpha = landAlpha(dist);
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

/** Solar tables: dark glass with a cell grid, a glint, and a warm sheen when generating. */
export function panelMaterial(pal: Palette) {
  return solid(
    /* glsl */ `
      varying vec3 vW, vN, vL, vLN, vScale;
      void main() {
        ${INSTANCE_VERT}
        vW = wp.xyz; vN = wn; vL = position; vLN = normal;
        vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    /* glsl */ `
      ${LIGHT_GLSL}
      uniform vec3 uGlass, uFrame, uSun;
      uniform float uSolar;
      varying vec3 vW, vN, vL, vLN, vScale;
      void main() {
        vec3 N = normalize(vN);
        float dist = distance(vW, cameraPosition);
        vec3 V = normalize(cameraPosition - vW);
        vec3 col;
        if (vLN.y > 0.5) {
          vec2 c = vec2((vL.x + 0.5) * vScale.x / 6.2, (vL.z + 0.5) * vScale.z / 5.3);
          vec2 f = abs(fract(c) - 0.5);
          vec2 aa = fwidth(c) * 1.5;
          float line = max(smoothstep(0.5 - aa.x, 0.5, f.x), smoothstep(0.5 - aa.y, 0.5, f.y));
          col = uGlass;
          float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
          col += uAirCol * 0.18 * fres;
          float spec = pow(max(dot(reflect(-uKeyDir, N), V), 0.0), 24.0);
          col += uKeyCol * spec * 0.4;
          float shimmer = 0.75 + 0.25 * sin(uTime * 1.1 + vW.x * 0.021 + vW.z * 0.013);
          col += uSun * uSolar * 0.1 * shimmer;
          col += uKeyCol * spec * uSolar * 0.5;
          col = mix(col, uFrame, line * 0.3);
        } else {
          col = shade(N, uFrame, 1.0);
        }
        col = air(col, dist);
        float alpha = landAlpha(dist);
        ${OUT_PREMUL}
      }`,
    {
      uGlass: { value: pal.bgNight.clone().multiplyScalar(1.15) },
      uFrame: { value: pal.paper.clone().multiplyScalar(0.24) },
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
        col *= mix(0.55, 1.0, smoothstep(650.0, 2100.0, dist));
        col = air(col, dist);
        float alpha = landAlpha(dist);
        ${OUT_PREMUL}
      }`,
    {
      uMossA: { value: pal.bgDeep.clone() },
      uMossB: { value: pal.haze.clone() },
      uTint: { value: pal.voltPale.clone() },
    },
  );
}
