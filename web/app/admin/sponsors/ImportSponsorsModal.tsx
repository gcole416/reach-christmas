"use client";

import { useState, type ChangeEvent, type ReactNode } from "react";
import Link from "next/link";
import { useData } from "@/lib/store";
import { getSponsorFamilies } from "@/lib/queries";
import {
  buildImportPayload,
  defaultSelection,
  parseSponsorCsv,
  planSponsorImport,
  type ImportPlan,
  type ImportSelection,
  type SponsorCsvRow,
} from "@/lib/sponsorCsv";
import { applySponsorImport, formatSignUpDate } from "@/lib/sponsorImport";

// US-76 (replaces US-56's one-shot import and US-74's duplicate check): drop
// in the Church Center registrations export as often as needed. People
// already on the roster are recognised by their Church Center Registration ID
// (or, for hand-added entries, their email) and keep every assigned child;
// only new sign-ups are added, changed details are updated, and anything odd
// is listed for a person to decide. Nothing is written until Confirm, and
// then it's one all-or-nothing call (apply_sponsor_import).

type Step = "upload" | "preview" | "success";

interface SuccessInfo {
  added: number;
  updated: number;
  capacityKept: string[];
}

export function ImportSponsorsModal({ onClose }: { onClose: () => void }) {
  const { data, refresh } = useData();
  const [step, setStep] = useState<Step>("upload");
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [selection, setSelection] = useState<ImportSelection | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<SuccessInfo | null>(null);

  if (!data) return null;
  const driveId = data.drive.id;

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  function handlePreview() {
    if (!data) return;
    setSubmitError(null);
    const result = parseSponsorCsv(csvText);
    if (!result.ok) {
      setParseError(result.error);
      return;
    }
    setParseError(null);
    const roster = getSponsorFamilies(data).map((sf) => ({
      id: sf.id,
      displayName: sf.displayName,
      contactEmail: sf.contactEmail,
      contactPhone: sf.contactPhone,
      capacity: sf.capacity,
      isActive: sf.isActive,
      assignedCount: sf.assignedCount,
      churchCenterRegistrationId: sf.churchCenterRegistrationId,
      signedUpAt: sf.signedUpAt,
      churchCenterSnapshot: sf.churchCenterSnapshot,
    }));
    const next = planSponsorImport(result.parsed, roster);
    setPlan(next);
    setSelection(defaultSelection(next));
    setStep("preview");
  }

  function toggle(key: keyof ImportSelection, line: number) {
    setSelection((sel) => {
      if (!sel) return sel;
      const set = new Set(sel[key]);
      if (set.has(line)) set.delete(line);
      else set.add(line);
      return { ...sel, [key]: set };
    });
  }

  async function handleConfirm() {
    if (!plan || !selection) return;
    setSubmitting(true);
    setSubmitError(null);
    const result = await applySponsorImport(driveId, fileName, buildImportPayload(plan, selection));
    setSubmitting(false);
    if (!result.ok) {
      setSubmitError(result.error);
      return;
    }
    await refresh();
    setSuccess({ added: result.added, updated: result.updated, capacityKept: result.capacityKept });
    setStep("success");
  }

  const addCount = selection ? selection.newLines.size + selection.duplicateLines.size : 0;
  const updateCount = selection ? selection.updateLines.size : 0;
  const confirmLabel =
    addCount && updateCount
      ? `Add ${addCount} and update ${updateCount}`
      : addCount
        ? `Add ${addCount}`
        : updateCount
          ? `Update ${updateCount}`
          : "Mark roster as up to date";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={submitting ? undefined : onClose}>
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-ink-primary">Import or update sponsors</h2>

        {step === "upload" ? (
          <>
            <p className="mt-1 text-sm text-ink-secondary">
              Drop in the registrations export from Church Center. Do this as often as you like: people
              already on the roster are recognized and keep their assigned children, and only new sign-ups
              are added. You&apos;ll see everything before it saves.
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
              {fileName ? <p className="text-xs text-ink-muted">Loaded {fileName}.</p> : null}
              <details className="text-sm">
                <summary className="cursor-pointer text-ink-secondary">Or paste CSV text</summary>
                <textarea
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  rows={6}
                  placeholder={"name,email,phone,capacity\nJane Smith,jane@example.com,555-0100,2"}
                  className="mt-2 w-full rounded-lg border border-border bg-surface p-2 font-mono text-xs text-ink-primary placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-cat-blue"
                />
                <p className="mt-1 text-xs text-ink-muted">
                  Church Center exports work as they are. Any other list needs the columns name, email, phone,
                  capacity.
                </p>
              </details>
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
                Preview
              </button>
            </div>
          </>
        ) : null}

        {step === "preview" && plan && selection ? (
          <>
            <p className="mt-1 text-sm text-ink-secondary">
              Nothing is saved yet. Assigned children, notes, and active/inactive status are never changed by
              an import.
              {plan.format === "simple" ? " This file isn't a Church Center export, so people are matched by email." : ""}
            </p>

            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Pill tone="good">{plan.newRows.length} new</Pill>
              <Pill tone="info">{plan.updates.length} changed</Pill>
              <Pill tone="muted">{plan.unchanged.length} already on roster</Pill>
              {plan.flagged.length > 0 ? <Pill tone="warn">{plan.flagged.length} need a look</Pill> : null}
              {plan.duplicates.length > 0 ? <Pill tone="warn">{plan.duplicates.length} possible duplicates</Pill> : null}
              {plan.skipped.length > 0 ? <Pill tone="muted">{plan.skipped.length} skipped</Pill> : null}
            </div>

            <div className="mt-4 space-y-4">
              {plan.newRows.length > 0 ? (
                <Section title={`New sign-ups (${plan.newRows.length})`} hint="Added as active, ready on Assign sponsors.">
                  <RowTable>
                    {plan.newRows.map(({ row, notes }) => (
                      <tr key={row.lineNumber}>
                        <CheckCell
                          checked={selection.newLines.has(row.lineNumber)}
                          onChange={() => toggle("newLines", row.lineNumber)}
                          label={`Add ${row.displayName}`}
                        />
                        <PersonCells row={row} note={notes} />
                      </tr>
                    ))}
                  </RowTable>
                </Section>
              ) : null}

              {plan.updates.length > 0 ? (
                <Section
                  title={`Changed in Church Center (${plan.updates.length})`}
                  hint="Church Center changed these since the last import. Untick any you'd rather keep as they are on the roster; you won't be asked again unless Church Center changes them again."
                >
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {plan.updates.map((u) => (
                      <li key={u.row.lineNumber} className="flex items-start gap-3 px-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selection.updateLines.has(u.row.lineNumber)}
                          onChange={() => toggle("updateLines", u.row.lineNumber)}
                          aria-label={`Update ${u.entry.displayName}`}
                          className="mt-0.5 h-4 w-4 rounded border-border"
                        />
                        <div className="min-w-0">
                          <p className="font-medium text-ink-primary">
                            {u.entry.displayName}
                            {!u.entry.isActive ? <span className="ml-1.5 text-xs font-normal text-ink-muted">(inactive)</span> : null}
                          </p>
                          <p className="text-xs text-ink-secondary">
                            {u.changes.length > 0
                              ? u.changes.map((c) => `${c.label}: ${c.from} → ${c.to}`).join(" · ")
                              : "Adds their Church Center sign-up time"}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}

              {plan.flagged.length > 0 ? (
                <Section
                  title={`Needs a look (${plan.flagged.length})`}
                  hint="Nothing here changes on its own. If someone has dropped out, use Mark inactive on the roster, then reassign their children."
                >
                  <ul className="divide-y divide-border rounded-lg border border-status-warning/40 bg-status-warning/5">
                    {plan.flagged.map((f, i) => (
                      <li key={`${f.entry.id}-${f.kind}-${i}`} className="px-3 py-2 text-sm">
                        <span className="font-medium text-ink-primary">{f.entry.displayName}</span>
                        <span className="ml-1.5 text-xs font-medium text-status-warning">
                          {f.kind === "cancelled" ? "Cancelled in Church Center" : f.kind === "missing" ? "Missing from file" : "Count went down"}
                        </span>
                        <p className="text-xs text-ink-secondary">{f.message}</p>
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}

              {plan.duplicates.length > 0 ? (
                <Section
                  title={`Possible duplicates (${plan.duplicates.length})`}
                  hint="Skipped unless you tick them. Usually the same person registering twice; check with them how many children they want, then fix their count on the roster. Your fix sticks through later imports."
                >
                  <RowTable>
                    {plan.duplicates.map((d) => (
                      <tr key={d.row.lineNumber}>
                        <CheckCell
                          checked={selection.duplicateLines.has(d.row.lineNumber)}
                          onChange={() => toggle("duplicateLines", d.row.lineNumber)}
                          label={`Add ${d.row.displayName} anyway`}
                        />
                        <PersonCells row={d.row} note={d.reason} noteTone="warn" />
                      </tr>
                    ))}
                  </RowTable>
                </Section>
              ) : null}

              {plan.unchanged.length > 0 ? (
                <details className="rounded-lg border border-border px-3 py-2 text-sm">
                  <summary className="cursor-pointer text-ink-secondary">
                    Already on the roster, nothing changed ({plan.unchanged.length})
                  </summary>
                  <p className="mt-2 text-xs text-ink-muted">
                    {plan.unchanged.map((u) => u.entry.displayName).join(", ")}
                  </p>
                </details>
              ) : null}

              {plan.skipped.length > 0 ? (
                <details className="rounded-lg border border-border px-3 py-2 text-sm">
                  <summary className="cursor-pointer text-ink-secondary">Skipped ({plan.skipped.length})</summary>
                  <ul className="mt-2 space-y-0.5 text-xs text-ink-muted">
                    {plan.skipped.map((s) => (
                      <li key={s.row.lineNumber}>
                        Line {s.row.lineNumber}: {s.row.displayName || "(no name)"}, {s.reason.toLowerCase()}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>

            {submitError ? (
              <div className="mt-3 rounded-lg bg-status-critical/10 px-3 py-2 text-sm text-ink-primary">
                Nothing was saved. {submitError}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setStep("upload")}
                disabled={submitting}
                className="rounded-lg px-4 py-2 text-sm font-medium text-ink-secondary hover:bg-ink-muted/10 disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={submitting}
                className="rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? "Saving…" : confirmLabel}
              </button>
            </div>
          </>
        ) : null}

        {step === "success" && success ? (
          <>
            <div className="mt-4 rounded-lg bg-status-good/10 px-3 py-2 text-sm text-ink-primary">
              {success.added === 0 && success.updated === 0
                ? "Roster marked as up to date. Nothing needed changing."
                : `Added ${success.added} new ${success.added === 1 ? "sponsor" : "sponsors"} and updated ${success.updated}.`}
            </div>
            {success.capacityKept.length > 0 ? (
              <p className="mt-2 text-sm text-ink-secondary">
                Kept a higher limit for {success.capacityKept.join(", ")}, because they already have more children
                assigned than Church Center now says.
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-3">
              {success.added > 0 ? (
                <Link
                  href="/admin/assign"
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink-secondary hover:border-cat-blue hover:text-ink-primary"
                >
                  Go to Assign sponsors
                </Link>
              ) : null}
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

function Pill({ tone, children }: { tone: "good" | "info" | "warn" | "muted"; children: ReactNode }) {
  const cls = {
    good: "bg-status-good/15 text-ink-primary",
    info: "bg-cat-blue/10 text-ink-primary",
    warn: "bg-status-warning/15 text-ink-primary",
    muted: "bg-ink-muted/10 text-ink-secondary",
  }[tone];
  return <span className={`rounded-full px-2.5 py-1 font-medium ${cls}`}>{children}</span>;
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-ink-primary">{title}</h3>
      <p className="mb-2 text-xs text-ink-muted">{hint}</p>
      {children}
    </section>
  );
}

function RowTable({ children }: { children: ReactNode }) {
  return (
    <div className="max-h-64 overflow-auto rounded-lg border border-border">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="sticky top-0 bg-surface text-xs uppercase tracking-wide text-ink-muted">
          <tr>
            <th className="w-8 px-3 py-2">
              <span className="sr-only">Include</span>
            </th>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Email</th>
            <th className="px-3 py-2 font-medium">Phone</th>
            <th className="px-3 py-2 font-medium">Children</th>
            <th className="px-3 py-2 font-medium">Signed up</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

function CheckCell({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <td className="px-3 py-2 align-top">
      <input type="checkbox" checked={checked} onChange={onChange} aria-label={label} className="h-4 w-4 rounded border-border" />
    </td>
  );
}

function PersonCells({ row, note, noteTone }: { row: SponsorCsvRow; note: string | null; noteTone?: "warn" }) {
  return (
    <>
      <td className="px-3 py-2 align-top text-ink-primary">
        {row.displayName}
        {note ? (
          <p className={`text-xs ${noteTone === "warn" ? "text-status-warning" : "text-ink-muted"}`}>{note}</p>
        ) : null}
      </td>
      <td className="px-3 py-2 align-top text-ink-secondary">{row.emails[0] ?? "none"}</td>
      <td className="px-3 py-2 align-top text-ink-secondary">{row.contactPhone ?? "none"}</td>
      <td className="px-3 py-2 align-top text-ink-secondary">
        {row.capacity ?? "not set"}
        {row.capacityRaw && row.capacity == null ? (
          <span className="ml-1 text-xs text-status-warning">(ignoring &quot;{row.capacityRaw}&quot;)</span>
        ) : null}
      </td>
      <td className="px-3 py-2 align-top text-ink-secondary">{row.signedUpAt ? formatSignUpDate(row.signedUpAt) : ""}</td>
    </>
  );
}
