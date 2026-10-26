// Cursor sparks and the dust in the air.
//
// Sparks are streaks: each one is a quad stretched along its own velocity, moved
// entirely on the GPU from its birth state, so the CPU only writes a spark when it
// is born (into a ring buffer) and never allocates per frame.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
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
  depthWrite: false,
  blending: CustomBlending,
  blendSrc: OneFactor,
  blendDst: OneFactor,
  blendSrcAlpha: OneFactor,
  blendDstAlpha: OneMinusSrcAlphaFactor,
} as const;

export class Sparks {
  readonly mesh: Mesh;
  readonly max: number;
  private a: InstancedBufferAttribute; // p0.xyz, birth
  private b: InstancedBufferAttribute; // v0.xyz, life
  private head = 0;
  private dirty = false;
  private rng = makeRng(99);
  /** world units per CSS pixel at the spark plane, set on layout so sparks look the same at any size */
  scale = 1;
  readonly material: ShaderMaterial;

  constructor(max: number, hot: Color, volt: Color) {
    this.max = max;
    const g = new InstancedBufferGeometry();
    g.setAttribute("corner", new BufferAttribute(new Float32Array([-1, 0, 1, 0, 1, 1, -1, 1]), 2));
    // wound counter-clockwise once the vertex shader turns the quad along the streak
    g.setIndex([0, 2, 1, 0, 3, 2]);
    this.a = new InstancedBufferAttribute(new Float32Array(max * 4).fill(-999), 4);
    this.b = new InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.a.setUsage(DynamicDrawUsage);
    this.b.setUsage(DynamicDrawUsage);
    g.setAttribute("iA", this.a);
    g.setAttribute("iB", this.b);
    g.instanceCount = max;
    this.material = new ShaderMaterial({
      uniforms: { ...shared, uHot: { value: hot }, uVolt: { value: volt }, uWidth: { value: 1.6 }, uGrav: { value: 420 } },
      vertexShader: /* glsl */ `
        attribute vec2 corner;
        attribute vec4 iA, iB;
        uniform float uTime, uWidth, uGrav;
        uniform vec2 uRes;
        varying float vT, vAcross, vAlong, vSeed;
        void main() {
          float age = uTime - iA.w, life = iB.w;
          if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          float drag = 3.2, k = exp(-drag * age);
          vec3 g = vec3(0.0, -uGrav, 0.0);
          vec3 p = iA.xyz + iB.xyz * (1.0 - k) / drag + 0.5 * g * age * age;
          vec3 v = iB.xyz * k + g * age;
          vec4 ch = projectionMatrix * viewMatrix * vec4(p, 1.0);
          vec4 ct = projectionMatrix * viewMatrix * vec4(p - v * 0.03, 1.0);
          vec2 sh = ch.xy / ch.w, st = ct.xy / ct.w;
          vec2 dpx = (sh - st) * uRes * 0.5;
          float len = length(dpx);
          vec2 dir = len > 0.01 ? dpx / len : vec2(1.0, 0.0);
          vec2 nrm = vec2(-dir.y, dir.x);
          vT = age / life;
          float w = uWidth * (1.0 - 0.5 * vT);
          vec2 base = mix(st, sh, corner.y);
          vec2 off = (nrm * corner.x * w + dir * (corner.y * 2.0 - 1.0) * w) / (uRes * 0.5);
          gl_Position = vec4(base + off, 0.0, 1.0);
          vAcross = corner.x;
          vAlong = corner.y;
          vSeed = fract(iA.x * 0.131 + iA.y * 0.173);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uHot, uVolt;
        uniform float uTime;
        varying float vT, vAcross, vAlong, vSeed;
        void main() {
          float across = 1.0 - smoothstep(0.0, 1.0, abs(vAcross));
          float flick = 0.7 + 0.3 * step(0.5, fract(uTime * 31.0 + vSeed * 7.0));
          float fade = (1.0 - vT) * (1.0 - vT);
          vec3 c = mix(uHot, uVolt, smoothstep(0.0, 0.45, vT)) * across * fade * flick * smoothstep(0.0, 0.85, vAlong) * 1.5;
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
          gl_FragColor.a = clamp(max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b)), 0.0, 1.0);
        }`,
      ...GLOW_BLEND,
      depthTest: false,
    });
    this.mesh = new Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  /** One spark at p, moving at v (world units per second), living `life` seconds. */
  emit(p: Vector3, vx: number, vy: number, vz: number, life: number, now: number) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    const A = this.a.array as Float32Array, B = this.b.array as Float32Array;
    A[i * 4] = p.x; A[i * 4 + 1] = p.y; A[i * 4 + 2] = p.z; A[i * 4 + 3] = now;
    B[i * 4] = vx; B[i * 4 + 1] = vy; B[i * 4 + 2] = vz; B[i * 4 + 3] = life;
    this.dirty = true;
  }

  /** A trail of sparks along the pointer's path, with a little of its momentum. */
  trail(p: Vector3, mvx: number, mvy: number, count: number, now: number) {
    const r = this.rng, k = this.scale;
    for (let i = 0; i < count; i++) {
      const ang = r() * Math.PI * 2, sp = 50 + r() * 190;
      this.emit(p, (Math.cos(ang) * sp + mvx * 0.2) * k, (Math.sin(ang) * sp + 90 + mvy * 0.2) * k, (r() - 0.5) * 60 * k, 0.2 + r() * 0.4, now);
    }
  }

  burst(p: Vector3, count: number, now: number) {
    const r = this.rng, k = this.scale;
    for (let i = 0; i < count; i++) {
      const ang = r() * Math.PI * 2, sp = 200 + r() * 480;
      this.emit(p, Math.cos(ang) * sp * k, (Math.sin(ang) * sp + 140) * k, (r() - 0.5) * 140 * k, 0.3 + r() * 0.5, now);
    }
  }

  flush() {
    if (!this.dirty) return;
    this.a.needsUpdate = true;
    this.b.needsUpdate = true;
    this.dirty = false;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
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

/** The valley's pool of light behind the city: a soft additive veil the hills occlude. */
export function buildLightPool(color: Color, strength: number) {
  const material = new ShaderMaterial({
    uniforms: { uCol: { value: color }, uStrength: { value: strength } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCol;
      uniform float uStrength;
      varying vec2 vUv;
      void main() {
        vec2 p = (vUv - vec2(0.5, 0.42)) * vec2(2.0, 2.6);
        float r = dot(p, p);
        float g = pow(max(0.0, 1.0 - r), 2.4) * uStrength;
        gl_FragColor = vec4(uCol * g, 1.0);
        #include <colorspace_fragment>
        gl_FragColor.a = clamp(max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b)), 0.0, 1.0);
      }`,
    ...GLOW_BLEND,
  });
  const mesh = new Mesh(new PlaneGeometry(1, 1), material);
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  return mesh;
}

/** The flash at the heart of a click burst: a soft additive glow that dies in a blink. */
export function buildFlash(hot: Color, volt: Color) {
  const material = new ShaderMaterial({
    uniforms: { ...shared, uHot: { value: hot }, uVolt: { value: volt }, uBirth: { value: -99 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uHot, uVolt;
      uniform float uTime, uBirth;
      varying vec2 vUv;
      void main() {
        float age = uTime - uBirth;
        if (age < 0.0 || age > 0.45) discard;
        float r = length(vUv - 0.5) * 2.0;
        float core = exp(-r * r * 40.0) * exp(-age * 16.0);
        float halo = pow(max(0.0, 1.0 - r), 3.0) * exp(-age * 7.0) * 0.35;
        vec3 c = uHot * core * 1.4 + uVolt * halo;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
        gl_FragColor.a = clamp(max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b)), 0.0, 1.0);
      }`,
    ...GLOW_BLEND,
    depthTest: false,
  });
  const mesh = new Mesh(new PlaneGeometry(1, 1), material);
  mesh.renderOrder = 7;
  mesh.frustumCulled = false;
  return mesh;
}
