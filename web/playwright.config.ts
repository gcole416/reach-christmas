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
  fullyParallel: true,
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
