// Shared shader code and the uniforms every material reads.
//
// The canvas is transparent: the page's own background (Sylva's flat field and its
// floor of light) shows through the sky. So every solid writes premultiplied colour
// and fades its alpha with distance, and the land dissolves into the page instead
// of ending on an edge.
import { Color, Vector2, Vector3 } from "three";

export const shared = {
  uTime: { value: 0 },
  uKeyDir: { value: new Vector3(-0.42, 0.78, 0.46).normalize() },
  uKeyCol: { value: new Color() },
  uFillDir: { value: new Vector3(0.2, -0.35, 0.92).normalize() },
  uFillCol: { value: new Color() },
  uAmbCol: { value: new Color() },
  uAirCol: { value: new Color() },
  /** x, y: distance where the air starts and is full; z: its strength */
  uFog: { value: new Vector3(1500, 5400, 0.92) },
  /** distance where the land starts to dissolve, and where it is gone */
  uFade: { value: new Vector2(5000, 6900) },
  uRes: { value: new Vector2(1, 1) },
};

export const LIGHT_GLSL = /* glsl */ `
uniform vec3 uKeyDir, uKeyCol, uFillDir, uFillCol, uAmbCol, uAirCol;
uniform vec3 uFog;
uniform vec2 uFade;
uniform float uTime;
vec3 shade(vec3 N, vec3 albedo, float ao) {
  float k = max(dot(N, uKeyDir), 0.0);
  float f = max(dot(N, uFillDir), 0.0);
  float sky = 0.5 + 0.5 * N.y;
  return albedo * (uKeyCol * (0.05 + 1.0 * k) + uFillCol * (0.03 + 0.26 * f) + uAmbCol * (0.32 + 0.68 * sky)) * ao;
}
vec3 air(vec3 c, float dist) {
  return mix(c, uAirCol, smoothstep(uFog.x, uFog.y, dist) * uFog.z);
}
float landAlpha(float dist) { return 1.0 - smoothstep(uFade.x, uFade.y, dist); }
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
`;

/** Ends a solid's fragment shader: linear colour to the output space, premultiplied. */
export const OUT_PREMUL = /* glsl */ `
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  gl_FragColor.rgb *= alpha;
  gl_FragColor.a = alpha;
`;

/** Instanced world position and normal, for the solids drawn with InstancedMesh. */
export const INSTANCE_VERT = /* glsl */ `
  vec4 lp = vec4(position, 1.0);
  vec3 ln = normal;
  #ifdef USE_INSTANCING
    lp = instanceMatrix * lp;
    ln = mat3(instanceMatrix) * ln;
  #endif
  vec4 wp = modelMatrix * lp;
  vec3 wn = normalize(mat3(modelMatrix) * ln);
`;
