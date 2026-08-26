import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";

// Same Supabase project the app itself talks to during `npm run dev` — see
// README.md's "Two Supabase projects" section. Loaded in the same order Next
// itself uses (.env.local as the fallback, .env.development.local wins),
// plus .env.test.local on top for the dedicated test account credentials.
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env.development.local", override: true });
dotenv.config({ path: ".env.test.local", override: true });

export default defineConfig({
  testDir: "./tests/e2e",
  // Forced serial: the two shared test accounts hit Supabase Auth's rate limit under
  // parallel sign-in, and every describe's afterAll deletes all AutoTest-tagged rows,
  // which wipes data still in use by a different worker's test. See OPEN_QUESTIONS.md TST-1 —
  // measured 3/5 then 13/18 failures at default parallelism, clean 5/5 and 16/18 at workers: 1.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
