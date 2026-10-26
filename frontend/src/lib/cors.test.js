// Every browser request must stay a CORS "simple" request: the Catalyst gateway
// answers preflights itself, without CORS headers, so a preflighted call from
// Slate fails (docs/api.md). This scans src/ for anything that would preflight:
// a JSON content type, or any request header other than a text/plain
// Content-Type. Plain JS, like supply.test.js, so tsc needn't know vitest.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL("..", import.meta.url).pathname;

function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

const files = sources(SRC).map((path) => ({ path: path.slice(SRC.length), text: readFileSync(path, "utf8") }));

describe("browser requests skip the CORS preflight", () => {
  it("finds the source files", () => {
    expect(files.some((f) => f.path.endsWith("lib/api.ts"))).toBe(true);
  });

  it("never send a JSON content type", () => {
    const hits = files.filter((f) => /["']application\/json["']/.test(f.text)).map((f) => f.path);
    expect(hits).toEqual([]);
  });

  it("send no request header but a text/plain Content-Type", () => {
    const bad = [];
    for (const f of files) {
      for (const m of f.text.matchAll(/headers\s*:\s*\{([^}]*)\}/g)) {
        const body = m[1].replace(/\/\/.*$/gm, "").trim();
        if (!/^["']?Content-Type["']?\s*:\s*["']text\/plain;charset=UTF-8["']\s*,?$/.test(body)) bad.push(`${f.path}: ${body}`);
      }
      if (/new Headers\(|\.setRequestHeader\(/.test(f.text)) bad.push(`${f.path}: Headers / setRequestHeader`);
    }
    expect(bad).toEqual([]);
  });
});
