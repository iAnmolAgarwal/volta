// Conductors as camera-facing ribbons, a pixel or two wide, with the current drawn
// in the shader: a dark wire, a faint energised glow, and pulses with a bright head
// and a fading tail running from each route's source to its sink. A second, wider
// additive pass of the same ribbons is the halo.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
} from "three";
import { LIGHT_GLSL, shared } from "./glsl";
import type { Polyline } from "./network";
import { ROUTE_COUNT } from "./world";

/** Per-route uniforms, written by the engine every frame. */
export const flow = {
  uLevel: { value: new Array<number>(ROUTE_COUNT).fill(0) }, // eased activity 0..1
  uPhase: { value: new Array<number>(ROUTE_COUNT).fill(0) }, // head position along the route
  uFront: { value: new Array<number>(ROUTE_COUNT).fill(0) }, // the power-up front (entrance)
  uSpacing: { value: new Array<number>(ROUTE_COUNT).fill(300) },
  uTail: { value: new Array<number>(ROUTE_COUNT).fill(40) }, // pulse tail length, world units
  uFlowCol: { value: Array.from({ length: ROUTE_COUNT }, () => new Color()) },
  uGain: { value: new Array<number>(ROUTE_COUNT).fill(1) }, // brightness per route (pale flows need more)
  uRed: { value: new Array<number>(ROUTE_COUNT).fill(0) }, // how far each route turns overload red
  uOverCol: { value: new Color() },
  uHot: { value: new Color() }, // the white-hot head of a pulse
  uWireCol: { value: new Color() },
  uDensity: { value: 1 },
};

export function buildWireGeometry(lines: Polyline[]): BufferGeometry {
  let verts = 0, quads = 0;
  for (const l of lines) { verts += l.points.length * 2; quads += l.points.length - 1; }
  const pos = new Float32Array(verts * 3), nxt = new Float32Array(verts * 3);
  const side = new Float32Array(verts), sAt = new Float32Array(verts);
  const meta = new Float32Array(verts * 4); // route, jit, width, powered
  const idx = new Uint32Array(quads * 6);
  let v = 0, k = 0;
  for (const l of lines) {
    const n = l.points.length, base = v;
    for (let i = 0; i < n; i++) {
      const p = l.points[i];
      // the last point looks back at its neighbour, with its side flipped
      const last = i === n - 1;
      const q = l.points[last ? i - 1 : i + 1];
      for (const sd of [-1, 1]) {
        pos.set([p.x, p.y, p.z], v * 3);
        nxt.set([q.x, q.y, q.z], v * 3);
        side[v] = last ? -sd : sd;
        sAt[v] = l.s[i];
        meta.set([l.route, l.jit, l.width, l.powered ? 1 : 0], v * 4);
        v++;
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2, b = a + 2;
      idx.set([a, b, a + 1, a + 1, b, b + 1], k);
      k += 6;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("aNext", new BufferAttribute(nxt, 3));
  g.setAttribute("aSide", new BufferAttribute(side, 1));
  g.setAttribute("aS", new BufferAttribute(sAt, 1));
  g.setAttribute("aMeta", new BufferAttribute(meta, 4));
  g.setIndex(new BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

const VERT = /* glsl */ `
  attribute vec3 aNext;
  attribute float aSide;
  attribute float aS;
  attribute vec4 aMeta;
  uniform vec2 uRes;
  uniform float uWidthScale, uMinPx;
  uniform float uLevel[${ROUTE_COUNT}];
  uniform float uPhase[${ROUTE_COUNT}];
  uniform float uFront[${ROUTE_COUNT}];
  uniform float uSpacing[${ROUTE_COUNT}];
  uniform float uTail[${ROUTE_COUNT}];
  uniform float uRed[${ROUTE_COUNT}];
  uniform float uGain[${ROUTE_COUNT}];
  uniform vec3 uFlowCol[${ROUTE_COUNT}];
  uniform vec3 uOverCol;
  varying float vS, vX, vLevel, vFront, vSpacing, vCover, vDist, vPowered, vV;
  varying vec3 vCol;
  void main() {
    int r = int(aMeta.x + 0.5);
    vec4 c0 = projectionMatrix * viewMatrix * vec4(position, 1.0);
    vec4 c1 = projectionMatrix * viewMatrix * vec4(aNext, 1.0);
    vec2 dir = normalize((c1.xy / c1.w - c0.xy / c0.w) * uRes);
    vec2 nrm = vec2(-dir.y, dir.x);
    // world width to pixels at this depth, floored so far wires stay continuous
    float px = aMeta.z * uWidthScale * projectionMatrix[1][1] * uRes.y * 0.5 / c0.w;
    float w = max(px, uMinPx);
    vCover = clamp(px / w, 0.0, 1.0);
    c0.xy += nrm * aSide * (w / uRes) * c0.w;
    gl_Position = c0;
    vV = aSide;
    vS = aS;
    vX = (uPhase[r] - aS) / uSpacing[r] + aMeta.y;
    vLevel = uLevel[r];
    vFront = uFront[r];
    vSpacing = uSpacing[r] / uTail[r];
    vPowered = aMeta.w;
    vCol = mix(uFlowCol[r], uOverCol, uRed[r]) * uGain[r];
    vDist = distance(position, cameraPosition);
  }
`;

const PULSE = /* glsl */ `
  // one pulse per spacing: a bright head, a tail fading back toward the source
  // (vSpacing carries spacing / tail, so the tail has the same length in the world on every route)
  float pulseAt(float x) {
    float f = fract(x) * vSpacing;
    return exp(-f) * smoothstep(0.0, 0.12, f);
  }
  // the entrance: the line is live behind the front, with a spark riding it
  float energised() { return smoothstep(vFront, vFront - 80.0, vS); }
  float frontSpark() { return exp(-abs(vS - vFront) / 26.0) * step(0.5, vFront) * (1.0 - step(1e5, vFront)); }
`;

export function buildWireMaterials(lineGeo: BufferGeometry) {
  const core = new ShaderMaterial({
    uniforms: { ...shared, ...flow, uWidthScale: { value: 1 }, uMinPx: { value: 1.1 } },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      ${LIGHT_GLSL}
      uniform vec3 uWireCol, uHot;
      uniform float uDensity;
      varying float vS, vX, vLevel, vFront, vSpacing, vCover, vDist, vPowered, vV;
      varying vec3 vCol;
      ${PULSE}
      void main() {
        float e = energised() * vPowered;
        float haze = 1.0 - 0.92 * smoothstep(uFog.x, uFog.y, vDist);
        float p = pulseAt(vX * uDensity) * vLevel * e * haze;
        vec3 col = air(uWireCol, vDist);
        col += vCol * (0.035 * vLevel * e * haze + 3.4 * p + 1.8 * frontSpark() * vPowered);
        col += uHot * smoothstep(0.55, 1.0, p) * 0.9;
        float alpha = vCover * (0.9 - 0.5 * smoothstep(2500.0, 6000.0, vDist)) * (1.0 - smoothstep(0.55, 1.0, abs(vV)) * 0.4);
        alpha *= landAlpha(vDist) * mix(0.5, 1.0, vPowered);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
        gl_FragColor.rgb *= alpha;
        gl_FragColor.a = alpha;
      }`,
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  });

  const glow = new ShaderMaterial({
    uniforms: { ...shared, ...flow, uWidthScale: { value: 4.5 }, uMinPx: { value: 4.5 } },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      ${LIGHT_GLSL}
      uniform float uDensity;
      varying float vS, vX, vLevel, vFront, vSpacing, vCover, vDist, vPowered, vV;
      varying vec3 vCol;
      ${PULSE}
      void main() {
        if (vPowered < 0.5) discard;
        float e = energised();
        float p = pulseAt(vX * uDensity) * vLevel * e;
        float across = exp(-vV * vV * 3.6);
        float far = 1.0 - 0.92 * smoothstep(uFog.x, uFog.y, vDist);
        vec3 g = vCol * across * far * landAlpha(vDist) * (0.018 * vLevel * e + 0.8 * p + 0.9 * frontSpark());
        gl_FragColor = vec4(g, 1.0);
        #include <colorspace_fragment>
        float a = max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b));
        gl_FragColor.a = clamp(a, 0.0, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  });

  const coreMesh = new Mesh(lineGeo, core);
  const glowMesh = new Mesh(lineGeo, glow);
  coreMesh.frustumCulled = glowMesh.frustumCulled = false;
  coreMesh.renderOrder = 2;
  glowMesh.renderOrder = 3;
  return { core, glow, coreMesh, glowMesh };
}
