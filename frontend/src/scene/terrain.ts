// The land: a frustum-shaped height-field mesh (even detail on screen from the
// foreground to the haze), shaded as dark moss, plus a painted ground map that
// carries every structure's contact shadow and the city's light spill, and the
// gravel roads, laid on it as ribbons so their edges stay crisp.
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoBlending,
  ShaderMaterial,
  Vector4,
} from "three";
import { LIGHT_GLSL, OUT_PREMUL, shared } from "./glsl";
import type { Palette } from "./palette";
import type { Slicer } from "./slice";
import { CAM_Z, heightAt, type XZ } from "./world";

// The map covers only the valley where things stand, so its texels stay small:
// about 1.4 world units, under a CSS pixel even at the city.
const MAP_SIZE = 2048;
const MAP_X0 = -1750, MAP_Z0 = -1950, MAP_W = 2900, MAP_D = 2900;

/** Contact shadows (red) and light spill (green), painted once at build time. */
export class GroundMap {
  readonly canvas = document.createElement("canvas");
  readonly texture: CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  // shadows fall away from the key light (from the upper left, in front)
  private shiftX = 0.32;
  private shiftZ = -0.36;

  constructor() {
    this.canvas.width = this.canvas.height = MAP_SIZE;
    this.ctx = this.canvas.getContext("2d")!;
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    this.ctx.globalCompositeOperation = "lighter";
    this.texture = new CanvasTexture(this.canvas);
    this.texture.flipY = false;
    this.texture.generateMipmaps = true;
    this.texture.minFilter = LinearMipmapLinearFilter;
    this.texture.magFilter = LinearFilter;
  }

  private px(x: number) { return ((x - MAP_X0) / MAP_W) * MAP_SIZE; }
  private pz(z: number) { return ((z - MAP_Z0) / MAP_D) * MAP_SIZE; }
  private s(r: number) { return (r / MAP_W) * MAP_SIZE; }

  private sprites = new Map<string, HTMLCanvasElement>();

  /** A soft round stamp in one channel, drawn once and reused: far cheaper than a gradient per blob. */
  private sprite(rgb: string) {
    let c = this.sprites.get(rgb);
    if (!c) {
      c = document.createElement("canvas");
      c.width = c.height = 64;
      const x = c.getContext("2d")!;
      const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, `rgba(${rgb},1)`);
      g.addColorStop(0.45, `rgba(${rgb},0.55)`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      x.fillStyle = g;
      x.fillRect(0, 0, 64, 64);
      this.sprites.set(rgb, c);
    }
    return c;
  }

  private blob(x: number, z: number, r: number, rgb: string, a: number) {
    const cx = this.px(x), cz = this.pz(z), rr = Math.max(0.6, this.s(r));
    if (cx < -rr || cz < -rr || cx > MAP_SIZE + rr || cz > MAP_SIZE + rr) return;
    this.ctx.globalAlpha = Math.min(1, a);
    this.ctx.drawImage(this.sprite(rgb), cx - rr, cz - rr, rr * 2, rr * 2);
    this.ctx.globalAlpha = 1;
  }

  /** A soft contact shadow under something of radius r, cast slightly away from the light. */
  shadow(x: number, z: number, r: number, strength = 0.7) {
    this.blob(x + r * this.shiftX, z + r * this.shiftZ, r * 1.45, "255,0,0", strength);
  }

  /**
   * A rectangular contact shadow (buildings, panels, containers): a tight dark core
   * on the footprint, cast a little away from the light, inside a soft halo. Drawn
   * as stacked rectangles, not with a canvas blur filter (slow, and soft at the base).
   */
  shadowRect(x: number, z: number, w: number, d: number, rot: number, strength = 0.55) {
    const c = this.ctx;
    c.save();
    c.translate(this.px(x + 3 * this.shiftX), this.pz(z + 3 * this.shiftZ));
    c.rotate(rot);
    const sw = this.s(w), sd = this.s(d);
    const rings: [number, number][] = [[7, 0.1], [4, 0.14], [2, 0.2], [0.6, 0.56]];
    for (const [grow, a] of rings) {
      const g = this.s(grow);
      c.fillStyle = `rgba(255,0,0,${a * strength * 1.6})`;
      c.fillRect(-sw / 2 - g, -sd / 2 - g, sw + 2 * g, sd + 2 * g);
    }
    c.restore();
  }

  glow(x: number, z: number, r: number, strength: number) {
    this.blob(x, z, r, "0,255,0", strength);
  }
}

export async function buildTerrain(pal: Palette, ground: GroundMap, slice: Slicer, rows = 176, cols = 300) {
  const D_MIN = 240, D_MAX = 5200, SPREAD = 1.08;
  const pos = new Float32Array(rows * cols * 3);
  for (let j = 0; j < rows; j++) {
    await slice();
    const d = D_MIN * Math.pow(D_MAX / D_MIN, j / (rows - 1));
    const z = CAM_Z - d;
    for (let i = 0; i < cols; i++) {
      const x = (i / (cols - 1) * 2 - 1) * SPREAD * d;
      const o = (j * cols + i) * 3;
      pos[o] = x;
      pos[o + 1] = heightAt(x, z);
      pos[o + 2] = z;
    }
  }
  const idx = new Uint32Array((rows - 1) * (cols - 1) * 6);
  let k = 0;
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      // wound so the faces point up, toward the camera above them
      idx[k++] = a; idx[k++] = b; idx[k++] = c;
      idx[k++] = b; idx[k++] = d; idx[k++] = c;
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  geo.setIndex(new BufferAttribute(idx, 1));
  geo.computeVertexNormals();

  const mat = new ShaderMaterial({
    uniforms: {
      ...shared,
      uGround: { value: ground.texture },
      uGroundRect: { value: new Vector4(MAP_X0, MAP_Z0, 1 / MAP_W, 1 / MAP_D) },
      uMossLow: { value: pal.bgDeep.clone() },
      uMossHigh: { value: pal.haze.clone() },
      uMossDark: { value: pal.bgNight.clone() },
      uTint: { value: pal.voltPale.clone() },
      uSpill: { value: new Color().copy(pal.flowSolar) },
      uCity: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      varying vec3 vN;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${LIGHT_GLSL}
      uniform sampler2D uGround;
      uniform vec4 uGroundRect;
      uniform vec3 uMossLow, uMossHigh, uMossDark, uTint, uSpill;
      uniform float uCity;
      varying vec3 vW;
      varying vec3 vN;
      void main() {
        vec3 N = normalize(vN);
        float dist = distance(vW, cameraPosition);
        vec2 p = vW.xz;
        // micro-relief: a bump from a small noise field, fading out with distance
        float fine = 1.0 - smoothstep(700.0, 2600.0, dist);
        vec2 q = p * 0.09;
        float bx = vnoise(q + vec2(0.05, 0.0)) - vnoise(q - vec2(0.05, 0.0));
        float bz = vnoise(q + vec2(0.0, 0.05)) - vnoise(q - vec2(0.0, 0.05));
        N = normalize(N + vec3(-bx, 0.0, -bz) * 3.0 * fine);
        // moss: broad patches, mottling, and a fine fuzz up close
        float n1 = vnoise(p * 0.0026), n2 = vnoise(p * 0.012), n3 = vnoise(p * 0.05);
        float fuzz = (vnoise(p * 0.31) - 0.5) * fine;
        float n = n1 * 0.5 + n2 * 0.32 + n3 * 0.18;
        vec3 albedo = mix(uMossLow, uMossHigh, smoothstep(0.22, 0.82, n));
        albedo *= 1.0 + fuzz * 0.7;
        // farmland on the gentle terraces: fields of slightly different tone,
        // some with crop rows, edged by darker hedges
        vec2 fp = mat2(0.94, -0.34, 0.34, 0.94) * p / 130.0;
        vec2 fid = floor(fp), ff = fract(fp);
        float fh = hash12(fid);
        float farm = smoothstep(0.96, 0.99, N.y) * (1.0 - smoothstep(2600.0, 3800.0, dist)) * step(0.3, fh);
        float rows = 0.5 + 0.5 * sin((fh > 0.6 ? ff.x : ff.y) * 60.0);
        float hedge = smoothstep(0.035, 0.0, min(min(ff.x, 1.0 - ff.x), min(ff.y, 1.0 - ff.y)));
        albedo *= 1.0 + farm * ((fh - 0.6) * 0.32 + (rows - 0.5) * 0.06 * step(0.5, fh) * fine - hedge * 0.35);
        albedo = mix(albedo, uMossDark, smoothstep(0.3, 0.72, 1.0 - N.y) * 0.8);
        // the lit tops of the hills take a little of the pale green
        albedo = mix(albedo, albedo * uTint * 1.7, smoothstep(0.8, 0.99, N.y) * 0.34 * (0.5 + n2));
        albedo *= 2.2;
        vec3 g = texture2D(uGround, (vW.xz - uGroundRect.xy) * uGroundRect.zw).rgb;
        float ao = 1.0 - g.r * 0.85;
        vec3 col = shade(N, albedo, ao);
        // moss catches the light at grazing angles, as Sylva's crowns do
        vec3 V = normalize(cameraPosition - vW);
        col += albedo * uKeyCol * pow(1.0 - max(dot(N, V), 0.0), 3.0) * max(dot(N, uKeyDir), 0.0) * 0.35;
        col += uSpill * g.g * uCity * 0.34;
        // the foreground falls into shade: the light lives in the valley
        col *= mix(0.36, 1.0, smoothstep(950.0, 2000.0, dist));
        col = air(col, dist);
        float alpha = landAlpha(dist);
        float mist = mistAlpha(vW);
        ${OUT_PREMUL}
      }`,
    blending: NoBlending,
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 0;
  return { mesh, material: mat };
}

/** Gravel roads: ribbons laid on the land, lit like it, sinking into the mist with it. */
export function buildRoads(pal: Palette, roads: XZ[][], width: number) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const road of roads) {
    // resample along the road, so the ribbon hugs the ground
    const pts: XZ[] = [];
    for (let i = 0; i < road.length - 1; i++) {
      const a = road[i], b = road[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 10));
      for (let k = 0; k < n; k++) pts.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
    }
    pts.push(road[road.length - 1]);
    const base = pos.length / 3;
    let along = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], r = pts[Math.max(0, i - 1)];
      let tx = q.x - r.x, tz = q.z - r.z;
      const l = Math.hypot(tx, tz) || 1;
      tx /= l; tz /= l;
      if (i > 0) along += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
      for (const sd of [-1, 1]) {
        const x = p.x - tz * sd * width * 0.5, z = p.z + tx * sd * width * 0.5;
        pos.push(x, heightAt(x, z) + 0.9, z);
        uv.push(sd, along);
      }
      if (i < pts.length - 1) {
        const a = base + i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
  geo.setIndex(idx);
  const mat = new ShaderMaterial({
    uniforms: { ...shared, uRoad: { value: pal.paperLabel.clone().multiplyScalar(0.7) } },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      varying vec2 vUv;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz; vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${LIGHT_GLSL}
      uniform vec3 uRoad;
      varying vec3 vW;
      varying vec2 vUv;
      void main() {
        float dist = distance(vW, cameraPosition);
        // a worn, gravelled surface with softer verges
        float grit = 0.88 + 0.24 * vnoise(vW.xz * 0.6);
        float verge = 1.0 - 0.3 * smoothstep(0.6, 1.0, abs(vUv.x));
        vec3 col = shade(vec3(0.0, 1.0, 0.0), uRoad * grit * verge, 1.0);
        col *= mix(0.36, 1.0, smoothstep(950.0, 2000.0, dist));
        col = air(col, dist);
        float alpha = landAlpha(dist);
        float mist = mistAlpha(vW);
        ${OUT_PREMUL}
      }`,
    blending: NoBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}
