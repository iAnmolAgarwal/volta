// The render loop and everything it owns: the world, the controller state, the
// pointer, adaptive quality, pausing, and reduced motion.
import {
  InstancedMesh,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
  type Object3D,
} from "three";
import { buildBattery, buildCity, buildSolar, buildTrees } from "./city";
import { distributionPole, gantry, latticePylon, substationKit } from "./geometry";
import { shared } from "./glsl";
import { applyProjection, computeFrame, NARROW, type Frame } from "./layout";
import { activity, batteryMaterial, buildingMaterial, panelMaterial, steelMaterial, treeMaterial } from "./materials";
import { buildNetwork } from "./network";
import { readPalette } from "./palette";
import { buildFlash, buildLightPool, buildMotes, Sparks } from "./particles";
import { buildTerrain, GroundMap } from "./terrain";
import { buildWireGeometry, buildWireMaterials, flow } from "./wires";
import {
  CAM_Z,
  CITY,
  FOCAL,
  GROUND,
  OPTIC_X,
  OPTIC_Y,
  R_BATTERY,
  R_GRID_FAR,
  R_GRID_NEAR,
  R_SOLAR,
  R_STREET_BATT,
  R_STREET_GRID,
  ROADS,
  ROUTE_COUNT,
  BATTERY,
  SUBSTATION,
  heightAt,
} from "./world";

export type GridMode = "Main Grid Mode" | "Renewable Storage Mode";
export interface GridState { mode: GridMode; overload: boolean; pvKw: number; batteryKw: number }

/** Adaptive quality, lowest first. The monitor steps down when frames run long. */
const QUALITY = [
  { dpr: 0.75, trees: 0.4, motes: 0, sparks: 0.5, density: 0.65, glow: 0.7 },
  { dpr: 1, trees: 0.65, motes: 0.5, sparks: 0.7, density: 0.8, glow: 0.85 },
  { dpr: 1.5, trees: 1, motes: 1, sparks: 1, density: 1, glow: 1 },
  { dpr: 2, trees: 1, motes: 1, sparks: 1, density: 1, glow: 1 },
];

const SPEED = [640, 560, 210, 210, 150, 150]; // world units per second, per route
const SPACING = [820, 720, 200, 180, 96, 96]; // between pulses
const TAIL = [48, 44, 24, 26, 16, 18]; // each pulse's tail
const GAIN = [1, 1, 1.5, 2.1, 1.15, 1.8]; // the pale flows need more light to read on the haze
const SPARK_Z = 520; // the plane the sparks live on, in front of the whole world
const DIM_GRID = 0.14; // the grid's lines in Renewable Storage Mode

declare global {
  interface Window { __voltaScene?: { quality: number; levels: number; fps: number; dpr: number; paused: boolean } }
}

export class GridEngine {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private probe: HTMLElement;
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(30, 1, 30, 14000);
  private frame: Frame = computeFrame(1, 1, 1, false);
  private sparks: Sparks;
  private flash: ReturnType<typeof buildFlash>;
  private trees: ReturnType<typeof buildTrees>;
  private treeCount: number;
  private motes: ReturnType<typeof buildMotes>;
  private moteCount = 260;
  private glowMat: ReturnType<typeof buildWireMaterials>["glow"];
  private terrainMat: ReturnType<typeof buildTerrain>["material"];
  private battGlow: ReturnType<typeof buildLightPool>;
  private onFallback: () => void;

  // controller state, eased
  private target = new Float32Array(ROUTE_COUNT);
  private targetRed = new Float32Array(ROUTE_COUNT);
  private act = { solar: 0, charge: 0, discharge: 0, alarm: 0 };
  private arrival = new Float32Array(ROUTE_COUNT);
  private startAt = new Float32Array(ROUTE_COUNT);
  private frontSpeed = new Float32Array(ROUTE_COUNT);
  private routeLen: number[];
  private bootDone = false;

  // time and loop
  private raf = 0;
  private running = false;
  private last = 0;
  private time = 0;
  private boot = 0;
  private reduced: boolean;
  private visible = !document.hidden;
  private onScreen = true;
  private disposed = false;

  // pointer
  private pointer = { x: 0, y: 0 };
  private smooth = { x: 0, y: 0 };
  private pCur = { x: 0, y: 0, has: false };
  private pPrev = { x: 0, y: 0, has: false };
  private pendingBurst = { x: 0, y: 0, n: 0 };
  private rect = { left: 0, top: 0 };
  private v3 = new Vector3();
  private v2 = new Vector2();

  // quality
  private level: number;
  private maxLevel: number;
  private failedAt = Infinity;
  private fps = 60;
  private fpsFrames = 0;
  private fpsTime = 0;
  private goodWindows = 0;
  private badWindows = 0;
  private hold = 0;

  private mqReduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  private mqNarrow = window.matchMedia("(max-width: 900px)");
  private ro: ResizeObserver;
  private io: IntersectionObserver;

  constructor(root: HTMLElement, opts: { onFallback: () => void }) {
    this.root = root;
    this.onFallback = opts.onFallback;
    this.reduced = this.mqReduced.matches;

    this.canvas = document.createElement("canvas");
    this.canvas.className = "volta-scene__canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    this.probe = document.createElement("i");
    this.probe.className = "volta-scene__probe";
    root.append(this.probe, this.canvas);

    try {
      this.renderer = new WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: true,
        premultipliedAlpha: true,
        stencil: false,
        powerPreference: "high-performance",
      });
    } catch (err) {
      this.canvas.remove();
      this.probe.remove();
      throw err;
    }
    this.renderer.setClearColor(0x000000, 0);

    const small = this.mqNarrow.matches || matchMedia("(pointer: coarse)").matches;
    this.level = this.maxLevel = small ? 2 : 3;

    const pal = readPalette();
    shared.uKeyCol.value.copy(pal.flowSolar).multiplyScalar(1.42);
    shared.uFillCol.value.copy(pal.voltPale).multiplyScalar(0.55);
    shared.uAmbCol.value.copy(pal.bgHero).multiplyScalar(0.62);
    shared.uAirCol.value.copy(pal.bgHero);
    flow.uOverCol.value.copy(pal.flowOverload);
    flow.uWireCol.value.copy(pal.bgNight).multiplyScalar(0.85);
    flow.uHot.value.copy(pal.ink);
    const routeCol = [pal.flowGrid, pal.flowGrid, pal.flowSolar, pal.flowBattery, pal.flowGrid, pal.flowBattery];
    routeCol.forEach((c, i) => flow.uFlowCol.value[i].copy(c));
    SPACING.forEach((s, i) => (flow.uSpacing.value[i] = s));
    TAIL.forEach((t, i) => (flow.uTail.value[i] = t));
    GAIN.forEach((g, i) => (flow.uGain.value[i] = g));

    // ── the world ──────────────────────────────────────────────────────
    const ground = new GroundMap();
    for (const road of ROADS) ground.road(road, 15);
    const lat0 = latticePylon(0), lat1 = latticePylon(1), pole = distributionPole(), gant = gantry();
    const net = buildNetwork({ lattice: lat0, pole, gantry: gant });
    this.routeLen = net.routeLength;
    const steel = steelMaterial(pal);
    const groups: Record<string, Matrix4[]> = { near: [], far: [], pole: [], gantry: [] };
    for (const t of net.towers) {
      const key = t.spec.kind === "lattice" ? (t.dist < 3100 ? "near" : "far") : t.spec.kind;
      groups[key].push(t.matrix);
      const r = t.spec.kind === "lattice" ? 40 : t.spec.kind === "gantry" ? 60 : 9;
      if (t.dist < 5200) ground.shadow(t.pos.x, t.pos.z, r, t.spec.kind === "pole" ? 0.55 : 0.5);
    }
    const geos: Record<string, BufferGeometry> = { near: lat0.geometry, far: lat1.geometry, pole: pole.geometry, gantry: gant.geometry };
    for (const key of Object.keys(groups)) {
      const list = groups[key];
      if (!list.length) continue;
      const m = new InstancedMesh(geos[key], steel, list.length);
      list.forEach((mm, i) => m.setMatrixAt(i, mm));
      m.frustumCulled = false;
      this.scene.add(m);
    }
    const kit = new Mesh(substationKit(), steel);
    kit.position.set(SUBSTATION.x, heightAt(SUBSTATION.x, SUBSTATION.z) - 1, SUBSTATION.z);
    kit.rotation.y = -0.35;
    this.scene.add(kit);
    ground.shadowRect(SUBSTATION.x, SUBSTATION.z, 150, 170, 0.35, 0.35);
    ground.glow(SUBSTATION.x, SUBSTATION.z, 170, 0.35);

    const city = buildCity(buildingMaterial(pal), ground);
    this.scene.add(city.mesh, buildBattery(batteryMaterial(pal), ground), buildSolar(panelMaterial(pal), ground));
    this.trees = buildTrees(treeMaterial(pal), ground, 12000);
    this.treeCount = this.trees.count;
    this.scene.add(this.trees.mesh);

    const pool = buildLightPool(pal.voltPale.clone(), 0.065);
    pool.position.set(CITY.x + 40, GROUND + 140, CITY.z - 520);
    pool.scale.set(3000, 1250, 1);
    this.scene.add(pool);

    this.battGlow = buildLightPool(pal.flowBattery.clone(), 0);
    this.battGlow.position.set(BATTERY.x, heightAt(BATTERY.x, BATTERY.z) + 20, BATTERY.z + 30);
    this.battGlow.scale.set(420, 150, 1);
    this.scene.add(this.battGlow);

    const terrain = buildTerrain(pal, ground);
    this.terrainMat = terrain.material;
    this.scene.add(terrain.mesh);
    ground.texture.needsUpdate = true;

    const lines = [...net.wires, ...city.streets];
    const wires = buildWireMaterials(buildWireGeometry(lines));
    this.glowMat = wires.glow;
    this.scene.add(wires.coreMesh, wires.glowMesh);
    // street networks: their length is the longest street's end
    for (const l of city.streets) this.routeLen[l.route] = Math.max(this.routeLen[l.route] ?? 0, l.s[l.s.length - 1]);

    this.motes = buildMotes(this.moteCount, moteField(this.moteCount), pal.ink);
    this.scene.add(this.motes);
    this.sparks = new Sparks(640, pal.ink, pal.volt);
    this.flash = buildFlash(pal.ink, pal.volt);
    this.scene.add(this.sparks.mesh, this.flash);

    this.planBoot();
    this.setState({ mode: "Main Grid Mode", overload: false, pvKw: 0, batteryKw: 0 });
    this.snapEasing();

    // ── layout, events ─────────────────────────────────────────────────
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(root);
    this.io = new IntersectionObserver((e) => {
      this.onScreen = e[e.length - 1]?.isIntersecting ?? true;
      this.updateRunning();
    });
    this.io.observe(root);
    window.addEventListener("pointermove", this.onMove, { passive: true });
    window.addEventListener("pointerdown", this.onDown, { passive: true });
    window.addEventListener("blur", this.onLeave);
    document.documentElement.addEventListener("mouseleave", this.onLeave);
    window.addEventListener("scroll", this.onScroll, { passive: true, capture: true });
    document.addEventListener("visibilitychange", this.onVisibility);
    this.mqReduced.addEventListener("change", this.onReducedChange);
    this.canvas.addEventListener("webglcontextlost", this.onLost);

    // dev only: lets the poster be regenerated, and the scene inspected
    if (import.meta.env.DEV) (window as unknown as { __voltaDebug: unknown }).__voltaDebug = { scene: this.scene, engine: this };
    this.layout();
    if (this.reduced) this.finishBoot();
    this.renderOnce();
    this.canvas.classList.add("is-on");
    this.updateRunning();
  }

  // ── the controller ─────────────────────────────────────────────────────
  setState(s: GridState) {
    const grid = s.mode !== "Renewable Storage Mode";
    const sun = s.pvKw > 0;
    const t = this.target, red = this.targetRed;
    t[R_GRID_FAR] = t[R_GRID_NEAR] = grid ? 1 : DIM_GRID;
    t[R_STREET_GRID] = grid ? 1 : 0.06;
    t[R_BATTERY] = t[R_STREET_BATT] = grid ? 0 : 1;
    t[R_SOLAR] = sun ? 1 : 0;
    for (let r = 0; r < ROUTE_COUNT; r++) red[r] = s.overload && r !== R_SOLAR ? 1 : 0;
    this.act.solar = sun ? 0.55 + 0.45 * Math.min(1, s.pvKw / 120) : 0;
    this.act.charge = sun ? 1 : 0;
    this.act.discharge = grid ? 0 : 1;
    this.act.alarm = s.overload ? 1 : 0;
    if (!this.running) {
      // a still frame (reduced motion, or paused): show the new state at once
      this.snapEasing();
      this.renderOnce();
    }
  }

  private snapEasing() {
    for (let r = 0; r < ROUTE_COUNT; r++) {
      flow.uLevel.value[r] = this.target[r];
      flow.uRed.value[r] = this.targetRed[r];
    }
    activity.uSolar.value = this.act.solar;
    activity.uCharge.value = this.act.charge;
    activity.uDischarge.value = this.act.discharge;
    activity.uAlarm.value = this.act.alarm;
    if (this.battGlow) this.syncGlow();
  }

  private ease(dt: number) {
    const k = 1 - Math.exp(-dt * 6);
    const lv = flow.uLevel.value, rd = flow.uRed.value;
    for (let r = 0; r < ROUTE_COUNT; r++) {
      lv[r] += (this.target[r] - lv[r]) * k;
      rd[r] += (this.targetRed[r] - rd[r]) * k;
    }
    activity.uSolar.value += (this.act.solar - activity.uSolar.value) * k;
    activity.uCharge.value += (this.act.charge - activity.uCharge.value) * k;
    activity.uDischarge.value += (this.act.discharge - activity.uDischarge.value) * k;
    activity.uAlarm.value += (this.act.alarm - activity.uAlarm.value) * k;
    this.syncGlow();
  }

  private syncGlow() {
    (this.battGlow.material as ShaderMaterial).uniforms.uStrength.value = 0.2 * activity.uDischarge.value;
  }

  // ── the entrance: the network powers up, source to sink ──────────────────
  private planBoot() {
    const L = this.routeLen;
    const plan = (r: number, at: number, dur: number) => {
      this.startAt[r] = at;
      this.frontSpeed[r] = (L[r] + 120) / dur;
      this.arrival[r] = at + dur;
    };
    plan(R_GRID_FAR, 0.5, 2.3);
    plan(R_GRID_NEAR, 0.85, 2.0);
    const fed = Math.min(this.arrival[R_GRID_FAR], this.arrival[R_GRID_NEAR]);
    plan(R_STREET_GRID, fed - 0.1, 1.6);
    plan(R_SOLAR, 1.5, 1.1);
    plan(R_BATTERY, 2.3, 0.9);
    plan(R_STREET_BATT, this.arrival[R_BATTERY] - 0.1, 1.5);
  }

  private stepBoot(dt: number) {
    if (this.bootDone) return;
    this.boot += dt;
    let done = true;
    for (let r = 0; r < ROUTE_COUNT; r++) {
      const f = (this.boot - this.startAt[r]) * this.frontSpeed[r];
      flow.uFront.value[r] = Math.max(0, f);
      if (f < this.routeLen[r] + 150) done = false;
    }
    const lit = Math.min(1, Math.max(0, (this.boot - this.arrival[R_GRID_FAR] + 0.6) / 1.4));
    // lights come on in a couple of stutters, as a real network energises
    activity.uCity.value = lit * (lit < 1 ? 0.75 + 0.25 * Math.sin(this.boot * 40) : 1);
    this.terrainMat.uniforms.uCity.value = activity.uCity.value;
    if (done) this.finishBoot();
  }

  private finishBoot() {
    this.bootDone = true;
    for (let r = 0; r < ROUTE_COUNT; r++) flow.uFront.value[r] = 1e6;
    activity.uCity.value = 1;
    this.terrainMat.uniforms.uCity.value = 1;
  }

  // ── layout ──────────────────────────────────────────────────────────────
  private layout() {
    if (this.disposed) return;
    const W = Math.max(1, this.root.clientWidth), H = Math.max(1, this.root.clientHeight);
    const u = this.probe.offsetWidth / 1000 || W / 1600;
    const narrow = this.mqNarrow.matches;
    this.frame = computeFrame(W, H, u, narrow);
    const r = this.root.getBoundingClientRect();
    this.rect.left = r.left;
    this.rect.top = r.top;
    this.applyQuality();
    applyProjection(this.camera, this.frame);
    const mask = narrow
      ? `linear-gradient(to bottom, black ${NARROW.fadeFrom * u}px, transparent ${NARROW.fadeTo * u}px)`
      : "";
    this.canvas.style.maskImage = mask;
    this.canvas.style.setProperty("-webkit-mask-image", mask);
    // world units per CSS px at the spark plane
    this.sparks.scale = (CAM_Z - SPARK_Z) / (FOCAL * this.frame.k);
    this.sparks.material.uniforms.uGrav.value = 620 * this.sparks.scale;
    if (!this.running) this.renderOnce();
  }

  private applyQuality() {
    const q = QUALITY[this.level];
    const dpr = Math.min(window.devicePixelRatio || 1, q.dpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.frame.W, this.frame.H, false);
    const buf = this.renderer.getDrawingBufferSize(this.v2);
    shared.uRes.value.set(buf.x, buf.y);
    this.trees.geometry.instanceCount = Math.floor(this.treeCount * q.trees);
    this.motes.geometry.setDrawRange(0, Math.floor(this.moteCount * q.motes));
    this.motes.visible = q.motes > 0;
    this.motes.material.uniforms.uScale.value = buf.y * 0.5;
    this.motes.material.uniforms.uSize.value = Math.max(2.2, 5 * this.frame.k) * dpr / Math.max(1, dpr * 0.75);
    flow.uDensity.value = q.density;
    this.glowMat.uniforms.uWidthScale.value = 3.4 * q.glow;
    this.glowMat.uniforms.uMinPx.value = 3.6 * dpr * q.glow * Math.min(1, Math.max(0.55, this.frame.k));
    this.sparks.material.uniforms.uWidth.value = 1.5 * dpr;
    this.publish(dpr);
  }

  private publish(dpr = Math.min(window.devicePixelRatio || 1, QUALITY[this.level].dpr)) {
    window.__voltaScene = { quality: this.level, levels: QUALITY.length, fps: Math.round(this.fps), dpr, paused: !this.running };
  }

  // ── the loop ─────────────────────────────────────────────────────────────
  private updateRunning() {
    const should = !this.disposed && !this.reduced && this.visible && this.onScreen;
    if (should === this.running) return;
    this.running = should;
    if (should) {
      this.last = performance.now();
      this.fpsFrames = 0;
      this.fpsTime = 0;
      this.raf = requestAnimationFrame(this.tick);
    } else {
      cancelAnimationFrame(this.raf);
    }
    this.publish();
  }

  private tick = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    const raw = Math.max(0, (now - this.last) / 1000);
    this.last = now;
    const dt = Math.min(raw, 0.05);
    this.time += dt;
    shared.uTime.value = this.time;

    this.stepBoot(dt);
    this.ease(dt);
    const ph = flow.uPhase.value, lv = flow.uLevel.value;
    for (let r = 0; r < ROUTE_COUNT; r++) ph[r] += dt * SPEED[r] * (0.35 + 0.65 * lv[r]);

    // pointer parallax, eased like Sylva's (about 3.4 per second)
    const kp = 1 - Math.exp(-dt * 3.4);
    this.smooth.x += (this.pointer.x - this.smooth.x) * kp;
    this.smooth.y += (this.pointer.y - this.smooth.y) * kp;
    this.placeCamera();
    this.emitSparks();

    this.renderer.render(this.scene, this.camera);
    this.monitor(raw);
  };

  private placeCamera() {
    const c = this.camera;
    c.position.set(-this.smooth.x * 24, this.smooth.y * 12, CAM_Z);
    c.lookAt(c.position.x * 0.42, c.position.y * 0.42, 0);
    c.updateMatrixWorld();
  }

  private renderOnce() {
    if (this.disposed) return;
    if (this.reduced) {
      // a still, composed frame: pulses frozen mid-line, no parallax
      for (let r = 0; r < ROUTE_COUNT; r++) flow.uPhase.value[r] = SPACING[r] * 0.42;
      shared.uTime.value = 12;
      this.smooth.x = this.smooth.y = 0;
    }
    this.placeCamera();
    this.renderer.render(this.scene, this.camera);
  }

  private monitor(raw: number) {
    if (raw > 0.25) return; // a hitch (a resumed tab, a page reflow), not the scene's cost
    this.fpsFrames++;
    this.fpsTime += raw;
    if (this.fpsTime < 1) return;
    this.fps = this.fpsFrames / this.fpsTime;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.badWindows = this.fps < 50 ? this.badWindows + 1 : 0;
    if (this.hold > 0) this.hold--;
    else if (this.time > 3) {
      if (this.badWindows >= 2 && this.level > 0) {
        this.badWindows = 0;
        this.failedAt = this.level;
        this.level--;
        this.hold = 2;
        this.goodWindows = 0;
        this.applyQuality();
      } else if (this.fps > 57) {
        this.goodWindows++;
        // a level that failed is not retried at once; 15 good seconds forgive it
        if (this.goodWindows % 15 === 0 && this.failedAt < QUALITY.length) this.failedAt++;
        if (this.goodWindows >= 6 && this.level < this.maxLevel && this.level + 1 < this.failedAt) {
          this.level++;
          this.goodWindows = 0;
          this.hold = 2;
          this.applyQuality();
        }
      } else this.goodWindows = 0;
    }
    this.publish();
  }

  /**
   * Dev only: renders the no-WebGL poster, artboard x0..x0+w by y0..y0+h at
   * `scale` px per unit, as a still frame, and returns it as a WebP data URL.
   * To regenerate frontend/public/volta-scene.webp, open the page in dev with
   * reduced motion and run
   *   window.__voltaDebug.engine.posterDataUrl(-160, 200, 1920, 920, 1.25)
   * then save the data URL. The rectangle must match .volta-scene__poster in scene.css.
   */
  posterDataUrl(x0: number, y0: number, w: number, h: number, scale: number): string {
    const keep = { frame: this.frame, reduced: this.reduced };
    this.finishBoot();
    this.reduced = true;
    const W = Math.round(w * scale), H = Math.round(h * scale);
    this.frame = { W, H, u: scale, k: scale, ox: -x0 * scale, oy: -y0 * scale, narrow: false };
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(W, H, false);
    shared.uRes.value.set(W, H);
    applyProjection(this.camera, this.frame);
    this.sparks.mesh.visible = false;
    this.renderOnce();
    const url = this.canvas.toDataURL("image/webp", 0.86);
    this.sparks.mesh.visible = true;
    this.reduced = keep.reduced;
    this.layout();
    return url;
  }

  // ── pointer: sparks and parallax, listened for on window ─────────────────
  private onMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    this.pCur.x = e.clientX - this.rect.left;
    this.pCur.y = e.clientY - this.rect.top;
    this.pCur.has = true;
  };

  private onDown = (e: PointerEvent) => {
    if (e.button > 0) return;
    this.pendingBurst.x = e.clientX - this.rect.left;
    this.pendingBurst.y = e.clientY - this.rect.top;
    this.pendingBurst.n = 46;
  };

  private onLeave = () => {
    this.pointer.x = this.pointer.y = 0;
    this.pCur.has = this.pPrev.has = false;
  };

  private onScroll = () => {
    const r = this.root.getBoundingClientRect();
    this.rect.left = r.left;
    this.rect.top = r.top;
  };

  /** Canvas px to the spark plane, in world space. */
  private toSparkPlane(px: number, py: number, out: Vector3) {
    const ndcX = (px / this.frame.W) * 2 - 1, ndcY = 1 - (py / this.frame.H) * 2;
    out.set(ndcX, ndcY, 0.5).unproject(this.camera);
    const c = this.camera.position;
    const t = (SPARK_Z - c.z) / (out.z - c.z);
    return out.set(c.x + (out.x - c.x) * t, c.y + (out.y - c.y) * t, SPARK_Z);
  }

  private emitSparks() {
    const now = this.time, q = QUALITY[this.level].sparks;
    if (this.pendingBurst.n > 0) {
      const p = this.toSparkPlane(this.pendingBurst.x, this.pendingBurst.y, this.v3);
      this.sparks.burst(p, Math.round(this.pendingBurst.n * q), now);
      this.flash.position.copy(p);
      const size = 150 * this.sparks.scale;
      this.flash.scale.set(size, size, 1);
      (this.flash.material as ShaderMaterial).uniforms.uBirth.value = now;
      this.pendingBurst.n = 0;
    }
    if (this.pCur.has) {
      if (this.pPrev.has) {
        const dx = this.pCur.x - this.pPrev.x, dy = this.pCur.y - this.pPrev.y;
        const dist = Math.hypot(dx, dy);
        const n = Math.min(7, Math.floor((dist / 10) * q + (Math.random() < 0.25 ? 1 : 0)));
        // momentum in px/s, screen y up
        const vx = dx * 60, vy = -dy * 60;
        for (let i = 0; i < n; i++) {
          const t = (i + 1) / n;
          this.toSparkPlane(this.pPrev.x + dx * t, this.pPrev.y + dy * t, this.v3);
          this.sparks.trail(this.v3, vx, vy, 1, now - (1 - t) / 60);
        }
      }
      this.pPrev.x = this.pCur.x;
      this.pPrev.y = this.pCur.y;
      this.pPrev.has = true;
    }
    this.sparks.flush();
  }

  // ── lifecycle ───────────────────────────────────────────────────────────
  private onVisibility = () => {
    this.visible = !document.hidden;
    this.updateRunning();
  };

  private onReducedChange = () => {
    this.reduced = this.mqReduced.matches;
    if (this.reduced) this.finishBoot();
    this.updateRunning();
    if (this.reduced) this.renderOnce();
  };

  private onLost = (e: Event) => {
    e.preventDefault();
    this.dispose();
    this.onFallback();
  };

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.io.disconnect();
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("blur", this.onLeave);
    document.documentElement.removeEventListener("mouseleave", this.onLeave);
    window.removeEventListener("scroll", this.onScroll, { capture: true });
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.mqReduced.removeEventListener("change", this.onReducedChange);
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    const geos = new Set<BufferGeometry>(), mats = new Set<Material>();
    this.scene.traverse((o: Object3D) => {
      const m = o as Mesh;
      if (m.geometry) geos.add(m.geometry);
      if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => mats.add(x));
    });
    geos.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
    const tex = this.terrainMat.uniforms.uGround.value as { dispose(): void };
    tex.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.probe.remove();
    if (window.__voltaScene) window.__voltaScene.paused = true;
  }
}

/** Dust motes spread through the view, from the foreground to the middle distance. */
function moteField(n: number): Vector3[] {
  const out: Vector3[] = [];
  let s = 9;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const sx = -150 + r() * 1900, sy = -40 + r() * 960, d = 700 + r() * 2800;
    out.push(new Vector3(((sx - OPTIC_X) * d) / FOCAL, (-(sy - OPTIC_Y) * d) / FOCAL, CAM_Z - d));
  }
  return out;
}
