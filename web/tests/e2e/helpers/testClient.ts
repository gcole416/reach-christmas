import type { Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name} — the test suite reads this from .env.development.local (same as \`npm run dev\`).`
    );
  }
  return value;
}

/** A fresh, signed-out client — for anonymous/public-page actions like request_claim_code/claim_card_with_code. */
export function anonClient(): SupabaseClient {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", SUPABASE_ANON_KEY));
}

export type TestRole = "admin" | "volunteer";

/** Signs in as one of the two dedicated dev-project test accounts — see .env.test.local.example. */
export async function signInAs(role: TestRole): Promise<SupabaseClient> {
  const email = role === "admin" ? process.env.TEST_ADMIN_EMAIL : process.env.TEST_VOLUNTEER_EMAIL;
  const password = role === "admin" ? process.env.TEST_ADMIN_PASSWORD : process.env.TEST_VOLUNTEER_PASSWORD;

  if (!email || !password) {
    throw new Error(
      `Missing TEST_${role.toUpperCase()}_EMAIL/PASSWORD — copy .env.test.local.example to .env.test.local and fill in a dev-project test account.`
    );
  }

  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`Failed to sign in as test ${role} (${email}): ${error.message}`);
  }
  return client;
}

/** Logs in through the real /admin/login form — for tests that need an authenticated browser session, not just an API client. */
export async function loginAsInBrowser(page: Page, role: TestRole): Promise<void> {
  const email = role === "admin" ? process.env.TEST_ADMIN_EMAIL : process.env.TEST_VOLUNTEER_EMAIL;
  const password = role === "admin" ? process.env.TEST_ADMIN_PASSWORD : process.env.TEST_VOLUNTEER_PASSWORD;

  if (!email || !password) {
    throw new Error(
      `Missing TEST_${role.toUpperCase()}_EMAIL/PASSWORD — copy .env.test.local.example to .env.test.local and fill in a dev-project test account.`
    );
  }

  await page.goto("/admin/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/admin");
}

/** The drive every real page in the app reads/writes — tests operate on whichever one is currently open. */
export async function getOpenDriveId(client: SupabaseClient): Promise<string> {
  const { data, error } = await client
    .from("drives")
    .select("id")
    .eq("status", "open")
    .order("year", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No open drive in the dev project — open one on the Drives page before running tests.");
  return data.id;
}
