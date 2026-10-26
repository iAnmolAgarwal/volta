import { useCallback, useState } from "react";
import { LayoutDashboard, Play } from "lucide-react";
import { LiquidMetal } from "./LiquidMetal";
import { NARROW, REDUCED_MOTION, useMedia } from "./useMedia";
import { useAfterPaint } from "./useAfterPaint";
import { cssVars } from "./cssVars";

/* The two hero controls. "Launch dashboard" is the most prominent button: a
 * dark glass pill with a liquid-metal rim (our WebGL2 shader, tinted --volt)
 * on desktop; phones and reduced motion get the plain glass pill. The play
 * disc uses the same surface inside Sylva's outer ring. The metal mounts once
 * the hero has painted (its shaders never sit in front of LCP) and fades in
 * over the glass it replaces. */

function useMetal() {
  const narrow = useMedia(NARROW);
  const reduced = useMedia(REDUCED_MOTION);
  const painted = useAfterPaint();
  const [failed, setFailed] = useState(false);
  const onUnavailable = useCallback(() => setFailed(true), []);
  return { metal: painted && !narrow && !reduced && !failed, onUnavailable };
}

export function LaunchPill() {
  const { metal, onUnavailable } = useMetal();
  return (
    <div className="vl-pill-wrap">
      <div className="vl-pill-reveal mask par" style={cssVars({ "--d": "600ms", "--pd": 15, "--pr": 1.4 })}>
        <a className={`vl-pill${metal ? " is-metal" : ""}`} href="#dashboard">
          <span className="vl-plate-glass" aria-hidden="true" />
          {metal && <LiquidMetal onUnavailable={onUnavailable} />}
          <LayoutDashboard className="vl-pill-icon" aria-hidden strokeWidth={1.6} />
          <span className="vl-pill-label">Launch dashboard</span>
        </a>
      </div>
    </div>
  );
}

export function PlayButton({ onPlay, playing, announcing, caption }: { onPlay: () => void; playing: boolean; announcing: boolean; caption: string }) {
  const { metal, onUnavailable } = useMetal();
  return (
    <span className="vl-play par" style={cssVars({ "--pd": 20 })} data-playing={playing || undefined} data-announce={announcing || undefined}>
      <span className="vl-play-ring mask-circle" style={cssVars({ "--d": "840ms" })} aria-hidden="true" />
      <span className="vl-play-reveal mask-circle" style={cssVars({ "--d": "900ms" })}>
        <button type="button" className={`vl-play-btn${metal ? " is-metal" : ""}`} onClick={onPlay} aria-label="Run sample forecast">
          <span className="vl-plate-glass" aria-hidden="true" />
          {metal && <LiquidMetal onUnavailable={onUnavailable} />}
          <Play className="vl-play-icon" aria-hidden strokeWidth={1.4} />
        </button>
      </span>
      <span className="vl-play-caption" aria-hidden="true">{caption}</span>
    </span>
  );
}
