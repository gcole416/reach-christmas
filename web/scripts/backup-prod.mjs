// Saves a complete local snapshot of the PROD database to a file on this
// computer. Prod has no Supabase backups on the free plan (Grant, 2026-11-16),
// so this is the backup.
//
//   PROD IS ONLY EVER READ. Every call is a single SELECT sent with
//   read_only: true, so Supabase runs it as its read-only database user. Only
//   the read token (SUPABASE_ACCESS_TOKEN) is loaded; the write token is never
//   read by this script. Nothing here can change prod.
//
// What's saved, as one consistent snapshot (one statement):
//   * every row of every table in `public` (households, children, wish lists,
//     sponsors, assignments, roster, settings, audit log, ...)
//   * logins: auth.users and auth.identities (includes password HASHES, not
//     passwords, so a restore keeps everyone's sign-in working)
//   * each table's column list, so a restore can map rows back
// Not saved: Vault secrets, Edge Functions, the schema itself (that's in
// supabase/migrations). The app stores no files in Supabase Storage.
//
// THE FILE IS FULL OF REAL PII (names, addresses, children, emails). It is
// written OUTSIDE the repo by default so it can never be committed. Keep it
// on this computer or an encrypted drive; never email it, never put it in
// git, a shared folder, or a chat.
//
// Usage (from web/):
//   node scripts/backup-prod.mjs                       -> ~/Reach Christmas backups/
//   node scripts/backup-prod.mjs --out "D:\\Backups"   -> a folder you choose
//
// Needs web/.env.copy.local (git-ignored) with SUPABASE_ACCESS_TOKEN=sbp_...
// Prints table names and row counts only, never row contents.
//
// Every successful run appends a row (time, computer, counts, file name,
// checksum; no PII) to docs/BACKUP_LOG.md. Commit that change so the team
// can see when the latest backup was taken.
//
// Restoring is a separate, deliberate step (a write to prod): ask for the
// restore script and run it only with Grant's go-ahead.

import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir, hostname } from "node:os";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const PROD = "mpiueduyrmplrueviupl";
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");

function loadReadToken() {
  const path = resolve(here, "../.env.copy.local");
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`Missing ${path} (needs SUPABASE_ACCESS_TOKEN=sbp_...)`);
  }
  const line = text.split(/\r?\n/).find((l) => l.trim().startsWith("SUPABASE_ACCESS_TOKEN="));
  const m = line && line.trim().slice("SUPABASE_ACCESS_TOKEN=".length).match(/^["']?([^"']+)["']?$/);
  if (!m) throw new Error("SUPABASE_ACCESS_TOKEN not found in .env.copy.local");
  return m[1].trim();
}

const DEFAULT_DIR = resolve(homedir(), "Reach Christmas backups");
const LOG = resolve(repoRoot, "docs/BACKUP_LOG.md");

function outDir() {
  const i = process.argv.indexOf("--out");
  const dir = i > -1 && process.argv[i + 1] ? resolve(process.argv[i + 1]) : DEFAULT_DIR;
  const rel = relative(repoRoot, dir);
  if (!rel.startsWith("..") && !isAbsolute(rel)) {
    throw new Error(`Refusing to write a PII backup inside the repo (${dir}). Choose a folder outside it.`);
  }
  return dir;
}

function assertSingleSelect(sql) {
  const s = sql.trim().replace(/;\s*$/, "");
  if (!/^select\b/i.test(s) || s.includes(";")) throw new Error("REFUSED: prod queries must be one SELECT statement");
  return s;
}

async function prodRead(token, sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROD}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: assertSingleSelect(sql), read_only: true }),
  });
  const body = await res.text();
  // Status only on failure: an error body could echo data.
  if (!res.ok) throw new Error(`Prod read failed (HTTP ${res.status}).`);
  return body ? JSON.parse(body) : [];
}

const COLS_SQL = `
  select c.table_schema || '.' || c.table_name as tbl,
         string_agg(quote_ident(c.column_name), ',' order by c.ordinal_position)
           filter (where c.is_generated = 'NEVER') as cols
  from information_schema.columns c
  join pg_class k on k.relname = c.table_name
  join pg_namespace n on n.oid = k.relnamespace and n.nspname = c.table_schema
  where k.relkind = 'r'
    and (c.table_schema = 'public'
         or (c.table_schema = 'auth' and c.table_name in ('users', 'identities')))
  group by 1 order by 1`;

const snapshotSql = (tables) =>
  tables.map((t) => `select '${t}' as tbl, to_jsonb(t)::text as r from ${t} t`).join(" union all ");

async function main() {
  const token = loadReadToken();
  const dir = outDir();

  const colRows = await prodRead(token, COLS_SQL);
  const columns = Object.fromEntries(colRows.map((r) => [r.tbl, r.cols]));
  const tables = colRows.map((r) => r.tbl);
  if (!tables.includes("public.families") || !tables.includes("auth.users")) {
    throw new Error("Unexpected table list from prod; stopping without writing anything.");
  }

  const takenAt = new Date().toISOString();
  const rows = await prodRead(token, snapshotSql(tables));
  const counts = {};
  for (const x of rows) counts[x.tbl] = (counts[x.tbl] || 0) + 1;

  mkdirSync(dir, { recursive: true });
  const stamp = takenAt.replace(/[:.]/g, "-");
  const file = resolve(dir, `prod-backup-${stamp}.json`);
  const payload = JSON.stringify({ project: PROD, takenAt, columns, counts, rows });
  writeFileSync(file, payload, { flag: "wx" });

  // Read it back and check it parses and matches.
  const check = JSON.parse(readFileSync(file, "utf8"));
  if (check.rows.length !== rows.length) throw new Error("Backup file didn't read back correctly; don't rely on it.");
  const sha = createHash("sha256").update(payload).digest("hex");
  writeFileSync(`${file}.sha256`, `${sha}  prod-backup-${stamp}.json\n`, { flag: "wx" });

  // Log it (no PII: counts, file name, checksum).
  const name = `prod-backup-${stamp}.json`;
  // Forward slashes, and no "|" that would break the table.
  const keptIn = dir === DEFAULT_DIR ? "~/Reach Christmas backups" : dir.replace(/\\/g, "/").replace(/\|/g, "");
  const when = takenAt.slice(0, 16).replace("T", " ");
  const row =
    `| ${when} | ${hostname()} | ${rows.length} | ${counts["public.families"] || 0} | ${counts["public.children"] || 0} ` +
    `| \`${name}\` | \`${sha.slice(0, 16)}\` | ${keptIn} | |\n`;
  let logged = false;
  if (existsSync(LOG)) {
    const text = readFileSync(LOG, "utf8");
    appendFileSync(LOG, (text.endsWith("\n") ? "" : "\n") + row);
    logged = true;
  }

  console.log(`Prod backup taken at ${takenAt}`);
  console.log(`  ${"table".padEnd(36)}rows`);
  for (const t of tables) console.log(`  ${t.padEnd(36)}${counts[t] || 0}`);
  console.log(`\nTotal rows: ${rows.length}`);
  console.log(`Saved: ${file}`);
  console.log(`SHA-256: ${sha}`);
  console.log(
    logged
      ? `Logged in docs/BACKUP_LOG.md. Commit that change so the team can see it.`
      : `WARNING: ${LOG} not found, so this backup was NOT logged. Add it by hand.`,
  );
  console.log("This file holds real PII. Keep it private; never commit or share it.");
}

main().catch((e) => {
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
});
