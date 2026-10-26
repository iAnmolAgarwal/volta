// Shared shader code and the uniforms every material reads.
//
// The canvas is transparent: the page's own background (Sylva's flat field and its
// floor of light) shows through the sky. So every solid writes premultiplied colour
// and an alpha that falls in two ways:
// - with distance, so the far land dissolves into the page instead of ending on a
//   horizon (and nothing but real geometry is ever drawn over card 1);
// - in the valley mist: the low ground turns to air, so the page, its floor of
//   light and the ghost word show through it, as they do through Sylva's fog.
import { Color, Vector2, Vector3, Vector4 } from "three";
import { GROUND, MIST } from "./world";

export const shared = {
  uTime: { value: 0 },
  uKeyDir: { value: new Vector3(-0.42, 0.78, 0.46).normalize() },
  uKeyCol: { value: new Color() },
  uFillDir: { value: new Vector3(0.2, -0.35, 0.92).normalize() },
  uFillCol: { value: new Color() },
  uAmbCol: { value: new Color() },
  uAirCol: { value: new Color() },
  /** x, y: distance where the air starts and is full; z: its strength */
  uFog: { value: new Vector3(2100, 4600, 0.85) },
  /** distance where the land starts to dissolve into the page, and where it is gone */
  uFade: { value: new Vector2(2600, 4500) },
  /** the valley mist: heights above the floor where it is thick and clear, its floor, its light */
  uMist: { value: new Vector4(MIST.full, MIST.clear, GROUND, 0.5) },
  uMistCol: { value: new Color() },
  /** narrow layouts: buffer rows (from the top) where the land fades out above the cards; z = on */
  uClip: { value: new Vector3(0, 1, 0) },
  uRes: { value: new Vector2(1, 1) },
  /**
   * Live, light (mist, glows) is added with no alpha, so it brightens the page and
   * never greys the paper card. A still exported as an image cannot hold light
   * without alpha, so the poster sets this to 1 and light is written as a veil.
   */
  uOpaqueLight: { value: 0 },
};

export const LIGHT_GLSL = /* glsl */ `
uniform vec3 uKeyDir, uKeyCol, uFillDir, uFillCol, uAmbCol, uAirCol, uMistCol;
uniform vec3 uFog, uClip;
uniform vec2 uFade, uRes;
uniform vec4 uMist;
uniform float uTime, uOpaqueLight;
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
float clipAlpha() {
  float row = uRes.y - gl_FragCoord.y;
  return mix(1.0, 1.0 - smoothstep(uClip.x, uClip.y, row), uClip.z);
}
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
/** How solid a point is in the valley mist: 0 deep in it, 1 above it. Its top edge drifts a little. */
float mistAlpha(vec3 w) {
  float h = w.y - uMist.z;
  float wisp = vnoise(w.xz * 0.0045 + vec2(uTime * 0.012, -uTime * 0.007)) - 0.5;
  return smoothstep(uMist.x, uMist.y, h + wisp * 46.0);
}
`;

/**
 * Ends a solid's fragment shader: linear colour to the output space, premultiplied.
 * Where the solid has turned to mist (\`mist\` 0), it lets the page through and adds
 * the mist's own soft light instead (uMistCol is already in the output space).
 * Expects \`col\`, \`alpha\` and \`mist\` in scope.
 */
export const OUT_PREMUL = /* glsl */ `
  alpha *= clipAlpha();
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  vec3 mistLight = uMistCol * uMist.w * (1.0 - mist) * alpha;
  gl_FragColor.rgb = gl_FragColor.rgb * alpha * mist + mistLight;
  gl_FragColor.a = alpha * mist + uOpaqueLight * max(mistLight.r, max(mistLight.g, mistLight.b));
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
