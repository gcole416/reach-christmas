// Ad-hoc probe used while building the stub suite: drives the real login form
// against the stub and prints console output plus every request it makes.
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => console.log("[console]", m.type(), m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("requestfailed", (r) => console.log("[requestfailed]", r.url(), r.failure()?.errorText));
page.on("response", async (r) => {
  if (r.url().includes("54999")) console.log("[stub]", r.status(), r.request().method(), r.url().slice(0, 160));
});

await page.goto("http://127.0.0.1:3100/admin/login");
await page.getByLabel(/email/i).fill("stub-user@autotest.example.com");
await page.getByLabel(/password/i).fill("stub-password");
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForTimeout(4000);
console.log("URL after sign in:", page.url());
console.log("cookies:", (await page.context().cookies()).map((c) => c.name));
console.log("body:", (await page.locator("body").innerText()).slice(0, 800));
await browser.close();
