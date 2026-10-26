// The land: a frustum-shaped height-field mesh (even detail on screen from the
// foreground to the haze), shaded as dark moss, plus a painted ground map that
// carries every structure's contact shadow and the city's light spill.
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  LinearFilter,
  Mesh,
  NoBlending,
  ShaderMaterial,
  Vector4,
} from "three";
import { LIGHT_GLSL, OUT_PREMUL, shared } from "./glsl";
import type { Palette } from "./palette";
import { CAM_Z, heightAt } from "./world";

const MAP_SIZE = 1024;
const MAP_X0 = -3000, MAP_Z0 = -5200, MAP_W = 6000, MAP_D = 6400;

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
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
  }

  private px(x: number) { return ((x - MAP_X0) / MAP_W) * MAP_SIZE; }
  private pz(z: number) { return ((z - MAP_Z0) / MAP_D) * MAP_SIZE; }
  private s(r: number) { return (r / MAP_W) * MAP_SIZE; }

  private blob(x: number, z: number, r: number, rgb: string, a: number) {
    const cx = this.px(x), cz = this.pz(z), rr = Math.max(0.6, this.s(r));
    const g = this.ctx.createRadialGradient(cx, cz, 0, cx, cz, rr);
    g.addColorStop(0, `rgba(${rgb},${a})`);
    g.addColorStop(0.45, `rgba(${rgb},${a * 0.55})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    this.ctx.fillStyle = g;
    this.ctx.fillRect(cx - rr, cz - rr, rr * 2, rr * 2);
  }

  /** A soft contact shadow under something of radius r, cast slightly away from the light. */
  shadow(x: number, z: number, r: number, strength = 0.7) {
    this.blob(x + r * this.shiftX, z + r * this.shiftZ, r * 1.45, "255,0,0", strength);
  }

  /** A soft rectangular shadow (buildings, panels, containers). */
  shadowRect(x: number, z: number, w: number, d: number, rot: number, strength = 0.55) {
    const c = this.ctx;
    c.save();
    c.translate(this.px(x + w * 0.12 * this.shiftX * 2), this.pz(z + d * 0.12 * this.shiftZ * 2));
    c.rotate(rot);
    c.filter = `blur(${Math.max(1, this.s(Math.min(w, d)) * 0.35)}px)`;
    c.fillStyle = `rgba(255,0,0,${strength})`;
    c.fillRect(-this.s(w) * 0.56, -this.s(d) * 0.56, this.s(w) * 1.12, this.s(d) * 1.12);
    c.restore();
  }

  glow(x: number, z: number, r: number, strength: number) {
    this.blob(x, z, r, "0,255,0", strength);
  }

  /** A road (blue channel), a soft-edged stroke along the points. */
  road(pts: { x: number; z: number }[], width: number) {
    const c = this.ctx;
    c.save();
    c.strokeStyle = "rgba(0,0,255,0.9)";
    c.lineWidth = Math.max(1.5, this.s(width));
    c.lineCap = c.lineJoin = "round";
    c.filter = "blur(0.6px)";
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(this.px(p.x), this.pz(p.z)) : c.moveTo(this.px(p.x), this.pz(p.z))));
    c.stroke();
    c.restore();
  }
}

export function buildTerrain(pal: Palette, ground: GroundMap, rows = 170, cols = 300) {
  const D_MIN = 240, D_MAX = 7400, SPREAD = 1.08;
  const pos = new Float32Array(rows * cols * 3);
  for (let j = 0; j < rows; j++) {
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
      uRoad: { value: pal.paperLabel.clone().multiplyScalar(0.62) },
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
      uniform vec3 uMossLow, uMossHigh, uMossDark, uTint, uSpill, uRoad;
      uniform float uCity;
      varying vec3 vW;
      varying vec3 vN;
      void main() {
        vec3 N = normalize(vN);
        float dist = distance(vW, cameraPosition);
        vec2 p = vW.xz;
        // micro-relief: a bump from a small noise field, fading out with distance
        float fine = 1.0 - smoothstep(700.0, 2600.0, dist);
        float e = 3.0;
        vec2 q = p * 0.09;
        float bx = vnoise(q + vec2(0.05, 0.0)) - vnoise(q - vec2(0.05, 0.0));
        float bz = vnoise(q + vec2(0.0, 0.05)) - vnoise(q - vec2(0.0, 0.05));
        N = normalize(N + vec3(-bx, 0.0, -bz) * e * fine);
        // moss: broad patches, mottling, and a fine fuzz up close
        float n1 = vnoise(p * 0.0026), n2 = vnoise(p * 0.012), n3 = vnoise(p * 0.05);
        float fuzz = (vnoise(p * 0.31) - 0.5) * fine;
        float n = n1 * 0.5 + n2 * 0.32 + n3 * 0.18;
        vec3 albedo = mix(uMossLow, uMossHigh, smoothstep(0.22, 0.82, n));
        albedo *= 1.0 + fuzz * 0.7;
        // farmland on the gentle valley floor: fields of slightly different tone,
        // some with crop rows, edged by darker hedges
        vec2 fp = mat2(0.94, -0.34, 0.34, 0.94) * p / 150.0;
        vec2 fid = floor(fp), ff = fract(fp);
        float fh = hash12(fid);
        float farm = smoothstep(0.955, 0.99, N.y) * (1.0 - smoothstep(2600.0, 4200.0, dist)) * step(0.28, fh);
        float rows = 0.5 + 0.5 * sin((fh > 0.6 ? ff.x : ff.y) * 60.0);
        float hedge = smoothstep(0.035, 0.0, min(min(ff.x, 1.0 - ff.x), min(ff.y, 1.0 - ff.y)));
        albedo *= 1.0 + farm * ((fh - 0.6) * 0.32 + (rows - 0.5) * 0.06 * step(0.5, fh) * fine - hedge * 0.35);
        albedo = mix(albedo, uMossDark, smoothstep(0.3, 0.72, 1.0 - N.y) * 0.8);
        // the lit tops of the hills take a little of the pale green
        albedo = mix(albedo, albedo * uTint * 1.7, smoothstep(0.8, 0.99, N.y) * 0.3 * (0.5 + n2));
        albedo *= 2.2;
        vec3 g = texture2D(uGround, (vW.xz - uGroundRect.xy) * uGroundRect.zw).rgb;
        albedo = mix(albedo, uRoad * (0.85 + 0.3 * n3), smoothstep(0.15, 0.6, g.b));
        float ao = 1.0 - g.r * 0.82;
        vec3 col = shade(N, albedo, ao);
        // moss catches the light at grazing angles, as Sylva's crowns do
        vec3 V = normalize(cameraPosition - vW);
        col += albedo * uKeyCol * pow(1.0 - max(dot(N, V), 0.0), 3.0) * max(dot(N, uKeyDir), 0.0) * 0.35;
        col += uSpill * g.g * uCity * 0.3;
        // the foreground falls into shade: the light lives in the valley
        col *= mix(0.55, 1.0, smoothstep(650.0, 2100.0, dist));
        col = air(col, dist);
        float alpha = landAlpha(dist);
        ${OUT_PREMUL}
      }`,
    blending: NoBlending,
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 0;
  return { mesh, material: mat };
}
