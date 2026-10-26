/* Liquid metal: our own single-pass WebGL2 shader for the "Launch dashboard"
 * pill and the play disc. The look follows Sylva's liquid-metal buttons (a
 * thick, bright chrome edge on a dark glass plate, with a soft bloom), written
 * from scratch and tinted toward --volt.
 *
 * The edge is a stroke about 3 css px wide that is always drawn (a floor
 * brightness), with three highlights travelling round it at different speeds,
 * so the light keeps pooling and moving. Each colour channel sits a fraction
 * of a pixel apart across the stroke and a little apart along it, so the
 * edge fringes warm outside and cool inside, as metal does. The upper arc is
 * kept brighter (lit from above), most of all on the disc. A soft --volt bloom
 * spills outward from the edge, more on hover and near the pointer.
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
uniform vec3 uTint;   // --volt
uniform float uRes;   // canvas height, device px (flips gl_FragCoord)
uniform float uDpr;   // device pixels per css px
out vec4 outColor;

// capsule SDF: rounded by half the height, so a square renders as a disc
float sdPill(vec2 p, vec2 h) {
  float r = h.y;
  vec2 q = abs(p) - vec2(max(h.x - r, 0.0), 0.0);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// position round the outline, 0..1, by true length (caps and runs alike), so a
// highlight travels at one speed all the way round. Clockwise on screen from the
// top-left: top run, right cap, bottom run, left cap. (y points down.)
float around(vec2 p, vec2 h) {
  float r = h.y;
  float a = max(h.x - r, 0.0);
  float halfTurn = 3.1415927 * r;
  float s;
  if (p.x > a) {
    s = 2.0 * a + r * atan(p.x - a, -p.y);
  } else if (p.x < -a) {
    s = 4.0 * a + halfTurn + r * atan(-(p.x + a), p.y);
  } else if (p.y < 0.0) {
    s = p.x + a;
  } else {
    s = 2.0 * a + halfTurn + (a - p.x);
  }
  return s / (4.0 * a + 2.0 * halfTurn);
}

// a soft bump that wraps at 0/1
float lobe(float u, float w) {
  u = fract(u);
  float x = min(u, 1.0 - u);
  return exp(-(x * x) / (w * w));
}

// light travelling round the edge: a floor, plus three highlights that never re-align
float travel(float s, float t) {
  float v = 0.34;
  v += 0.75 * lobe(s - t * 0.065, 0.08);
  v += 0.50 * lobe(s + t * 0.041 + 0.41, 0.14);
  v += 0.38 * lobe(s - t * 0.022 + 0.73, 0.22);
  return v;
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uRes - gl_FragCoord.y);
  vec2 p = frag - uC;
  float H = uHalf.y;
  float d = sdPill(p, uHalf);

  float bw = max(1.45 * uDpr, H * 0.05);       // stroke half-width: ~3 css px across
  float disc = step(uHalf.x, uHalf.y * 1.05);  // the play disc is lit harder from above

  // up: 1 on the top edge, -1 on the bottom
  float up = clamp(-p.y / H, -1.0, 1.0);
  float topBias = mix(0.55, 0.9, disc);
  float lit = mix(1.0, 0.5 + 0.5 * up, topBias);
  lit = max(lit, 0.12);

  float s = around(p, uHalf);
  float t = uT;

  // pointer: the nearest stretch of edge brightens
  float pd = length(frag - uPtr.xy) / (H * 1.6);
  float ptr = uPtr.z * exp(-pd * pd);

  float gain = (1.0 + 0.35 * uHover + 0.9 * ptr) * lit;

  // the stroke, per channel: red rides outside, blue inside, and each reads
  // the travelling light a little further along
  float across = 0.42 * uDpr;
  float along = 0.028;
  float centre = -bw * 0.62;
  vec3 band = vec3(
    1.0 - smoothstep(0.0, bw * 1.05, abs(d - centre - across)),
    1.0 - smoothstep(0.0, bw * 1.05, abs(d - centre)),
    1.0 - smoothstep(0.0, bw * 1.05, abs(d - centre + across))
  );
  vec3 hot = vec3(travel(s + along, t), travel(s, t), travel(s - along, t));
  vec3 rim = band * hot * gain;

  // tint: the chrome takes --volt in its mid-tones and stays near white in its
  // brightest highlights, so it reads as lit metal, not as a green line
  float peak = max(rim.r, max(rim.g, rim.b));
  vec3 chrome = rim * mix(uTint * 1.05, vec3(1.0), smoothstep(0.55, 1.25, peak));
  chrome += vec3(0.10, 0.06, 0.16) * band.b * (1.0 - band.r) * lit; // the cool inner fringe

  // bloom: light spilling out of the edge, and a little back onto the face
  float out1 = max(d, 0.0) / H;
  float in1 = max(-d - bw * 2.0, 0.0) / H;
  float energy = travel(s, t) * lit;
  float bloomOut = exp(-out1 * 5.5) * (0.09 + 0.16 * uHover + 0.22 * ptr) * energy * step(0.0, d);
  float bloomIn = exp(-in1 * 9.0) * (0.05 + 0.06 * uHover) * energy * step(d, 0.0) * (1.0 - band.g);

  // face: a faint slanted sheen sliding across the dark glass
  float inside = 1.0 - smoothstep(-1.0, 0.5, d);
  float sheen = smoothstep(0.35, 0.0, abs(fract((p.x * 0.6 - p.y) / (H * 7.0) - t * 0.05) - 0.5));
  float faceA = inside * (0.015 + 0.04 * uHover) * sheen;

  vec3 col = chrome + uTint * (bloomOut + bloomIn + faceA);
  float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
  outColor = vec4(min(col, vec3(1.0)), a); // premultiplied
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
  dpr: number;
}

/** "pending" while the GPU is still compiling, then "ok"; "failed" means fall back to glass. */
export type MetalStatus = "pending" | "ok" | "failed";

export interface MetalRenderer {
  draw(f: MetalFrame): MetalStatus;
  resize(w: number, h: number): void;
  dispose(): void;
}

function shader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s); // no status query here: that would wait for the GPU
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

/** Returns null when WebGL2 is unavailable, so the caller can show plain glass.
 *  The program compiles in the background (KHR_parallel_shader_compile where
 *  the browser has it): nothing here waits on the GPU, so mounting the metal
 *  never blocks the main thread; draw() reports "pending" until it is ready. */
export function createMetalRenderer(canvas: HTMLCanvasElement, tintCss: string): MetalRenderer | null {
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: true, alpha: true });
  if (!gl) return null;
  const parallel = gl.getExtension("KHR_parallel_shader_compile");
  const prog = gl.createProgram();
  const vs = shader(gl, gl.VERTEX_SHADER, VERT);
  const fs = shader(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!prog || !vs || !fs) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);

  let status: MetalStatus = "pending";
  let buf: WebGLBuffer | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  let loc: Record<string, WebGLUniformLocation | null> = {};

  const settle = (): MetalStatus => {
    if (status !== "pending") return status;
    if (parallel && !gl.getProgramParameter(prog, parallel.COMPLETION_STATUS_KHR)) return status;
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      status = "failed";
      return status;
    }
    buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(prog);
    loc = Object.fromEntries(
      ["uC", "uHalf", "uT", "uHover", "uPtr", "uTint", "uRes", "uDpr"].map((n) => [n, gl.getUniformLocation(prog, n)]),
    );
    const tint = parseColor(tintCss);
    gl.uniform3f(loc.uTint, tint[0], tint[1], tint[2]);
    gl.clearColor(0, 0, 0, 0);
    status = "ok";
    return status;
  };

  return {
    resize(w, h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    },
    draw(f) {
      if (settle() !== "ok") return status;
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(loc.uC, f.cx, f.cy);
      gl.uniform2f(loc.uHalf, f.hx, f.hy);
      gl.uniform1f(loc.uT, f.t);
      gl.uniform1f(loc.uHover, f.hover);
      gl.uniform3f(loc.uPtr, f.ptr[0], f.ptr[1], f.ptr[2]);
      gl.uniform1f(loc.uRes, f.height);
      gl.uniform1f(loc.uDpr, f.dpr);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return status;
    },
    dispose() {
      gl.deleteBuffer(buf);
      gl.deleteVertexArray(vao);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteProgram(prog);
      // no loseContext(): StrictMode remounts reuse this canvas, and a lost
      // context would come back from getContext() still lost
    },
  };
}
