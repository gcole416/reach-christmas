#!/usr/bin/env node
// =============================================================================
// bulk-create-volunteers.mjs — create many volunteer logins at once.
// =============================================================================
//
// WHY THIS EXISTS: creating a login is still Supabase-dashboard-only (see
// OPEN_QUESTIONS.md ADM-6, docs/backlog.md US-10) — there is no in-app account
// creation, because that would need a server-side route holding the
// service_role key, which is permanently banned from this app/repo. Clicking
// "Add user" one at a time in the dashboard doesn't scale to a real volunteer
// list. This script is the escape hatch: a one-off, run-it-yourself tool, NOT
// part of the deployed app, that never puts the key anywhere the app can read
// it.
//
// IT SKIPS SUPABASE'S BUILT-IN INVITE EMAIL ON PURPOSE. That system has a low
// rate limit and isn't meant for real use — the same reason this project
// built its own Resend path for sponsor/counselor email instead of relying on
// it (see supabase/migrations/20260818160000_email_verified_claims.sql).
// Every account below is created already-confirmed with a password YOU
// generate and hand out yourself, same as the manual "Create new user" flow —
// this script just does that in bulk from a CSV.
//
// =============================================================================
// HOW TO RUN THIS (you, not Claude — this needs the service_role key)
// =============================================================================
//
// 1. Get the key: Supabase dashboard -> your project -> Settings -> API ->
//    "service_role" secret (NOT "anon public"). Copy it.
//
//    ‼ NEVER paste this key into a chat with Claude, a commit, or any .env
//      file that's tracked or shared. It grants full admin access to your
//      whole database, bypassing every RLS policy in the app. Set it only as
//      a one-time environment variable for this one run, below.
//
// 2. Copy volunteers.example.csv to volunteers.csv (already gitignored — see
//    ../../.gitignore) and fill in real names/emails, one per row:
//      name,email
//      Jane Smith,jane@example.com
//      ...
//
// 3. From the web/ directory, run (macOS/Linux/Git-Bash):
//      SUPABASE_URL="https://<dev-project-ref>.supabase.co" \
//      SUPABASE_SERVICE_ROLE_KEY="<paste the key here, this one time>" \
//      node scripts/bulk-create-volunteers.mjs
//
//    Or on plain Windows PowerShell:
//      $env:SUPABASE_URL = "https://<dev-project-ref>.supabase.co"
//      $env:SUPABASE_SERVICE_ROLE_KEY = "<paste the key here, this one time>"
//      node scripts/bulk-create-volunteers.mjs
//
//    SUPABASE_URL is the SAME value as NEXT_PUBLIC_SUPABASE_URL in
//    .env.development.local for dev, or .env.local for prod — confirm which
//    project you actually mean (see memory.md's dev-vs-prod note). This runs
//    directly against whichever project you point it at; there's no "are you
//    sure" prompt built in beyond the confirmation below.
//
// 4. It prints a live summary as it goes, then writes
//    volunteers-credentials-<timestamp>.csv next to this script — name,
//    email, and the password it generated for each person. That file is also
//    gitignored. Send each person THEIR OWN row (text, a sealed note, however
//    you'd hand out a real credential) — not the whole list to everyone.
//    Delete the file once you've distributed everything; it's a plaintext
//    password list.
//
// Every account lands as role='volunteer', confidential access OFF — the same
// defaults a dashboard-created account gets (handle_new_user() in
// 20260708120000_init.sql). If a few of these people need confidential
// access, toggle it afterward in /admin/staff — not worth complicating this
// script for.
//
// Already-existing emails are skipped (reported, not treated as an error) —
// safe to re-run this against a CSV you've already partially processed, e.g.
// after fixing a typo on one row.

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import readline from "node:readline";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CSV_PATH = process.argv[2] ?? join(__dirname, "volunteers.csv");

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  fail(
    "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY as environment variables before running this " +
      "(see the header comment in this file for exact commands). Never hardcode the key in this file."
  );
}
if (!existsSync(CSV_PATH)) {
  fail(
    `No CSV found at ${CSV_PATH}. Copy volunteers.example.csv to volunteers.csv (or pass a path: ` +
      `node scripts/bulk-create-volunteers.mjs path/to/your.csv) and fill in real rows first.`
  );
}

// Minimal CSV parser — handles a quoted field with an embedded comma
// ("Smith, Jr.") or an escaped quote (""), good enough for name/email data
// without pulling in a dependency for a one-off script.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function randomPassword() {
  // 16 chars, base64url-ish alphabet — strong, no ambiguous-character
  // problems reading it back off a printed sheet.
  return randomBytes(12).toString("base64url");
}

async function confirm(promptText) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(promptText, resolve));
  rl.close();
  return answer.trim().toLowerCase() === "yes";
}

async function main() {
  const raw = readFileSync(CSV_PATH, "utf8");
  const rows = parseCsv(raw);
  if (rows.length === 0) fail(`${CSV_PATH} is empty.`);

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const nameIdx = header.indexOf("name");
  const emailIdx = header.indexOf("email");
  if (nameIdx === -1 || emailIdx === -1) {
    fail(`${CSV_PATH}'s header row must have "name" and "email" columns. Found: ${header.join(", ")}`);
  }

  const people = rows
    .slice(1)
    .map((r) => ({ name: (r[nameIdx] ?? "").trim(), email: (r[emailIdx] ?? "").trim() }))
    .filter((p) => p.email);

  if (people.length === 0) fail(`No data rows with an email found in ${CSV_PATH}.`);

  console.log(`Project: ${SUPABASE_URL}`);
  console.log(`About to create up to ${people.length} account(s) from ${CSV_PATH}:`);
  for (const p of people) console.log(`  - ${p.name || "(no name)"} <${p.email}>`);

  const ok = await confirm(`\nType "yes" to proceed against ${SUPABASE_URL}: `);
  if (!ok) fail("Cancelled — nothing was created.");

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const results = [];
  for (const p of people) {
    const password = randomPassword();
    const { error } = await admin.auth.admin.createUser({
      email: p.email,
      password,
      email_confirm: true, // already confirmed — no confirmation email sent, no dependency on Supabase's mailer
      user_metadata: p.name ? { full_name: p.name } : undefined,
    });

    if (error) {
      const alreadyExists = /already registered|already exists/i.test(error.message);
      console.log(`  ${alreadyExists ? "· skipped (already exists)" : "✖ FAILED"}: ${p.email} — ${error.message}`);
      results.push({ ...p, password: "", status: alreadyExists ? "already_exists" : `failed: ${error.message}` });
      continue;
    }

    console.log(`  ✓ created: ${p.email}`);
    results.push({ ...p, password, status: "created" });
  }

  const created = results.filter((r) => r.status === "created").length;
  const skipped = results.filter((r) => r.status === "already_exists").length;
  const failed = results.length - created - skipped;
  console.log(`\nDone: ${created} created, ${skipped} already existed, ${failed} failed.`);
  console.log(
    `Every created account is role='volunteer', confidential access off — same defaults as a ` +
      `dashboard-created account. Toggle confidential access per-person in /admin/staff if needed.`
  );

  const outPath = join(__dirname, `volunteers-credentials-${Date.now()}.csv`);
  const csvOut = ["name,email,password,status", ...results.map((r) =>
    [r.name, r.email, r.password, r.status].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
  )].join("\n");
  writeFileSync(outPath, csvOut, "utf8");
  console.log(`\nCredentials written to: ${outPath}`);
  console.log(
    `Send each person ONLY their own row. This file is plaintext passwords — delete it once ` +
      `everyone has theirs. It's gitignored, but that only stops it entering git; it's still ` +
      `sitting on your disk until you remove it.`
  );
}

main().catch((err) => fail(err.stack ?? String(err)));
