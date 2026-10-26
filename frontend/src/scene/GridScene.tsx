import { useEffect, useRef, useState, type JSX } from "react";
import type { GridEngine, GridState } from "./engine";
import { webglAvailable } from "./support";
import "./scene.css";

export interface GridSceneHandle {
  /** Eases the current toward the controller state for the shown hour. */
  setState(s: GridState): void;
  dispose(): void;
}

export interface GridSceneProps {
  onReady?: (h: GridSceneHandle) => void;
  className?: string;
}

/**
 * The power-grid landscape. Renders its own canvas (or, without WebGL, a poster
 * of the same composition) filling its positioned parent, at z-index --z-scene,
 * aria-hidden and click-through. The page owns the data and calls setState.
 */
export function GridScene({ onReady, className }: GridSceneProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(() => !webglAvailable());
  const readyRef = useRef(onReady);
  useEffect(() => {
    readyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let engine: GridEngine | null = null;
    let live = true;
    const handle: GridSceneHandle = {
      setState: (s) => engine?.setState(s),
      dispose: () => {
        live = false;
        engine?.dispose();
        engine = null;
      },
    };
    if (fallback) {
      readyRef.current?.(handle);
    } else {
      // three.js loads in its own chunk, after the page has painted
      import("./engine")
        .then(({ GridEngine }) => {
          if (!live) return;
          engine = new GridEngine(root, { onFallback: () => setFallback(true) });
          readyRef.current?.(handle);
        })
        .catch((err: unknown) => {
          if (!live) return;
          console.warn("VOLTA scene: WebGL could not start, showing the poster instead.", err);
          setFallback(true);
        });
    }
    return () => handle.dispose();
  }, [fallback]);

  return (
    <div
      ref={rootRef}
      className={["volta-scene", fallback ? "is-fallback" : "", className ?? ""].filter(Boolean).join(" ")}
      aria-hidden="true"
    >
      {fallback && (
        <img className="volta-scene__poster" src={`${import.meta.env.BASE_URL}volta-scene.webp`} alt="" decoding="async" />
      )}
    </div>
  );
}
