// Cursor sparks and the dust in the air.
//
// Sparks are electric streaks in screen space: each one is a quad stretched along
// its own velocity, with a thin white-hot core and a faint halo, cooling to lime as
// it dies. They move entirely on the GPU from their birth state, so the CPU only
// writes a spark when it is born (into a ring buffer) and never allocates per frame.
// Heavy drag keeps them short and close to the pointer; a click throws a crisp
// radial burst with a ring of light.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  Vector3,
} from "three";
import { shared } from "./glsl";
import { makeRng } from "./noise";

const GLOW_BLEND = {
  transparent: true,
  side: DoubleSide, // the screen-space quads are drawn y-down, which mirrors their winding
  depthWrite: false,
  blending: CustomBlending,
  blendSrc: OneFactor,
  blendDst: OneFactor,
  blendSrcAlpha: OneFactor,
  blendDstAlpha: OneMinusSrcAlphaFactor,
} as const;

const TAU = Math.PI * 2;

export class Sparks {
  readonly mesh: Mesh;
  readonly max: number;
  readonly material: ShaderMaterial;
  private a: InstancedBufferAttribute; // x0, y0 (CSS px from the canvas top-left), birth, life
  private b: InstancedBufferAttribute; // vx, vy (px/s, y down), drag, heat
  private head = 0;
  private lo = Infinity; // the ring-buffer span written since the last flush
  private hi = -1;
  private rng = makeRng(99);

  constructor(max: number, hot: Color, volt: Color) {
    this.max = max;
    const g = new InstancedBufferGeometry();
    g.setAttribute("corner", new BufferAttribute(new Float32Array([-1, 0, 1, 0, 1, 1, -1, 1]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.a = new InstancedBufferAttribute(new Float32Array(max * 4).fill(-999), 4);
    this.b = new InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.a.setUsage(DynamicDrawUsage);
    this.b.setUsage(DynamicDrawUsage);
    g.setAttribute("iA", this.a);
    g.setAttribute("iB", this.b);
    g.instanceCount = max;
    this.material = new ShaderMaterial({
      uniforms: {
        uTime: shared.uTime,
        uRes: shared.uRes,
        uHot: { value: hot },
        uVolt: { value: volt },
        uPx: { value: 1 }, // device px per CSS px
        uHalo: { value: 3.4 }, // halo half-width, CSS px
        uGrav: { value: 260 }, // px/s^2, a little fall
      },
      vertexShader: /* glsl */ `
        attribute vec2 corner;
        attribute vec4 iA, iB;
        uniform float uTime, uPx, uHalo, uGrav;
        uniform vec2 uRes;
        varying float vT, vAcross, vAlong, vHeat, vSeed;
        vec2 at(float t, vec2 p0, vec2 v0, float drag) {
          return p0 + v0 * (1.0 - exp(-drag * t)) / drag + vec2(0.0, 0.5 * uGrav * t * t);
        }
        void main() {
          float age = uTime - iA.z, life = iA.w;
          if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          vec2 p0 = iA.xy, v0 = iB.xy;
          float drag = iB.z;
          vec2 head = at(age, p0, v0, drag);
          // the streak trails back along the path it has just run (about 28 ms of it)
          vec2 tail = at(max(0.0, age - 0.028), p0, v0, drag);
          vec2 d = head - tail;
          float len = length(d);
          vec2 dir = len > 0.001 ? d / len : vec2(1.0, 0.0);
          if (len < 1.5) { tail = head - dir * 1.5; len = 1.5; }
          vec2 nrm = vec2(-dir.y, dir.x);
          vT = age / life;
          vec2 base = mix(tail, head, corner.y) + dir * (corner.y * 2.0 - 1.0) * uHalo * 0.6;
          vec2 px = base + nrm * corner.x * uHalo;
          // CSS px from the top-left to clip space
          vec2 ndc = vec2(px.x * uPx / uRes.x * 2.0 - 1.0, 1.0 - px.y * uPx / uRes.y * 2.0);
          gl_Position = vec4(ndc, 0.0, 1.0);
          vAcross = corner.x * uHalo;
          vAlong = corner.y;
          vHeat = iB.w;
          vSeed = fract(iA.x * 0.131 + iA.y * 0.173 + iA.z * 3.7);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uHot, uVolt;
        uniform float uTime, uPx;
        varying float vT, vAcross, vAlong, vHeat, vSeed;
        void main() {
          float dpx = abs(vAcross);
          // a crisp core about a pixel wide, inside a faint halo
          float core = 1.0 - smoothstep(0.25, 0.25 + 0.9 / uPx + 0.35, dpx);
          float halo = exp(-dpx * dpx / 2.4) * 0.24;
          float along = smoothstep(0.0, 0.7, vAlong) * (1.0 - smoothstep(0.92, 1.0, vAlong) * 0.6);
          float cool = smoothstep(0.0, 0.55, vT);
          float fade = pow(1.0 - vT, 1.6);
          float flick = 0.72 + 0.28 * step(0.45, fract(uTime * 37.0 + vSeed * 11.0));
          vec3 hotCol = mix(uHot, uVolt, cool * (1.0 - 0.5 * vHeat));
          vec3 c = (hotCol * core * 2.1 + uVolt * halo) * along * fade * flick * (0.75 + 0.45 * vHeat);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
          gl_FragColor.a = 0.0; // light only
        }`,
      ...GLOW_BLEND,
      depthTest: false,
    });
    this.mesh = new Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  /** One spark at (x, y) CSS px, moving at (vx, vy) px/s. */
  emit(x: number, y: number, vx: number, vy: number, drag: number, life: number, heat: number, now: number) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    const A = this.a.array as Float32Array, B = this.b.array as Float32Array;
    A[i * 4] = x; A[i * 4 + 1] = y; A[i * 4 + 2] = now; A[i * 4 + 3] = life;
    B[i * 4] = vx; B[i * 4 + 1] = vy; B[i * 4 + 2] = drag; B[i * 4 + 3] = heat;
    if (i < this.lo) this.lo = i;
    if (i > this.hi) this.hi = i;
  }

  /**
   * Sparks thrown off the pointer as it moves: most are short and stay within a few
   * dozen pixels (dense at the pointer), a few shoot further.
   */
  trail(x: number, y: number, mvx: number, mvy: number, count: number, now: number) {
    const r = this.rng;
    for (let i = 0; i < count; i++) {
      const far = r() < 0.3;
      const ang = r() * TAU, sp = far ? 900 + r() * 700 : 260 + r() * 520;
      const jx = (r() - 0.5) * 4, jy = (r() - 0.5) * 4;
      this.emit(x + jx, y + jy, Math.cos(ang) * sp + mvx * 0.3, Math.sin(ang) * sp + mvy * 0.3,
        far ? 8 + r() * 3 : 13 + r() * 5, far ? 0.18 + r() * 0.16 : 0.12 + r() * 0.14, 0.6 + 0.4 * r(), now);
    }
  }

  /** A crisp radial burst: evenly spaced streaks, plus a few slower embers. */
  burst(x: number, y: number, count: number, now: number) {
    const r = this.rng;
    const off = r() * TAU;
    for (let i = 0; i < count; i++) {
      const ang = off + ((i + (r() - 0.5) * 0.5) / count) * TAU, sp = 820 + r() * 620;
      this.emit(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, 7 + r() * 2, 0.24 + r() * 0.16, 1, now);
    }
    for (let i = 0; i < Math.round(count * 0.35); i++) {
      const ang = r() * TAU, sp = 240 + r() * 420;
      this.emit(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, 6, 0.3 + r() * 0.25, 0.4, now);
    }
  }

  flush() {
    if (this.hi < 0) return;
    for (const attr of [this.a, this.b]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(this.lo * 4, (this.hi - this.lo + 1) * 4);
      attr.needsUpdate = true;
    }
    this.lo = Infinity;
    this.hi = -1;
  }
}

/** The ring of light at the heart of a click burst: a hot core and a thin expanding ring. */
export function buildFlash(hot: Color, volt: Color) {
  const material = new ShaderMaterial({
    uniforms: {
      uTime: shared.uTime,
      uRes: shared.uRes,
      uHot: { value: hot },
      uVolt: { value: volt },
      uBirth: { value: -99 },
      uAt: { value: new Vector3() }, // x, y CSS px, device px per CSS px
    },
    vertexShader: /* glsl */ `
      uniform vec2 uRes;
      uniform vec3 uAt;
      varying vec2 vP;
      void main() {
        vP = position.xy * 64.0; // CSS px from the centre
        vec2 px = uAt.xy + vP;
        gl_Position = vec4(px.x * uAt.z / uRes.x * 2.0 - 1.0, 1.0 - px.y * uAt.z / uRes.y * 2.0, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uHot, uVolt, uAt;
      uniform float uTime, uBirth;
      varying vec2 vP;
      void main() {
        float age = uTime - uBirth;
        if (age < 0.0 || age > 0.34) discard;
        float r = length(vP);
        float ringR = 6.0 + 52.0 * (1.0 - exp(-age * 9.0));
        float w = 0.7 + 0.6 / uAt.z;
        float ring = (1.0 - smoothstep(w, w + 1.0, abs(r - ringR))) * pow(1.0 - age / 0.34, 2.0);
        float core = exp(-r * r / 30.0) * exp(-age * 22.0);
        float halo = exp(-r * r / 700.0) * exp(-age * 12.0) * 0.18;
        vec3 c = uHot * (core * 1.6 + ring * 0.9) + uVolt * (halo + ring * 0.5);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
        gl_FragColor.a = 0.0;
      }`,
    ...GLOW_BLEND,
    depthTest: false,
  });
  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  mesh.renderOrder = 7;
  mesh.frustumCulled = false;
  return mesh;
}

/** Dust in the air, drifting slowly: the page's depth of field without the cost. */
export function buildMotes(count: number, positions: Vector3[], ink: Color) {
  const rng = makeRng(311);
  const pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const p = positions[i % positions.length];
    pos.set([p.x, p.y, p.z], i * 3);
    seed[i] = rng();
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("aSeed", new BufferAttribute(seed, 1));
  const material = new ShaderMaterial({
    uniforms: { ...shared, uInk: { value: ink }, uSize: { value: 3 }, uScale: { value: 400 } },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime, uSize, uScale;
      varying float vA;
      void main() {
        vec3 p = position;
        float t = uTime + aSeed * 100.0;
        p += vec3(sin(t * 0.11) * 26.0, sin(t * 0.07 + aSeed * 9.0) * 16.0 + cos(t * 0.05) * 8.0, cos(t * 0.09) * 20.0);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * (0.6 + aSeed) * uScale / -mv.z;
        vA = (0.18 + 0.32 * aSeed) * (0.65 + 0.35 * sin(t * 0.8 + aSeed * 20.0));
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uInk;
      varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.1, length(c)) * vA;
        gl_FragColor = vec4(uInk, 1.0);
        #include <colorspace_fragment>
        gl_FragColor.rgb *= a;
        gl_FragColor.a = a;
      }`,
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  });
  const points = new Points(g, material);
  points.frustumCulled = false;
  points.renderOrder = 5;
  return points;
}

/** A soft additive pool of light (the valley's glow behind the city, the battery's glow). */
export function buildLightPool(color: Color, strength: number) {
  const material = new ShaderMaterial({
    uniforms: { uCol: { value: color }, uStrength: { value: strength }, uOpaqueLight: shared.uOpaqueLight },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCol;
      uniform float uStrength, uOpaqueLight;
      varying vec2 vUv;
      void main() {
        vec2 p = (vUv - vec2(0.5, 0.42)) * vec2(2.0, 2.6);
        float r = dot(p, p);
        float g = pow(max(0.0, 1.0 - r), 2.4) * uStrength;
        gl_FragColor = vec4(uCol * g, 1.0);
        #include <colorspace_fragment>
        gl_FragColor.a = uOpaqueLight * clamp(max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b)), 0.0, 1.0); // light only, live
      }`,
    ...GLOW_BLEND,
  });
  const mesh = new Mesh(new PlaneGeometry(1, 1), material);
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  return mesh;
}
