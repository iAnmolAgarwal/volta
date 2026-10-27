// The VOLTA routes. The landing page (Screen 1) is the eager entry; the shell
// and the three app routes are lazy chunks, so they never weigh on its first
// paint.
import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { Landing } from "@/components/landing/Landing";

const AppLayout = lazy(() => import("@/components/app/AppLayout"));
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const InputPage = lazy(() => import("@/pages/InputPage"));
const HistoryPage = lazy(() => import("@/pages/HistoryPage"));

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route element={<Suspense fallback={null}><AppLayout /></Suspense>}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/input" element={<InputPage />} />
          <Route path="/history" element={<HistoryPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
