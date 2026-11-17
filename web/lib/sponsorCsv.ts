// US-76: read a sponsor CSV (the Church Center export, or the older
// name,email,phone,capacity shape) and work out what an import would do to
// the current roster: who is new, who is already there, what changed, what
// needs a person to look at it.
//
// Pure functions only, no Supabase and no React, so the whole plan can be
// previewed (and tested) before anything is written. The write itself is
// apply_sponsor_import() via lib/sponsorImport.ts.
//
// Never reads or keeps a sponsor's address, even though the Church Center
// export includes it.

export type CsvFormat = "church_center" | "simple";

/** One sponsor row read out of the CSV, before matching against the roster. */
export interface SponsorCsvRow {
  /** 1-based line number in the file (header is line 1). */
  lineNumber: number;
  /** Church Center "Registration ID"; null in the simple format. */
  registrationId: string | null;
  displayName: string;
  /** Every email on the row, de-duplicated, original casing. First one is the contact email. */
  emails: string[];
  contactPhone: string | null;
  /** How many children they want to shop for; null if blank or not a whole number. */
  capacity: number | null;
  /** The raw count cell, so a bad value can be shown back. */
  capacityRaw: string;
  /** Church Center "Status" (e.g. "Active"); null in the simple format. */
  status: string | null;
  /** Church Center "Submitted" time as ISO, read as this browser's local time. */
  signedUpAt: string | null;
}

export interface ParsedSponsorCsv {
  format: CsvFormat;
  rows: SponsorCsvRow[];
}

/** Minimal RFC4180-ish CSV parser: quoted fields, doubled-quote escaping, CRLF or LF. */
export function parseCsvTable(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip a UTF-8 BOM

  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
    i += 1;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

/** Split a cell that may hold several addresses ("a@x.com;b@y.com"). */
export function splitEmails(...cells: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const cell of cells) {
    for (const part of cell.split(/[;,\s]+/)) {
      const email = part.trim();
      if (!email.includes("@")) continue;
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(email);
    }
  }
  return out;
}

/** "11/14/2026 at 5:00pm" -> ISO string (browser local time), or null. */
export function parseChurchCenterSubmitted(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+at)?\s+(\d{1,2}):(\d{2})\s*([ap]m)?$/i);
  if (!m) return null;
  const [, mo, d, y, h, min, ampm] = m;
  let hour = Number(h);
  if (ampm) {
    const pm = ampm.toLowerCase() === "pm";
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
  }
  const date = new Date(Number(y), Number(mo) - 1, Number(d), hour, Number(min));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseCount(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 && String(n) === raw ? n : null;
}

const CC = {
  registrationId: "registration id",
  firstName: "registration contact first name",
  lastName: "registration contact last name",
  phone: "registration contact phone number",
  homeEmail: "registration contact home email address",
  workEmail: "registration contact work email address",
  otherEmail: "registration contact other email address",
  count: "count",
  status: "status",
  submitted: "submitted",
} as const;

export function parseSponsorCsv(text: string): { ok: true; parsed: ParsedSponsorCsv } | { ok: false; error: string } {
  const table = parseCsvTable(text);
  if (table.length === 0) return { ok: false, error: "That doesn't look like a CSV. Nothing to import." };

  const header = table[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const cell = (cells: string[], idx: number) => (idx >= 0 ? (cells[idx] ?? "").trim() : "");

  // Church Center export ------------------------------------------------------
  if (col(CC.registrationId) >= 0 && col(CC.firstName) >= 0) {
    const idx = Object.fromEntries(Object.entries(CC).map(([k, v]) => [k, col(v)])) as Record<keyof typeof CC, number>;
    const rows = table.slice(1).map((cells, i): SponsorCsvRow => {
      const capacityRaw = cell(cells, idx.count);
      return {
        lineNumber: i + 2,
        registrationId: cell(cells, idx.registrationId) || null,
        displayName: [cell(cells, idx.firstName), cell(cells, idx.lastName)].filter(Boolean).join(" "),
        emails: splitEmails(cell(cells, idx.homeEmail), cell(cells, idx.workEmail), cell(cells, idx.otherEmail)),
        contactPhone: cell(cells, idx.phone) || null,
        capacity: parseCount(capacityRaw),
        capacityRaw,
        status: cell(cells, idx.status) || null,
        signedUpAt: parseChurchCenterSubmitted(cell(cells, idx.submitted)),
      };
    });
    return { ok: true, parsed: { format: "church_center", rows } };
  }

  // Simple name,email,phone,capacity -----------------------------------------
  const nameIdx = col("name");
  if (nameIdx === -1) {
    return {
      ok: false,
      error:
        "This file isn't a Church Center registration export, and it has no \"name\" column either. " +
        "Export the registrations list from Church Center, or use the columns name, email, phone, capacity.",
    };
  }
  const emailIdx = col("email");
  const phoneIdx = col("phone");
  const capacityIdx = col("capacity");
  const rows = table.slice(1).map((cells, i): SponsorCsvRow => {
    const capacityRaw = cell(cells, capacityIdx);
    return {
      lineNumber: i + 2,
      registrationId: null,
      displayName: cell(cells, nameIdx),
      emails: splitEmails(cell(cells, emailIdx)),
      contactPhone: cell(cells, phoneIdx) || null,
      capacity: parseCount(capacityRaw),
      capacityRaw,
      status: null,
      signedUpAt: null,
    };
  });
  return { ok: true, parsed: { format: "simple", rows } };
}

// =============================================================================
// Matching against the roster
// =============================================================================

/**
 * What Church Center said about a person at the last import. A re-import only
 * proposes a change when Church Center's value moved since then, so a fix
 * staff made by hand on the roster (merged a double registration, corrected
 * an email) isn't undone by every import.
 */
export interface ChurchCenterSnapshot {
  name: string;
  /** Lowercased, sorted. */
  emails: string[];
  /** Digits only. */
  phone: string;
  count: number | null;
}

export function snapshotOf(row: SponsorCsvRow): ChurchCenterSnapshot {
  return {
    name: row.displayName.trim(),
    emails: row.emails.map((e) => e.toLowerCase()).sort(),
    phone: (row.contactPhone ?? "").replace(/\D/g, ""),
    count: row.capacity,
  };
}

/** The roster entry fields the plan needs (from getSponsorFamilies). */
export interface RosterSnapshot {
  id: string;
  displayName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  capacity: number | null;
  isActive: boolean;
  assignedCount: number;
  churchCenterRegistrationId: string | null;
  signedUpAt: string | null;
  churchCenterSnapshot: ChurchCenterSnapshot | null;
}

export interface FieldChange {
  label: string;
  from: string;
  to: string;
}

export interface PlannedNew {
  row: SponsorCsvRow;
  /** Extra emails beyond the first, written into the new entry's Notes. */
  notes: string | null;
}

/** Only the columns to change; an absent key leaves that column alone. */
export interface UpdatePatch {
  display_name?: string;
  contact_email?: string | null;
  contact_phone?: string | null;
  capacity?: number;
  church_center_registration_id?: string;
  signed_up_at?: string;
}

export interface PlannedUpdate {
  row: SponsorCsvRow;
  entry: RosterSnapshot;
  changes: FieldChange[];
  patch: UpdatePatch;
  /** Church Center's values now; saved whether or not staff apply the change. */
  snapshot: ChurchCenterSnapshot | null;
}

/** Bookkeeping only (new snapshot, first sign-up time): never shown, never counted as a change. */
export interface PlannedSilentWrite {
  entryId: string;
  signedUpAt?: string;
  snapshot: ChurchCenterSnapshot | null;
}

export interface PlannedDuplicate {
  row: SponsorCsvRow;
  reason: string;
  notes: string | null;
}

export type FlagKind = "cancelled" | "missing" | "capacity_kept";

export interface PlannedFlag {
  kind: FlagKind;
  entry: RosterSnapshot;
  message: string;
}

export interface PlannedSkip {
  row: SponsorCsvRow;
  reason: string;
}

export interface ImportPlan {
  format: CsvFormat;
  newRows: PlannedNew[];
  updates: PlannedUpdate[];
  unchanged: { row: SponsorCsvRow; entry: RosterSnapshot }[];
  duplicates: PlannedDuplicate[];
  flagged: PlannedFlag[];
  skipped: PlannedSkip[];
  silent: PlannedSilentWrite[];
}

const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function extraEmailNote(emails: string[]): string | null {
  return emails.length > 1 ? `Other email: ${emails.slice(1).join(", ")}` : null;
}

export function planSponsorImport(parsed: ParsedSponsorCsv, roster: RosterSnapshot[]): ImportPlan {
  const plan: ImportPlan = {
    format: parsed.format,
    newRows: [],
    updates: [],
    unchanged: [],
    duplicates: [],
    flagged: [],
    skipped: [],
    silent: [],
  };

  const byRegistration = new Map<string, RosterSnapshot>();
  const byEmail = new Map<string, RosterSnapshot[]>();
  for (const entry of roster) {
    if (entry.churchCenterRegistrationId) byRegistration.set(entry.churchCenterRegistrationId, entry);
    const key = lower(entry.contactEmail);
    if (key) byEmail.set(key, [...(byEmail.get(key) ?? []), entry]);
  }

  const seenRegistrations = new Set<string>();
  /** Email (lowercase) -> name, for every row accepted so far in this file. */
  const seenEmails = new Map<string, string>();
  const matched = new Set<string>();
  const remember = (row: SponsorCsvRow) => {
    for (const e of row.emails) if (!seenEmails.has(lower(e))) seenEmails.set(lower(e), row.displayName);
  };

  for (const row of parsed.rows) {
    if (!row.displayName) {
      plan.skipped.push({ row, reason: "No name" });
      continue;
    }
    if (row.registrationId) {
      if (seenRegistrations.has(row.registrationId)) {
        plan.skipped.push({ row, reason: "Same Registration ID appears earlier in this file" });
        continue;
      }
      seenRegistrations.add(row.registrationId);
    }

    // 1. Exact match on Registration ID.
    let entry = row.registrationId ? byRegistration.get(row.registrationId) : undefined;
    if (entry && matched.has(entry.id)) entry = undefined;
    let sameEmailElsewhere: RosterSnapshot | undefined;

    // 2. Email match: links a hand-added entry (no Registration ID yet), or
    //    in the simple format is simply the same person.
    if (!entry) {
      const candidates = [
        ...new Set(row.emails.flatMap((e) => byEmail.get(lower(e)) ?? [])),
      ].filter((c) => !matched.has(c.id));
      const linkable = candidates.find((c) => !c.churchCenterRegistrationId);
      if (linkable) entry = linkable;
      else if (!row.registrationId && candidates.length > 0) entry = candidates[0];
      else if (candidates.length > 0) sameEmailElsewhere = candidates[0];
    }

    // 3. Simple format, no email: same name and phone.
    if (!entry && !row.registrationId && row.emails.length === 0 && digits(row.contactPhone)) {
      entry = roster.find(
        (c) =>
          !matched.has(c.id) &&
          lower(c.displayName) === lower(row.displayName) &&
          digits(c.contactPhone) === digits(row.contactPhone),
      );
    }

    const notActive = row.status != null && lower(row.status) !== "active";

    if (entry) {
      matched.add(entry.id);
      remember(row);
      if (notActive) {
        plan.flagged.push({
          kind: "cancelled",
          entry,
          message: `Status in Church Center is "${row.status}".${
            entry.assignedCount > 0 ? ` Has ${plural(entry.assignedCount, "child", "children")} assigned.` : ""
          }`,
        });
        continue;
      }
      planExisting(plan, row, entry, parsed.format);
      continue;
    }

    if (notActive) {
      plan.skipped.push({ row, reason: `Not active in Church Center (status "${row.status}")` });
      continue;
    }

    const earlier = row.emails.map((e) => seenEmails.get(lower(e))).find(Boolean);
    if (sameEmailElsewhere) {
      plan.duplicates.push({
        row,
        reason: `Same email as ${sameEmailElsewhere.displayName}, already on the roster under a different registration`,
        notes: extraEmailNote(row.emails),
      });
    } else if (earlier) {
      plan.duplicates.push({
        row,
        reason: `Same email as ${earlier}, earlier in this file`,
        notes: extraEmailNote(row.emails),
      });
    } else {
      plan.newRows.push({ row, notes: extraEmailNote(row.emails) });
    }
    remember(row);
  }

  // Church Center entries on the roster that this file doesn't mention.
  if (parsed.format === "church_center") {
    for (const entry of roster) {
      if (entry.churchCenterRegistrationId && entry.isActive && !matched.has(entry.id)) {
        plan.flagged.push({
          kind: "missing",
          entry,
          message: `Not in this file.${
            entry.assignedCount > 0 ? ` Has ${plural(entry.assignedCount, "child", "children")} assigned.` : ""
          }`,
        });
      }
    }
  }

  return plan;
}

function planExisting(plan: ImportPlan, row: SponsorCsvRow, entry: RosterSnapshot, format: CsvFormat) {
  const changes: FieldChange[] = [];
  const patch: UpdatePatch = {};

  // A field is only worth proposing when Church Center itself changed it
  // since the last import. With no previous snapshot (first time this entry
  // meets a Church Center file, or a simple-format file) every difference
  // from the roster is proposed.
  const previous = format === "church_center" ? entry.churchCenterSnapshot : null;
  const current = format === "church_center" ? snapshotOf(row) : null;
  const moved = <K extends keyof ChurchCenterSnapshot>(field: K) =>
    !previous || !current || JSON.stringify(previous[field]) !== JSON.stringify(current[field]);

  const displayName = row.displayName.trim();
  if (moved("name") && displayName !== entry.displayName.trim()) {
    changes.push({ label: "Name", from: entry.displayName, to: displayName });
    patch.display_name = displayName;
  }

  // Keep the roster's email if it's any of the row's addresses (staff may
  // have picked the second one on purpose); never blank an email out.
  if (moved("emails")) {
    const rowHasEntryEmail = row.emails.some((e) => lower(e) === lower(entry.contactEmail));
    const contactEmail = rowHasEntryEmail ? entry.contactEmail : row.emails[0] ?? entry.contactEmail;
    if (lower(contactEmail) !== lower(entry.contactEmail)) {
      changes.push({ label: "Email", from: entry.contactEmail ?? "none", to: contactEmail ?? "none" });
      patch.contact_email = contactEmail;
    }
  }

  if (moved("phone") && row.contactPhone && digits(row.contactPhone) !== digits(entry.contactPhone)) {
    changes.push({ label: "Phone", from: entry.contactPhone ?? "none", to: row.contactPhone });
    patch.contact_phone = row.contactPhone;
  }

  // Capacity: follow Church Center, but never below what's already assigned.
  if (row.capacity != null && moved("count")) {
    const target = Math.max(row.capacity, entry.assignedCount);
    if (row.capacity < entry.assignedCount) {
      plan.flagged.push({
        kind: "capacity_kept",
        entry,
        message: `Church Center now says ${row.capacity}, but ${plural(
          entry.assignedCount,
          "child is",
          "children are",
        )} already assigned. The limit stays at ${target}; reassign by hand if they can't take them all.`,
      });
    }
    if (target !== entry.capacity) {
      changes.push({ label: "Children", from: entry.capacity == null ? "no limit" : String(entry.capacity), to: String(target) });
      patch.capacity = target;
    }
  }

  if (row.registrationId && !entry.churchCenterRegistrationId) {
    changes.push({ label: "Church Center", from: "not linked", to: "linked" });
    patch.church_center_registration_id = row.registrationId;
  }

  const fillSignUp = row.signedUpAt && !entry.signedUpAt ? row.signedUpAt : undefined;
  if (fillSignUp) patch.signed_up_at = fillSignUp;
  const snapshotMoved = !!current && JSON.stringify(current) !== JSON.stringify(previous);

  if (changes.length === 0) {
    plan.unchanged.push({ row, entry });
    if (fillSignUp || snapshotMoved) {
      plan.silent.push({ entryId: entry.id, signedUpAt: fillSignUp, snapshot: snapshotMoved ? current : null });
    }
    return;
  }
  plan.updates.push({ row, entry, changes, patch, snapshot: current });
}

// =============================================================================
// What gets sent to apply_sponsor_import()
// =============================================================================

export interface ImportSelection {
  /** Line numbers of new rows to add (default: all). */
  newLines: Set<number>;
  /** Line numbers of updates to apply (default: all). */
  updateLines: Set<number>;
  /** Line numbers of possible duplicates to add anyway (default: none). */
  duplicateLines: Set<number>;
}

export function defaultSelection(plan: ImportPlan): ImportSelection {
  return {
    newLines: new Set(plan.newRows.map((n) => n.row.lineNumber)),
    updateLines: new Set(plan.updates.map((u) => u.row.lineNumber)),
    duplicateLines: new Set(),
  };
}

export interface ImportPayload {
  p_new: {
    display_name: string;
    contact_email: string | null;
    contact_phone: string | null;
    capacity: number | null;
    notes: string | null;
    church_center_registration_id: string | null;
    signed_up_at: string | null;
    church_center_snapshot: ChurchCenterSnapshot | null;
  }[];
  /** Each item carries only the keys to change (see apply_sponsor_import). */
  p_updates: ({ id: string; church_center_snapshot?: ChurchCenterSnapshot } & UpdatePatch)[];
  p_counts: { unchanged: number; skipped: number; flagged: number };
}

export function buildImportPayload(plan: ImportPlan, sel: ImportSelection): ImportPayload {
  const toNew = ({ row, notes }: { row: SponsorCsvRow; notes: string | null }) => ({
    display_name: row.displayName,
    contact_email: row.emails[0] ?? null,
    contact_phone: row.contactPhone,
    capacity: row.capacity,
    notes,
    church_center_registration_id: row.registrationId,
    signed_up_at: row.signedUpAt,
    church_center_snapshot: plan.format === "church_center" ? snapshotOf(row) : null,
  });

  const newRows = plan.newRows.filter((n) => sel.newLines.has(n.row.lineNumber));
  const dupRows = plan.duplicates.filter((d) => sel.duplicateLines.has(d.row.lineNumber));
  const updates = plan.updates.filter((u) => sel.updateLines.has(u.row.lineNumber));
  const declined = plan.updates.filter((u) => !sel.updateLines.has(u.row.lineNumber));

  const p_updates: ImportPayload["p_updates"] = [
    // Applied: the changed fields plus Church Center's current values.
    ...updates.map((u) => ({
      id: u.entry.id,
      ...u.patch,
      ...(u.snapshot ? { church_center_snapshot: u.snapshot } : {}),
    })),
    // Unticked: record that staff saw Church Center's values and kept the
    // roster's, so the same change isn't proposed again next import.
    ...declined
      .filter((u) => u.snapshot || u.patch.signed_up_at)
      .map((u) => ({
        id: u.entry.id,
        ...(u.patch.signed_up_at ? { signed_up_at: u.patch.signed_up_at } : {}),
        ...(u.snapshot ? { church_center_snapshot: u.snapshot } : {}),
      })),
    ...plan.silent.map((s) => ({
      id: s.entryId,
      ...(s.signedUpAt ? { signed_up_at: s.signedUpAt } : {}),
      ...(s.snapshot ? { church_center_snapshot: s.snapshot } : {}),
    })),
  ];

  return {
    p_new: [...newRows, ...dupRows].map(toNew),
    p_updates,
    p_counts: {
      unchanged: plan.unchanged.length + declined.length,
      skipped:
        plan.skipped.length + (plan.newRows.length - newRows.length) + (plan.duplicates.length - dupRows.length),
      flagged: plan.flagged.length,
    },
  };
}
