// Copies ALL data from the prod Supabase project into the dev project.
//
//   PROD IS ONLY EVER READ. Every prod call goes through prodRead(), which
//   refuses anything but a single SELECT and sends it with read_only: true, so
//   Supabase runs it as its read-only database user. Nothing here can write to
//   prod, even by mistake.
//
//   DEV IS WIPED AND REPLACED: every table in `public`, plus logins
//   (auth.users / auth.identities). Dev's own data is saved to
//   supabase/.temp/dev-backup-<time>.json first (git-ignored).
//
// Kept as dev's own (not copied): app_settings.site_url and
// edge_functions_url, the Vault, Edge Functions, and the schema itself.
// The dev daily counselor digest is switched off, because after the copy dev
// holds real counselor addresses and must not email them.
//
// Usage (from web/):
//   node scripts/copy-prod-to-dev.mjs            dry run: reads both, changes nothing
//   node scripts/copy-prod-to-dev.mjs --go       does the copy
//
// Needs web/.env.copy.local (git-ignored) containing:
//   SUPABASE_ACCESS_TOKEN=sbp_...   read-only token: all reads; the only one prod ever sees
//   SUPABASE_WRITE_TOKEN=sbp_...    write token: only ever sent to dev
// (Supabase dashboard > Account > Access Tokens. Revoke it when done.)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROD = "mpiueduyrmplrueviupl";
const DEV = "thvyntrxmahygesltgft";
const GO = process.argv.includes("--go");
const here = dirname(fileURLToPath(import.meta.url));

function loadToken(name) {
  const path = resolve(here, "../.env.copy.local");
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`Missing ${path} (needs SUPABASE_ACCESS_TOKEN=sbp_...)`);
  }
  const line = text.split(/\r?\n/).find((l) => l.trim().startsWith(`${name}=`));
  const m = line && line.trim().slice(name.length + 1).match(/^["']?([^"']+)["']?$/);
  if (!m) throw new Error(`${name} not found in .env.copy.local (is the file saved?)`);
  return m[1].trim();
}
// Two tokens: the read token is the only one ever sent with a prod call.
let TOKEN, WRITE_TOKEN;
try {
  TOKEN = loadToken("SUPABASE_ACCESS_TOKEN");
  WRITE_TOKEN = loadToken("SUPABASE_WRITE_TOKEN");
} catch (e) {
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
}

async function api(ref, query, readOnly) {
  // Hard stop: a writable call may only ever go to dev.
  if (!readOnly && ref !== DEV) throw new Error("REFUSED: writable query aimed at a project that is not dev");
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${readOnly ? TOKEN : WRITE_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, read_only: readOnly }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Query failed on ${ref === PROD ? "PROD" : "DEV"} (${res.status}): ${body.slice(0, 600)}`);
  return body ? JSON.parse(body) : [];
}

function assertSingleSelect(sql) {
  const s = sql.trim().replace(/;\s*$/, "");
  if (!/^select\b/i.test(s) || s.includes(";")) throw new Error("REFUSED: prod queries must be one SELECT statement");
  return s;
}
const prodRead = (sql) => api(PROD, assertSingleSelect(sql), true);
const devRead = (sql) => api(DEV, assertSingleSelect(sql), true);
const devWrite = (sql) => api(DEV, sql, false);

const COLS_SQL = `
  select c.table_schema || '.' || c.table_name as tbl,
         string_agg(c.column_name || ':' || c.udt_name || ':' || c.is_generated, ',' order by c.column_name) as sig,
         string_agg(quote_ident(c.column_name), ',' order by c.ordinal_position)
           filter (where c.is_generated = 'NEVER') as cols
  from information_schema.columns c
  join pg_class k on k.relname = c.table_name
  join pg_namespace n on n.oid = k.relnamespace and n.nspname = c.table_schema
  where k.relkind = 'r'
    and (c.table_schema = 'public'
         or (c.table_schema = 'auth' and c.table_name in ('users', 'identities')))
  group by 1 order by 1`;

// One statement = one consistent snapshot. Rows come back as text so that no
// value is ever re-interpreted by JavaScript on the way through.
const snapshotSql = (tables) =>
  tables.map((t) => `select '${t}' as tbl, to_jsonb(t)::text as r from ${t} t`).join(" union all ");

const countBy = (rows) => rows.reduce((m, x) => ((m[x.tbl] = (m[x.tbl] || 0) + 1), m), {});

function table(title, tables, a, b, aName, bName) {
  console.log(`\n${title}`);
  console.log(`  ${"table".padEnd(36)}${aName.padStart(8)}${bName.padStart(8)}`);
  for (const t of tables) console.log(`  ${t.padEnd(36)}${String(a[t] || 0).padStart(8)}${String(b[t] || 0).padStart(8)}`);
}

async function main() {
  console.log(GO ? "MODE: COPY (dev will be replaced)" : "MODE: DRY RUN (nothing will be changed)");

  // 1. Structure must match exactly.
  const [prodCols, devCols] = await Promise.all([prodRead(COLS_SQL), devRead(COLS_SQL)]);
  const sig = (rows) => JSON.stringify(rows.map((r) => [r.tbl, r.sig]));
  if (sig(prodCols) !== sig(devCols)) {
    const d = new Map(devCols.map((r) => [r.tbl, r.sig]));
    const p = new Map(prodCols.map((r) => [r.tbl, r.sig]));
    const diff = [...new Set([...d.keys(), ...p.keys()])].filter((t) => d.get(t) !== p.get(t));
    throw new Error(`Prod and dev table structures differ, stopping. Tables: ${diff.join(", ")}`);
  }
  const cols = Object.fromEntries(devCols.map((r) => [r.tbl, r.cols]));
  const tables = devCols.map((r) => r.tbl);
  const publicTables = tables.filter((t) => t.startsWith("public."));
  console.log(`Structure matches: ${tables.length} tables.`);

  // 2. Read both (read-only on both sides).
  const [prodRows, devRows] = await Promise.all([prodRead(snapshotSql(tables)), devRead(snapshotSql(tables))]);
  const prodCount = countBy(prodRows);
  const devCount = countBy(devRows);
  table("Rows now", tables, prodCount, devCount, "prod", "dev");

  if (!GO) {
    console.log("\nDry run finished. Nothing was changed. Re-run with --go to copy.");
    return;
  }

  // 3. Back up dev locally before touching it.
  const backupDir = resolve(here, "../../supabase/.temp");
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = resolve(backupDir, `dev-backup-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify({ project: DEV, takenAt: new Date().toISOString(), columns: cols, rows: devRows }));
  console.log(`\nDev backup saved: ${backupPath} (${devRows.length} rows)`);

  // 4. Upload the prod snapshot into a staging table on dev.
  const tag = `$cp_${randomBytes(8).toString("hex")}$`;
  if (prodRows.some((x) => x.r.includes(tag))) throw new Error("Quote tag collision, just run again");
  await devWrite(`
    drop schema if exists copy_stage cascade;
    create schema copy_stage;
    revoke all on schema copy_stage from public;
    create table copy_stage.rows (tbl text not null, r jsonb not null);`);
  try {
    let batch = [];
    let size = 0;
    const flush = async () => {
      if (!batch.length) return;
      await devWrite(`insert into copy_stage.rows (tbl, r) values ${batch.join(",")};`);
      batch = [];
      size = 0;
    };
    for (const x of prodRows) {
      const v = `('${x.tbl}', ${tag}${x.r}${tag}::jsonb)`;
      if (size + v.length > 250_000) await flush();
      batch.push(v);
      size += v.length;
    }
    await flush();

    const staged = countBy(await devWrite("select tbl from copy_stage.rows"));
    for (const t of tables) {
      if ((staged[t] || 0) !== (prodCount[t] || 0)) throw new Error(`Staging mismatch on ${t}; dev data NOT touched.`);
    }
    console.log(`Staged ${prodRows.length} prod rows on dev. Swapping...`);

    // 5. The swap: one DO block = one transaction. Any error undoes all of it.
    const inserts = tables
      .map(
        (t) => `
      insert into ${t} (${cols[t]})
      select ${cols[t]} from jsonb_populate_recordset(null::${t},
        (select coalesce(jsonb_agg(r), '[]'::jsonb) from copy_stage.rows where tbl = '${t}'));`
      )
      .join("\n");
    await devWrite(`
      do $swap$
      declare
        v_site text;
        v_edge text;
      begin
        select site_url, edge_functions_url into v_site, v_edge from public.app_settings;

        -- Dev must not email the real counselors it is about to hold.
        perform cron.alter_job(jobid, active := false) from cron.job where jobname = 'counselor-review-digest';

        truncate ${publicTables.join(", ")};
        delete from auth.users;  -- cascades to sessions, identities, tokens

        -- Load rows exactly as they are: no audit rows, no auto-profiles, no
        -- updated_at bumps, and no ordering problems between linked tables.
        execute 'set local session_replication_role = replica';
        ${inserts}
        execute 'set local session_replication_role = origin';

        update public.app_settings set site_url = v_site, edge_functions_url = v_edge;
      end
      $swap$;`);
    console.log("Swap committed.");

    // 6. Verify dev now equals the staged prod snapshot, row for row.
    const verifySql = tables
      .map(
        (t) => `
      select '${t}' as tbl,
        (select count(*) from ${t})::int as n,
        (select coalesce(md5(string_agg(x, '' order by x)), '') from (select ${
          t === "public.app_settings" ? "(to_jsonb(t) - 'site_url' - 'edge_functions_url')" : "to_jsonb(t)"
        }::text as x from ${t} t) a) as live,
        (select coalesce(md5(string_agg(x, '' order by x)), '') from (select ${
          t === "public.app_settings" ? "(r - 'site_url' - 'edge_functions_url')" : "r"
        }::text as x from copy_stage.rows where tbl = '${t}') b) as staged`
      )
      .join(" union all ");
    const check = await devWrite(verifySql);
    const bad = check.filter((c) => c.live !== c.staged || c.n !== (prodCount[c.tbl] || 0));
    table("Rows after copy", tables, prodCount, Object.fromEntries(check.map((c) => [c.tbl, c.n])), "prod", "dev");
    if (bad.length) {
      console.log(`\nMISMATCH in: ${bad.map((b) => b.tbl).join(", ")}. Staging left in place (schema copy_stage) for inspection.`);
      process.exitCode = 1;
      return;
    }
    console.log("\nVerified: every dev table matches the prod snapshot exactly.");
  } catch (e) {
    console.log("\nFAILED. If the swap had not committed, dev data is unchanged. Staging schema copy_stage may remain on dev.");
    throw e;
  }
  await devWrite("drop schema if exists copy_stage cascade;");
  console.log("Staging removed. Done.");
}

main().catch((e) => {
  console.error(`\nERROR: ${e.message}`);
  process.exit(1);
});
