// A tiny in-memory stand-in for the Supabase REST + Auth endpoints, used to
// verify US-13's concurrent-edit behaviour end to end while the dev project's
// test accounts are stuck on "Email not confirmed".
//
// WHY THIS EXISTS / WHAT IT IS NOT: this proves the *client* half of the
// feature (store.tsx's pre-flight + guarded updates, the edit page's banner
// and input preservation) against faithful PostgREST semantics. It does NOT
// prove anything about the live database — real RLS, real triggers, and the
// real project's timestamptz rendering are separate questions. Findings from
// here are labelled "stub" in the QA report.
//
// Faithful details that matter for US-13:
//   * timestamptz is rendered the way Postgres's to_json does it:
//     `2026-08-11T04:12:33.123456+00:00`, with trailing zeros in the fraction
//     stripped and the fraction omitted entirely when it is zero. If the
//     client ever round-trips that string through Date, the eq filter stops
//     matching — which is exactly the failure mode we are hunting.
//   * a PATCH that matches zero rows answers `[]` (200) when the caller asked
//     for `Prefer: return=representation`, and 204 with no body otherwise.
//     That is the behaviour store.tsx's `.select()` relies on.
//   * `updated_at` is bumped on every UPDATE of drives/families/children, the
//     way the set_updated_at BEFORE UPDATE trigger does.
//
// No real family/sponsor data is ever loaded here — see seed.mjs.
import http from "node:http";

const PORT = Number(process.env.STUB_PORT ?? 54999);

/** @type {{tables: Record<string, any[]>, viewer: {id: string, email: string, role: string, canViewConfidential: boolean}}} */
let db = { tables: {}, viewer: null };
/** Every REST request, so a test can assert on the exact query string sent. */
let requestLog = [];

// --- Postgres-flavoured timestamps -----------------------------------------

let lastMicros = 0n;
/** Microsecond-resolution "now()", rendered exactly like Postgres's to_json. */
function nowPg() {
  let micros = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
  if (micros <= lastMicros) micros = lastMicros + 1n; // strictly increasing, like a real clock across two UPDATEs
  lastMicros = micros;
  return renderPg(micros);
}

export function renderPg(micros) {
  const ms = Number(micros / 1000n);
  const frac = String(Number(micros % 1000000n)).padStart(6, "0");
  const base = new Date(ms).toISOString().slice(0, 19); // YYYY-MM-DDTHH:MM:SS
  const trimmed = frac.replace(/0+$/, "");
  return `${base}${trimmed ? "." + trimmed : ""}+00:00`;
}

const VERSIONED_TABLES = new Set(["drives", "families", "children"]);

// --- PostgREST query emulation ----------------------------------------------

function parseFilters(params) {
  const filters = [];
  for (const [key, raw] of params.entries()) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(key)) continue;
    const m = /^(eq|neq|like|ilike|is|in|gt|lt|gte|lte)\.(.*)$/s.exec(raw);
    if (!m) continue;
    filters.push({ column: key, op: m[1], value: m[2] });
  }
  return filters;
}

function matches(row, filters) {
  return filters.every((f) => {
    const actual = row[f.column];
    switch (f.op) {
      // Deliberately a strict string comparison — this is the check that
      // catches a lossy `updated_at` round-trip on the client.
      case "eq":
        return String(actual) === f.value;
      case "neq":
        return String(actual) !== f.value;
      case "is":
        return f.value === "null" ? actual === null || actual === undefined : String(actual) === f.value;
      case "like":
      case "ilike": {
        const re = new RegExp("^" + f.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", f.op === "ilike" ? "i" : "");
        return re.test(String(actual ?? ""));
      }
      case "in":
        return f.value.replace(/^\(|\)$/g, "").split(",").includes(String(actual));
      default:
        return true;
    }
  });
}

function project(rows, select) {
  if (!select || select === "*") return rows.map((r) => ({ ...r }));
  const cols = select.split(",").map((c) => c.trim()).filter((c) => c && c !== "*");
  if (cols.length === 0) return rows.map((r) => ({ ...r }));
  return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
}

/** Mirrors the confidentiality RLS floor: rows a viewer must not see at all. */
function visible(table, rows) {
  const v = db.viewer;
  if (!v || v.role === "admin" || v.canViewConfidential) return rows;
  if (table === "families") return rows.filter((r) => !r.is_confidential || r.created_by === v.id);
  if (table === "children" || table === "wishlist_items" || table === "cards") {
    const key = table === "children" ? "family_id" : "child_id";
    const hiddenFamilies = new Set(
      (db.tables.families ?? []).filter((f) => f.is_confidential && f.created_by !== v.id).map((f) => f.id)
    );
    if (table === "children") return rows.filter((r) => !hiddenFamilies.has(r[key]));
    const hiddenChildren = new Set((db.tables.children ?? []).filter((c) => hiddenFamilies.has(c.family_id)).map((c) => c.id));
    if (table === "wishlist_items") return rows.filter((r) => !hiddenChildren.has(r.child_id));
    return rows.filter((r) => !hiddenChildren.has(r.child_id));
  }
  return rows;
}

function send(res, status, body, extraHeaders = {}) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-expose-headers": "*",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    ...extraHeaders,
  });
  res.end(payload);
}

function singleError(count) {
  return {
    code: "PGRST116",
    details: `The result contains ${count} rows`,
    hint: null,
    message: "JSON object requested, multiple (or no) rows returned",
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

// --- Fake auth ---------------------------------------------------------------

function fakeJwt(user) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  return [
    b64({ alg: "HS256", typ: "JWT" }),
    b64({ sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", exp: now + 3600, iat: now, iss: "stub" }),
    "stub-signature",
  ].join(".");
}

function sessionFor(user) {
  return {
    access_token: fakeJwt(user),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "stub-refresh-token",
    user,
  };
}

function authUser() {
  const v = db.viewer;
  return {
    id: v.id,
    aud: "authenticated",
    role: "authenticated",
    email: v.email,
    email_confirmed_at: "2026-01-01T00:00:00+00:00",
    phone: "",
    confirmed_at: "2026-01-01T00:00:00+00:00",
    last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { full_name: v.email },
    identities: [],
    created_at: "2026-01-01T00:00:00+00:00",
    updated_at: "2026-01-01T00:00:00+00:00",
    is_anonymous: false,
  };
}

// --- Server ------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const { pathname, searchParams } = url;

  if (req.method === "OPTIONS") return send(res, 204, undefined);

  // ---- control plane (tests only) ----
  if (pathname === "/__control/health") return send(res, 200, { ok: true });
  if (pathname === "/__control/reset") {
    const body = await readBody(req);
    db = { tables: structuredClone(body.tables), viewer: body.viewer };
    requestLog = [];
    return send(res, 200, { ok: true });
  }
  if (pathname === "/__control/db") return send(res, 200, db.tables);
  if (pathname === "/__control/requests") return send(res, 200, requestLog);
  if (pathname === "/__control/viewer") {
    db.viewer = { ...db.viewer, ...(await readBody(req)) };
    return send(res, 200, db.viewer);
  }
  // Simulates the *other* volunteer saving: an out-of-band UPDATE that fires
  // the same updated_at trigger a real save would.
  if (pathname === "/__control/update") {
    const { table, id, patch } = await readBody(req);
    const row = (db.tables[table] ?? []).find((r) => r.id === id);
    if (!row) return send(res, 404, { error: "no such row" });
    Object.assign(row, patch);
    if (VERSIONED_TABLES.has(table)) row.updated_at = nowPg();
    return send(res, 200, row);
  }

  // ---- auth ----
  if (pathname.startsWith("/auth/v1/")) {
    if (pathname === "/auth/v1/token") {
      await readBody(req);
      return send(res, 200, sessionFor(authUser()));
    }
    if (pathname === "/auth/v1/user") return send(res, 200, authUser());
    if (pathname === "/auth/v1/logout") return send(res, 204, undefined);
    if (pathname === "/auth/v1/settings") return send(res, 200, { external: { email: true }, disable_signup: true, mailer_autoconfirm: true });
    return send(res, 200, {});
  }

  // ---- rest ----
  if (!pathname.startsWith("/rest/v1/")) return send(res, 404, { message: "not found" });

  const table = pathname.slice("/rest/v1/".length);
  requestLog.push({ method: req.method, table, query: url.search, prefer: req.headers.prefer ?? null });

  if (!db.tables[table]) db.tables[table] = [];

  const filters = parseFilters(searchParams);
  const select = searchParams.get("select");
  const wantsObject = String(req.headers.accept ?? "").includes("application/vnd.pgrst.object+json");
  const wantsRepresentation = String(req.headers.prefer ?? "").includes("return=representation");

  const respond = (rows, status = 200) => {
    if (wantsObject) {
      if (rows.length !== 1) return send(res, 406, singleError(rows.length));
      return send(res, status, rows[0]);
    }
    return send(res, status, rows);
  };

  if (req.method === "GET") {
    let rows = visible(table, db.tables[table]).filter((r) => matches(r, filters));
    const order = searchParams.get("order");
    if (order) {
      const [col, dir] = order.split(".");
      rows = [...rows].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === "desc" ? -1 : 1));
    }
    const limit = searchParams.get("limit");
    if (limit) rows = rows.slice(0, Number(limit));
    return respond(project(rows, select));
  }

  if (req.method === "PATCH") {
    const body = await readBody(req);
    // Only rows this viewer may see are updatable — same shape as the RLS
    // USING clause, and the reason a hidden row looks like "zero rows matched"
    // rather than an error.
    const targets = visible(table, db.tables[table]).filter((r) => matches(r, filters));
    for (const row of targets) {
      Object.assign(row, body);
      if (VERSIONED_TABLES.has(table)) row.updated_at = nowPg();
    }
    if (!wantsRepresentation) return send(res, 204, undefined);
    return respond(project(targets, select));
  }

  if (req.method === "POST") {
    const body = await readBody(req);
    const rows = Array.isArray(body) ? body : [body];
    const inserted = rows.map((r) => {
      const row = { id: crypto.randomUUID(), created_at: nowPg(), ...r };
      if (VERSIONED_TABLES.has(table) && !row.updated_at) row.updated_at = nowPg();
      db.tables[table].push(row);
      return row;
    });
    if (!wantsRepresentation) return send(res, 201, undefined);
    return respond(project(inserted, select), 201);
  }

  if (req.method === "DELETE") {
    const keep = [];
    const removed = [];
    for (const row of db.tables[table]) (matches(row, filters) ? removed : keep).push(row);
    db.tables[table] = keep;
    if (!wantsRepresentation) return send(res, 204, undefined);
    return respond(project(removed, select));
  }

  return send(res, 405, { message: "method not allowed" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[stub] supabase stand-in listening on http://127.0.0.1:${PORT}`);
});
