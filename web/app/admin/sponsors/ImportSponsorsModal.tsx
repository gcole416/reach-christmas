"use client";

import { useState, type ChangeEvent } from "react";
import { useData } from "@/lib/store";

// US-56: the Church Center roster CSV import. `bulkImportSponsorFamilies` is
// ONE insert for the whole batch (all-or-nothing — see its doc comment in
// lib/store.tsx), so this modal's whole job is to let staff see exactly what
// will be created before that single call fires, and to let them fix and
// retry the same parsed file without re-uploading if it fails.

/** One row split out of the pasted/uploaded CSV text, before any network call. */
interface ParsedSponsorRow {
  /** 1-based, counting the header row as line 1 — for messages, not rendered as a column. */
  lineNumber: number;
  displayName: string;
  contactEmail?: string;
  contactPhone?: string;
  capacity?: number;
  /** The raw capacity cell, kept so a non-numeric value can be shown back rather than silently dropped. */
  capacityRaw: string;
  /** Set when this row won't be imported (currently only: no name). */
  skipReason: string | null;
}

/** Minimal RFC4180-ish CSV parser: quoted fields, doubled-quote escaping, CRLF or LF. No external dependency for one admin-only import form. */
function parseCsvTable(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
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
      i += 1;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
    } else if (ch === "\r") {
      i += 1;
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully-blank lines (e.g. trailing newline).
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

function parseSponsorCsv(text: string): { rows: ParsedSponsorRow[]; error: string | null } {
  const table = parseCsvTable(text);
  if (table.length === 0) {
    return { rows: [], error: "That doesn't look like a CSV — nothing to import." };
  }

  const header = table[0].map((h) => h.trim().toLowerCase());
  const nameIdx = header.indexOf("name");
  if (nameIdx === -1) {
    return {
      rows: [],
      error: 'The first row needs a header with a "name" column, e.g. name,email,phone,capacity.',
    };
  }
  const emailIdx = header.indexOf("email");
  const phoneIdx = header.indexOf("phone");
  const capacityIdx = header.indexOf("capacity");

  const rows: ParsedSponsorRow[] = table.slice(1).map((cells, idx) => {
    const displayName = (cells[nameIdx] ?? "").trim();
    const contactEmail = emailIdx >= 0 ? (cells[emailIdx] ?? "").trim() : "";
    const contactPhone = phoneIdx >= 0 ? (cells[phoneIdx] ?? "").trim() : "";
    const capacityRaw = capacityIdx >= 0 ? (cells[capacityIdx] ?? "").trim() : "";
    const capacityNum = capacityRaw ? Number.parseInt(capacityRaw, 10) : NaN;
    const capacity =
      Number.isFinite(capacityNum) && capacityNum >= 0 && String(capacityNum) === capacityRaw
        ? capacityNum
        : undefined;
    return {
      lineNumber: idx + 2,
      displayName,
      contactEmail: contactEmail || undefined,
      contactPhone: contactPhone || undefined,
      capacity,
      capacityRaw,
      skipReason: displayName ? null : "No name — will be skipped",
    };
  });

  return { rows, error: null };
}

type Step = "upload" | "preview" | "success";

export function ImportSponsorsModal({ onClose }: { onClose: () => void }) {
  const { bulkImportSponsorFamilies } = useData();
  const [step, setStep] = useState<Step>("upload");
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedSponsorRow[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [createdCount, setCreatedCount] = useState(0);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  function handlePreview() {
    setSubmitError(null);
    const { rows: parsed, error } = parseSponsorCsv(csvText);
    if (error) {
      setParseError(error);
      return;
    }
    setParseError(null);
    setRows(parsed);
    setStep("preview");
  }

  const importRows = rows.filter((r) => !r.skipReason);
  const skippedRows = rows.filter((r) => r.skipReason);

  async function handleConfirm() {
    setSubmitting(true);
    setSubmitError(null);
    const result = await bulkImportSponsorFamilies(
      importRows.map(({ displayName, contactEmail, contactPhone, capacity }) => ({
        displayName,
        contactEmail,
        contactPhone,
        capacity,
      })),
    );
    setSubmitting(false);
    if (!result.ok) {
      // Nothing was created (the whole insert is one statement) — stay on
      // the preview step with the same parsed rows so staff can fix the CSV
      // text above and re-preview/re-confirm without re-uploading the file.
      setSubmitError(result.error);
      return;
    }
    setCreatedCount(result.created);
    setStep("success");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-ink-primary">Import sponsors from a CSV</h2>

        {step === "upload" ? (
          <>
            <p className="mt-1 text-sm text-ink-secondary">
              Columns: <code className="rounded bg-ink-muted/10 px-1 py-0.5 text-xs">name, email, phone, capacity</code>.
              Reshape whatever Church Center exports to this first — email, phone, and capacity are all
              optional, but the header row with a name column is required.
            </p>
            <div className="mt-4 space-y-4">
              <label className="block text-sm">
                <span className="text-ink-secondary">CSV file</span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileChange}
                  className="mt-1 block w-full text-sm text-ink-secondary"
                />
              </label>
              {fileName ? <p className="text-xs text-ink-muted">Loaded {fileName} below — edit it if needed.</p> : null}
              <label className="block text-sm">
                <span className="text-ink-secondary">CSV contents (paste or edit here)</span>
                <textarea
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  rows={8}
                  placeholder={"name,email,phone,capacity\nJane Smith,jane@example.com,555-0100,2"}
                  className="mt-1 w-full rounded-lg border border-border bg-surface p-2 font-mono text-xs text-ink-primary placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-cat-blue"
                />
              </label>
              {parseError ? (
                <div className="rounded-lg bg-status-critical/10 px-3 py-2 text-sm text-ink-primary">{parseError}</div>
              ) : null}
            </div>
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm font-medium text-ink-secondary hover:bg-ink-muted/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePreview}
                disabled={!csvText.trim()}
                className="rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                Preview import
              </button>
            </div>
          </>
        ) : null}

        {step === "preview" ? (
          <>
            <p className="mt-1 text-sm text-ink-secondary">
              Nothing is saved yet. This is one all-or-nothing import — either every row below lands, or
              none do. Review it, then confirm.
            </p>

            <div className="mt-4 max-h-72 overflow-y-auto rounded-xl border border-border">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead className="sticky top-0 bg-ink-muted/5 text-xs uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Email</th>
                    <th className="px-3 py-2 font-medium">Phone</th>
                    <th className="px-3 py-2 font-medium">Capacity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.lineNumber} className={r.skipReason ? "opacity-50" : ""}>
                      <td className="px-3 py-2 text-ink-primary">
                        {r.displayName || "—"}
                        {r.skipReason ? (
                          <span className="ml-1.5 text-xs text-status-warning">{r.skipReason}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-ink-secondary">{r.contactEmail ?? "—"}</td>
                      <td className="px-3 py-2 text-ink-secondary">{r.contactPhone ?? "—"}</td>
                      <td className="px-3 py-2 text-ink-secondary">
                        {r.capacity ?? "—"}
                        {r.capacityRaw && r.capacity === undefined ? (
                          <span className="ml-1 text-xs text-status-warning">
                            (ignoring &quot;{r.capacityRaw}&quot;)
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-2 text-sm text-ink-secondary">
              {importRows.length} {importRows.length === 1 ? "sponsor" : "sponsors"} will be imported
              {skippedRows.length > 0
                ? `, ${skippedRows.length} skipped (no name, so nothing to call them)`
                : ""}
              .
            </p>

            {submitError ? (
              <div className="mt-2 rounded-lg bg-status-critical/10 px-3 py-2 text-sm text-ink-primary">
                Nothing was imported. {submitError} Fix the CSV above and try again.
              </div>
            ) : null}

            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setStep("upload")}
                className="rounded-lg px-4 py-2 text-sm font-medium text-ink-secondary hover:bg-ink-muted/10"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={submitting || importRows.length === 0}
                className="rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? "Importing…" : `Import ${importRows.length}`}
              </button>
            </div>
          </>
        ) : null}

        {step === "success" ? (
          <>
            <div className="mt-4 rounded-lg bg-status-good/10 px-3 py-2 text-sm text-ink-primary">
              Imported {createdCount} {createdCount === 1 ? "sponsor" : "sponsors"}.
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                Done
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
