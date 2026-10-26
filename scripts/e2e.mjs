// End-to-end check of the deployed (or locally previewed) frontend, in a fresh headless Chrome
// that the caller starts with --remote-debugging-port (no profile, no logins).
//
//   node scripts/e2e.mjs <base-url> <csv-path> [cdp-port=9333] [shots-dir]
//
// Flow: Landing (live data) -> Launch dashboard -> Input -> upload the CSV (the ONE forecast
// post) -> Open on dashboard -> History lists the run -> reopen it. At 1440 and 390 it also
// loads every route. It fails if any request is an OPTIONS preflight, if the console logs an
// error, or if the landing falls back to the snapshot.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const [base, csvPath, port = "9333", shots = ""] = process.argv.slice(2);
if (!base || !csvPath) throw new Error("usage: node scripts/e2e.mjs <base-url> <csv-path> [cdp-port] [shots-dir]");
setTimeout(() => { console.error("e2e: timed out"); process.exit(2); }, 240_000);
if (shots) mkdirSync(shots, { recursive: true });

const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const requests = [];
const errors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === "Network.requestWillBeSent") requests.push({ method: msg.params.request.method, url: msg.params.request.url });
  if (msg.method === "Runtime.exceptionThrown") errors.push("exception: " + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text));
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") errors.push("console.error: " + msg.params.args.map((a) => a.value ?? a.description).join(" "));
  if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") errors.push("log: " + msg.params.entry.text);
};
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const until = async (expr, what, ms = 30_000) => {
  // !!(...) so a DOM node comes back as true: a node itself doesn't serialise by value
  for (const t0 = Date.now(); Date.now() - t0 < ms; await wait(250)) if (await evaluate(`!!(${expr})`)) return;
  throw new Error(`e2e: timed out waiting for ${what}`);
};
const shot = async (name) => {
  if (!shots) return;
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${shots}/${name}.png`, Buffer.from(r.result.data, "base64"));
};
const size = (w, h) => send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: w < 900 ? 2 : 1, mobile: w < 900 });
const go = async (path) => { await send("Page.navigate", { url: base + path }); await wait(2500); };
const clickText = (selector, text) => evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.includes(${JSON.stringify(text)}) || e.getAttribute("aria-label") === ${JSON.stringify(text)}); if (!el) return false; el.click(); return true; })()`);
const path = () => evaluate("location.pathname + location.search");

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`); };

await send("Runtime.enable"); await send("Log.enable"); await send("Page.enable"); await send("Network.enable"); await send("DOM.enable");
const downloads = mkdtempSync(`${tmpdir()}/volta-e2e-`);
await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
const downloaded = async (name, ms = 15_000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await wait(250)) {
    if (existsSync(`${downloads}/${name}`)) return readFileSync(`${downloads}/${name}`, "utf8");
  }
  return null;
};

// 1. Landing, live
await size(1440, 900);
await go("/");
await until("document.querySelector('.vl-card') && !document.querySelector('.vl-shimmer')", "the landing cards", 20_000);
await wait(1500);
check("landing shows live data", !(await evaluate("document.body.innerText.includes('Snapshot')")));
await shot("01-landing-1440");

// 2. Launch dashboard
check("Launch dashboard pill", await clickText("a.vl-pill", "Launch dashboard"));
await wait(1500);
check("  -> /dashboard", (await path()).startsWith("/dashboard"), await path());

// 3. Input, upload the CSV
await go("/input");
await until("document.querySelector('input[type=file]')", "the CSV input");
const { root } = (await send("DOM.getDocument")).result;
const { nodeId } = (await send("DOM.querySelector", { nodeId: root.nodeId, selector: "input[type=file]" })).result;
await send("DOM.setFileInputFiles", { nodeId, files: [resolve(csvPath)] });
await until("[...document.querySelectorAll('a,button')].some(e => e.textContent.includes('Open on dashboard'))", "the run card", 60_000);
const saved = await evaluate("document.body.innerText.match(/Saved|Not saved[^\\n]*/)?.[0] ?? ''");
check("CSV forecast returns a run", true, saved);
await shot("02-input-report-1440");
check("Open on dashboard", await clickText("a,button", "Open on dashboard"));
await until("location.pathname === '/dashboard' && document.body.innerText.includes('Controller')", "the dashboard");
const runUrl = await path();
const runId = new URLSearchParams(runUrl.split("?")[1] ?? "").get("run");
check("  -> dashboard shows the new run", !!runId, runUrl);
await wait(2000);
await shot("03-dashboard-1440");

check("Dashboard Download CSV", await clickText("a,button", "Download CSV"));
const dashCsv = await downloaded(`volta-run-${runId}.csv`);
check("  -> CSV with header + 48 rows", dashCsv?.startsWith("timestamp,") && dashCsv.trim().split(/\r?\n/).length === 49, `${dashCsv?.trim().split(/\r?\n/).length ?? 0} lines`);

// 4. History lists it, reopen
await go("/history");
await until(`document.querySelector('a[href*="${runId}"]')`, "the run in History", 20_000);
check("History lists the run", true, runId);
await shot("04-history-1440");
const csvFiles = () => readdirSync(downloads).filter((f) => f.endsWith(".csv"));
const before = csvFiles().length;
check("History card CSV", await evaluate(`(() => { const b = document.querySelector('button[aria-label="Download run ${runId.slice(-6)} as CSV"]'); if (!b) return false; b.click(); return true; })()`));
for (const t0 = Date.now(); Date.now() - t0 < 15_000 && csvFiles().length <= before; ) await wait(250);
check("  -> a second CSV file", csvFiles().length > before, csvFiles().join(" "));
await evaluate(`document.querySelector('a[href*="${runId}"]').click()`);
await until(`location.search.includes("${runId}")`, "reopening the run");
check("History reopens the run", true);

// 5. Dock links on an app route
for (const [label, want] of [["Forecast", "/input"], ["History", "/history"], ["Controller", "/dashboard"]]) {
  await clickText("nav[aria-label=Primary] a", label);
  await wait(1200);
  check(`dock ${label}`, (await path()).startsWith(want), await path());
}

// 6. Every route at 390
await size(390, 844);
for (const route of ["/", `/dashboard?run=${runId}`, "/input", "/history"]) {
  await go(route);
  await wait(2500);
  const overflow = await evaluate("document.documentElement.scrollWidth > innerWidth");
  check(`390 ${route.split("?")[0]} no overflow`, !overflow);
  await shot(`05-${route.split("?")[0].replace(/\W/g, "") || "landing"}-390`);
}

// 7. No preflights, no console errors
const options = requests.filter((r) => r.method === "OPTIONS");
check("no OPTIONS preflight requests", options.length === 0, options.map((r) => r.url).join(" "));
check("no console errors", errors.length === 0, errors.join(" | ").slice(0, 400));

console.log(JSON.stringify({ runId, saved, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length }));
await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
