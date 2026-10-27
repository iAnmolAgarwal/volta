import { Suspense, useEffect } from "react";
import { Outlet, useLocation } from "react-router";
import { Dock, type DockId } from "@/components/landing/Dock";
import { WORDMARK } from "@/lib/brand";
import { Shimmer } from "./States";
import "@/styles/landing.css"; // the dock's own rules (already in the entry bundle; listed so the dependency is explicit)
import "@/styles/app.css";

/* The shell of the three app routes: Sylva's field (the hero olive with its
 * soft light pool), the faint guides at Sylva's x 405 / 748 / 1091, the ghost
 * wordmark, and the landing's dock, fixed at the top with the route's item
 * active. No 3D scene here. One column below 900px. */

const ACTIVE: Record<string, DockId> = {
  "/input": "forecast",
  "/dashboard": "controller",
  "/history": "history",
};

// Controller opens the run in context: the dashboard's own ?run= / ?unsaved=1, else plain /dashboard,
// which opens the viewer's last run itself (read when clicked, so a run made on this page counts)
function controllerHref(pathname: string, search: string): string {
  return pathname === "/dashboard" && /[?&](run|unsaved)=/.test(search) ? `/dashboard${search}` : "/dashboard";
}

export default function AppLayout() {
  const { pathname, search } = useLocation();
  const active = ACTIVE[pathname] ?? null;

  // a new route starts at the top
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="va">
      <div className="va-backdrop" aria-hidden="true">
        <div className="va-frame">
          <div className="va-guides"><i /><i /><i /></div>
        </div>
        <div className="va-ghost">{WORDMARK}</div>
      </div>
      <a className="va-skip" href="#va-main">Skip to content</a>
      <Dock active={active} controllerHref={controllerHref(pathname, search)} />
      <main className="va-main" id="va-main" tabIndex={-1}>
        <Suspense fallback={<div className="va-page"><Shimmer variant="text" lines={2} className="va-boot-title" /><Shimmer variant="chart" /></div>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
