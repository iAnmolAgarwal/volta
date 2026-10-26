/* Liquid metal: our own single-pass WebGL2 shader for the "Launch dashboard"
 * pill and the play disc. The look follows Sylva's liquid-metal buttons (a lit
 * chrome rim on a dark glass plate, with a soft bloom), written from scratch and
 * tinted with --volt.
 *
 * The rim is shaded as a small chrome tube: a fake normal from the pill's
 * distance field reflects a banded "studio" environment that drifts slowly.
 * Each colour channel samples the environment at a slightly different height,
 * which gives the thin spectral fringes of real metal. Outside the rim, the
 * same brightness falls off into a bloom.
 */

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uC;      // shape centre, device px (y down)
uniform vec2 uHalf;   // shape half extent, device px
uniform float uT;     // seconds
uniform float uHover; // 0..1, eased
uniform vec3 uPtr;    // pointer, device px (y down), z = strength
uniform vec3 uTint;   // --volt, linear-ish rgb
uniform float uRes;   // canvas height, device px (flips gl_FragCoord)
out vec4 outColor;

// capsule SDF: rounded by half the height, so a square renders as a disc
float sdPill(vec2 p, vec2 h) {
  float r = h.y;
  vec2 q = abs(p) - vec2(max(h.x - r, 0.0), 0.0);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
vec2 pillNormal(vec2 p, vec2 h) {
  float sx = max(h.x - h.y, 0.0);
  vec2 c = vec2(clamp(p.x, -sx, sx), 0.0);
  vec2 n = p - c;
  float l = length(n);
  return l > 1e-4 ? n / l : vec2(0.0, -1.0);
}
// a studio environment: a few soft bright bands over a dark ground
float env(float y) {
  float b = 0.0;
  b += smoothstep(0.10, 0.0, abs(fract(y) - 0.18)) * 1.0;
  b += smoothstep(0.06, 0.0, abs(fract(y * 1.7 + 0.3) - 0.5)) * 0.55;
  b += smoothstep(0.22, 0.0, abs(fract(y * 0.5 + 0.1) - 0.72)) * 0.35;
  return b;
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uRes - gl_FragCoord.y);
  vec2 p = frag - uC;
  float H = uHalf.y;
  float d = sdPill(p, uHalf);
  vec2 n = pillNormal(p, uHalf);

  float bw = max(1.3, H * 0.05);             // rim half-width
  float t = uT;

  // tube profile across the rim: -1 inner edge .. 1 outer edge
  float across = clamp((d + bw) / bw, -1.0, 1.0);
  float rim = 1.0 - smoothstep(0.55, 1.0, abs(across));

  // reflection height: the tube's normal tilts the lookup; the flow drifts it
  float along = atan(n.y, n.x) / 6.28318 + p.x / (H * 9.0);
  float flow = t * 0.06 + sin(t * 0.33 + along * 6.28318) * 0.05;
  float y = n.y * 0.42 + across * 0.18 + along * 0.9 + flow;
  y += uHover * 0.07 * sin(t * 1.3 + along * 12.0);

  // dispersion: each channel reads the bands a little apart, so edges fringe
  float disp = 0.03 + 0.015 * uHover;
  vec3 metal = vec3(env(y - disp), env(y), env(y + disp * 1.6));
  float lum = clamp(dot(metal, vec3(0.333)), 0.0, 1.0);

  // pointer: the rim brightens where the cursor is near
  float pd = length(frag - uPtr.xy) / (H * 2.0);
  float ptr = uPtr.z * exp(-pd * pd);

  // silver at rest, taking the electric green as it heats up (hover, pointer)
  float heat = clamp(0.35 + 0.5 * uHover + 0.4 * ptr, 0.0, 1.0);
  vec3 silver = vec3(0.80, 0.84, 0.82);
  vec3 tone = mix(silver, uTint, heat);
  vec3 chrome = tone * (0.35 + 0.65 * metal) + vec3(clamp(lum - 0.6, 0.0, 1.0)) + vec3(ptr * 0.45);
  // dark stretches of the reflection go clear rather than black
  float rimA = rim * clamp(0.18 + 0.82 * lum + 0.6 * ptr, 0.0, 1.0) * (0.8 + 0.2 * uHover);

  // face: a faint slanted sheen that slides across the dark glass
  float inside = 1.0 - smoothstep(-1.0, 0.5, d);
  float sheen = smoothstep(0.35, 0.0, abs(fract((p.x * 0.6 - p.y) / (H * 7.0) - t * 0.05) - 0.5));
  float faceA = inside * (0.02 + 0.05 * uHover) * sheen;

  // bloom: barely there at rest, a soft green halo when hot
  float out1 = max(d, 0.0) / H;
  float bloom = exp(-out1 * 4.0) * (0.035 + 0.2 * uHover + 0.2 * ptr) * (1.0 - inside);

  vec3 col = chrome * rimA + uTint * faceA + uTint * bloom;
  float a = clamp(rimA + faceA + bloom * 0.8, 0.0, 1.0);
  outColor = vec4(col, a); // premultiplied
}`;

export interface MetalFrame {
  cx: number;
  cy: number;
  hx: number;
  hy: number;
  t: number;
  hover: number;
  ptr: [number, number, number];
  height: number;
}

export interface MetalRenderer {
  draw(f: MetalFrame): void;
  resize(w: number, h: number): void;
  dispose(): void;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error("liquid metal: createShader failed");
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`liquid metal: ${log ?? "compile failed"}`);
  }
  return s;
}

/** Parses a CSS colour (hex or rgb) into 0..1 rgb. */
function parseColor(css: string): [number, number, number] {
  const c = css.trim();
  const hex = c.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const v = parseInt(hex[1], 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }
  const rgb = c.match(/rgba?\(([^)]+)\)/i);
  if (rgb) {
    const [r, g, b] = rgb[1].split(",").map((x) => parseFloat(x) / 255);
    return [r, g, b];
  }
  return [0.77, 0.95, 0.42];
}

/** Returns null when WebGL2 is unavailable, so the caller can show plain glass. */
export function createMetalRenderer(canvas: HTMLCanvasElement, tintCss: string): MetalRenderer | null {
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: true, alpha: true });
  if (!gl) return null;
  let prog: WebGLProgram;
  try {
    prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  } catch {
    return null;
  }
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "aPos");
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.useProgram(prog);
  const u = (name: string) => gl.getUniformLocation(prog, name);
  const uC = u("uC"), uHalf = u("uHalf"), uT = u("uT"), uHover = u("uHover");
  const uPtr = u("uPtr"), uTint = u("uTint"), uRes = u("uRes");
  const tint = parseColor(tintCss);
  gl.uniform3f(uTint, tint[0], tint[1], tint[2]);
  gl.clearColor(0, 0, 0, 0);

  return {
    resize(w, h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    },
    draw(f) {
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uC, f.cx, f.cy);
      gl.uniform2f(uHalf, f.hx, f.hy);
      gl.uniform1f(uT, f.t);
      gl.uniform1f(uHover, f.hover);
      gl.uniform3f(uPtr, f.ptr[0], f.ptr[1], f.ptr[2]);
      gl.uniform1f(uRes, f.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteBuffer(buf);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(prog);
      // no loseContext(): StrictMode remounts reuse this canvas, and a lost
      // context would come back from getContext() still lost
    },
  };
}
