import { defineConfig } from "@playwright/test";
import baseConfig from "../playwright.config";

// Same suite, pointed at a dev server that is ALREADY running on a non-default
// port.
//
// Next 16 allows only one `next dev` per project directory, so when someone
// else on the team already has one up (it picks 3100 when 3000 is taken), the
// root playwright.config.ts can't start its own and the run dies before a
// single test executes. This config reuses whatever is already serving.
//
//   E2E_BASE_URL=http://localhost:3100 \
//     npx playwright test --config tests/playwright.existing-server.config.ts --workers=1
//
// Use the root config (`npm run test:e2e`) whenever port 3000 is free — it
// starts and stops its own server, which is the reproducible path.

export default defineConfig({
  ...baseConfig,
  testDir: "./e2e",
  use: {
    ...baseConfig.use,
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
  },
  webServer: undefined,
});
