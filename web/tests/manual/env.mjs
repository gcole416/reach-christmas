// Shared bootstrap for the US-13 manual verification scripts.
//
// SAFETY: refuses to run against anything but the dev project. `.env.local`
// points at PRODUCTION; `.env.development.local` overrides it with dev, in the
// same order `npm run dev` and playwright.config.ts load them. If the resolved
// URL is not the dev ref, this throws before any client is created.
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

dotenv.config({ path: path.join(webDir, ".env.local"), quiet: true });
dotenv.config({ path: path.join(webDir, ".env.development.local"), override: true, quiet: true });
dotenv.config({ path: path.join(webDir, ".env.test.local"), override: true, quiet: true });

export const DEV_PROJECT_REF = "thvyntrxmahygesltgft";
export const PROD_PROJECT_REF = "mpiueduyrmplrueviupl";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

const ref = SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? "(none)";

export function assertDevProject() {
  if (ref === PROD_PROJECT_REF) {
    throw new Error(`ABORT: resolved Supabase URL is PRODUCTION (${ref}). Refusing to run.`);
  }
  if (ref !== DEV_PROJECT_REF) {
    throw new Error(`ABORT: resolved Supabase URL ref is "${ref}", expected dev (${DEV_PROJECT_REF}).`);
  }
  if (/sb_secret|service_role/i.test(SUPABASE_ANON_KEY)) {
    throw new Error("ABORT: the configured key looks like a service_role/secret key. Never use that here.");
  }
  return ref;
}

export function projectRef() {
  return ref;
}

export function anonClient() {
  assertDevProject();
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function signInAs(role) {
  const email = role === "admin" ? process.env.TEST_ADMIN_EMAIL : process.env.TEST_VOLUNTEER_EMAIL;
  const password = role === "admin" ? process.env.TEST_ADMIN_PASSWORD : process.env.TEST_VOLUNTEER_PASSWORD;
  if (!email || !password) throw new Error(`Missing TEST_${role.toUpperCase()}_EMAIL/PASSWORD in .env.test.local`);
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in as ${role} (${email}) failed: ${error.message}`);
  return client;
}
