import { defineConfig } from "@playwright/test";

// A SECOND, self-contained Playwright project for the US-13 concurrency work.
//
// It does not touch any Supabase project at all: it boots the in-memory stub
// (tests/stub/postgrestStub.mjs) and points a dedicated `next dev` at it via
// NEXT_PUBLIC_SUPABASE_URL. Explicit process env wins over .env* files in
// Next's loader, so the dev server started here can never reach the real dev
// (or prod) project — the specs additionally abort on any request to
// *.supabase.co.
//
// Run with:  npx playwright test --config tests/stub/playwright.config.ts
//
// The root playwright.config.ts is the real-database suite and still needs
// working test accounts; keep them separate and don't run both at once (they
// share the .next build dir).
const STUB_PORT = 54999;
const APP_PORT = 3100;

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 90_000,
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `node tests/stub/postgrestStub.mjs`,
      cwd: "../..",
      url: `http://127.0.0.1:${STUB_PORT}/__control/health`,
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      // --webpack, not Turbopack: run-stub-suite.mjs mirrors the app into a
      // scratch dir with a junction to the real node_modules, and Turbopack
      // refuses to follow a symlink that leaves the project root.
      command: `npm run dev -- --port ${APP_PORT}`,
      cwd: "../..",
      url: `http://127.0.0.1:${APP_PORT}/admin/login`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${STUB_PORT}`,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "stub-anon-key-not-a-real-credential",
      },
    },
  ],
});
