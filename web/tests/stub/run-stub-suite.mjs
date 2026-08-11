// Runs the stub-backed US-13 suite.
//
// Next 16's dev server takes a per-directory lock, so it refuses to start a
// second instance in web/ if one is already running (which is normal when
// someone is developing). This mirrors the app source into a scratch directory
// with a junction/symlink to the real node_modules, and runs the stub suite
// there. Nothing is copied back.
//
// It also deliberately does NOT copy any .env* file: the stub config sets
// NEXT_PUBLIC_SUPABASE_URL/ANON_KEY explicitly, so the mirrored app has no way
// to reach a real Supabase project even by accident.
//
// Usage (from web/):  node tests/stub/run-stub-suite.mjs [-- extra playwright args]
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// Kept inside web/tests (and gitignored there) rather than in the OS temp dir:
// Turbopack refuses to follow a node_modules symlink that leaves the project's
// filesystem root, which a cross-drive temp dir does.
const scratch = path.join(webDir, "tests", ".stub-app");

const COPY = [
  "app",
  "components",
  "lib",
  "public",
  "tests/stub",
  "package.json",
  "next.config.ts",
  "tsconfig.json",
  "postcss.config.mjs",
  "next-env.d.ts",
  "proxy.ts",
];

if (existsSync(scratch)) {
  for (const entry of COPY) rmSync(path.join(scratch, entry), { recursive: true, force: true });
} else {
  mkdirSync(scratch, { recursive: true });
}

for (const entry of COPY) {
  const from = path.join(webDir, entry);
  const to = path.join(scratch, entry);
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
}

const nodeModules = path.join(scratch, "node_modules");
if (!existsSync(nodeModules)) {
  symlinkSync(path.join(webDir, "node_modules"), nodeModules, "junction");
}

console.log(`[stub-suite] mirrored app -> ${scratch}`);

const extra = process.argv.slice(2);
const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["playwright", "test", "--config", path.join(scratch, "tests/stub/playwright.config.ts"), ...extra],
  { cwd: scratch, stdio: "inherit", env: process.env }
);
process.exit(result.status ?? 1);
