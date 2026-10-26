import { useCallback, useEffect, useRef, useState } from "react";
import { loadForecast, SNAPSHOT, type Forecast, type Hour } from "@/lib/forecast";
import { GridScene, type GridSceneHandle } from "@/scene";
import { Dock } from "./Dock";
import { Headline, HeadlineSwitcher } from "./Headline";
import { readHeadlineParam } from "./headlines";
import { LaunchPill, PlayButton } from "./HeroButtons";
import { ModeCard, PeakCard, PeakKnob } from "./Cards";
import { SideStats } from "./SideStats";
import { FINE_HOVER, NARROW, REDUCED_MOTION, useMedia } from "./useMedia";
import { useAfterPaint } from "./useAfterPaint";
import { cssVars } from "./cssVars";
import { PAGE_TITLE, WORDMARK } from "@/lib/brand";
import "@/styles/landing.css";

/* Screen 1: the VOLTA landing page, on Sylva's 1600-unit stage (760 below
 * 900px). The page owns the data: it loads the forecast, picks the hour on
 * show (the first hour, or the playback hour) and tells the scene. */

const STEP_MS = 600; // playback: ~0.6s an hour, ~15s for the day
const INTRO_MS = 2900; // after the staged wipes, the clips come off
const ANNOUNCE_MS = 5200; // how long "Played 24 h · held at HH:00" stays under the disc
const FLASH_MS = 900; // reduced motion: the plates' one non-motion cue

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
const sceneState = (h: Hour) => ({ mode: h.mode, overload: h.overload, pvKw: h.pvKw, batteryKw: h.batteryKw });

export function Landing() {
  const rootRef = useRef<HTMLElement>(null);
  const sceneRef = useRef<GridSceneHandle | null>(null);
  const [phase, setPhase] = useState<"pre" | "ready" | "done">("pre");
  const [forecast, setForecast] = useState<Forecast>(SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [played, setPlayed] = useState(false);
  const [headline, setHeadline] = useState(readHeadlineParam);
  const [announce, setAnnounce] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const narrow = useMedia(NARROW);
  // the scene (three.js, its own chunk) mounts once the hero has painted and the page is idle
  const sceneOn = useAfterPaint();
  const run = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const after = useRef<number[]>([]);

  useEffect(() => {
    document.title = PAGE_TITLE;
  }, []);

  const hour = forecast.hours[Math.min(index, forecast.hours.length - 1)];

  // first load: show the snapshot dimmed until the live answer (or the labelled fallback) arrives
  useEffect(() => {
    let alive = true;
    void loadForecast().then((f) => {
      if (!alive) return;
      setForecast(f);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  // entrance: let the pre-intro styles paint once, then release them
  useEffect(() => {
    const reduced = window.matchMedia(REDUCED_MOTION).matches;
    let done: number | undefined;
    const raf = requestAnimationFrame(() => {
      void rootRef.current?.offsetHeight;
      setPhase("ready");
      done = window.setTimeout(() => setPhase("done"), reduced ? 0 : INTRO_MS);
    });
    return () => { cancelAnimationFrame(raf); clearTimeout(done); };
  }, []);

  // pointer parallax: one eased pointer, published as --px/--py on the hero
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const mqHover = window.matchMedia(FINE_HOVER);
    const mqReduced = window.matchMedia(REDUCED_MOTION);
    const target = { x: 0, y: 0 };
    const cur = { x: 0, y: 0 };
    let raf = 0;
    let lastX = NaN;
    let lastY = NaN;
    const enabled = () => mqHover.matches && !mqReduced.matches;
    const apply = () => {
      root.classList.toggle("is-par", enabled());
      if (!enabled()) { root.style.removeProperty("--px"); root.style.removeProperty("--py"); }
    };
    const frame = () => {
      raf = 0;
      cur.x += (target.x - cur.x) * 0.055;
      cur.y += (target.y - cur.y) * 0.055;
      const nx = Math.round(cur.x * 1000) / 1000;
      const ny = Math.round(cur.y * 1000) / 1000;
      if (nx !== lastX || ny !== lastY) {
        lastX = nx; lastY = ny;
        root.style.setProperty("--px", String(nx));
        root.style.setProperty("--py", String(ny));
        raf = requestAnimationFrame(frame);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch" || !enabled()) return;
      target.x = (e.clientX / window.innerWidth) * 2 - 1;
      target.y = (e.clientY / window.innerHeight) * 2 - 1;
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const onLeave = () => {
      target.x = target.y = 0;
      if (!raf && enabled()) raf = requestAnimationFrame(frame);
    };
    apply();
    mqHover.addEventListener("change", apply);
    mqReduced.addEventListener("change", apply);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      mqHover.removeEventListener("change", apply);
      mqReduced.removeEventListener("change", apply);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  // the scene follows the controller signal of the hour on show
  const hourRef = useRef(hour);
  useEffect(() => {
    hourRef.current = hour;
    sceneRef.current?.setState(sceneState(hour));
  }, [hour]);
  const onSceneReady = useCallback((h: GridSceneHandle) => {
    sceneRef.current = h;
    h.setState(sceneState(hourRef.current));
  }, []);

  // "Run sample forecast": re-fetch, then play the 24 hours and hold on the last
  const play = useCallback(async () => {
    const id = ++run.current;
    clearInterval(timer.current);
    after.current.forEach(clearTimeout);
    after.current = [];
    setAnnounce(null);
    setFlash(false);
    setPlayed(true);
    setPlaying(true);
    setIndex(0);
    setLoading(true);
    const f = await loadForecast();
    if (id !== run.current) return;
    setForecast(f);
    setLoading(false);
    const last = f.hours.length - 1;
    // the end state, said out loud: under the disc, and to screen readers
    const finish = (cue: boolean) => {
      setPlaying(false);
      setAnnounce(`Played ${f.hours.length} h · held at ${hh(f.hours[last].hour)}`);
      if (cue) {
        setFlash(true);
        after.current.push(window.setTimeout(() => setFlash(false), FLASH_MS));
      }
      after.current.push(window.setTimeout(() => setAnnounce(null), ANNOUNCE_MS));
    };
    if (window.matchMedia(REDUCED_MOTION).matches) {
      setIndex(last);
      finish(true);
      return;
    }
    let i = 0;
    timer.current = window.setInterval(() => {
      i += 1;
      setIndex(Math.min(i, last));
      if (i >= last) {
        clearInterval(timer.current);
        finish(false);
      }
    }, STEP_MS);
  }, []);
  useEffect(() => () => {
    clearInterval(timer.current);
    after.current.forEach(clearTimeout);
  }, []);

  const caption = playing ? (loading ? "Fetching forecast" : `Playing ${hh(hour.hour)}`) : (announce ?? "Run sample forecast");
  const switcher = <HeadlineSwitcher option={headline} onChange={setHeadline} />;
  const cards = { forecast, hour, index, loading, played, flash };

  // DOM order follows the screen, so the tab order does too: the dock, the
  // review chips (desktop: under the dock, on the headline's rail), the pill,
  // the play disc, card 1's knob, then card 2's.
  return (
    <main
      ref={rootRef}
      id="top"
      className={`vl${phase !== "pre" ? " is-ready" : ""}${phase === "done" ? " intro-done" : ""}`}
    >
      {/* the scene fills the hero at z 3, aria-hidden and click-through; its sparks listen on window */}
      {sceneOn && <GridScene className="vl-scene" onReady={onSceneReady} />}

      <Dock />

      <div className="vl-stage">
        {!narrow && switcher}
        <div className="vl-guides fade" style={cssVars({ "--d": "900ms" })} aria-hidden="true">
          <i /><i /><i />
        </div>
        <div className="vl-ghost" aria-hidden="true">{WORDMARK}</div>

        {/* card 1 sits behind the canvas; its knob floats above it */}
        <PeakCard {...cards} />

        <Headline option={headline} />
        <p className="vl-lede mask par" style={cssVars({ "--d": "480ms", "--pd": 14, "--pr": 1 })}>
          We forecast every hour of demand, then route it through the grid, the battery or the sun before the peak arrives.
        </p>

        <LaunchPill />
        {narrow && switcher}
        <PlayButton onPlay={() => void play()} playing={playing} announcing={announce != null} caption={caption} />
        <p className="sr-only" role="status">{announce}</p>

        <PeakKnob />

        <SideStats socPct={hour.socPct} overloadHours={forecast.overloadHours} total={forecast.hours.length} />

        <ModeCard {...cards} />
      </div>
    </main>
  );
}
