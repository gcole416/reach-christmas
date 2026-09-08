"use client";

import { useState, type FormEvent } from "react";
import { useData } from "@/lib/store";
import { getSchoolsForDrive } from "@/lib/queries";
import { FormField } from "@/components/FormField";
import { SearchInput } from "@/components/SearchInput";
import type { DistributionMethod } from "@/lib/types";
import { AdminPageHeader } from "../AdminPageHeader";

const DISTRIBUTION_LABELS: Record<DistributionMethod, string> = {
  school_dropoff: "School drop-off",
  church_pickup: "Church pickup",
};

export default function SchoolsAdminPage() {
  const { data } = useData();
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");

  if (!data) return null;

  const allSchools = getSchoolsForDrive(data);
  const q = search.trim().toLowerCase();
  const schools = q
    ? allSchools.filter((s) => [s.name, s.code, s.liaisonName ?? ""].join(" ").toLowerCase().includes(q))
    : allSchools;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <AdminPageHeader
        title="Schools"
        description={
          <>
            Partner schools referring households into {data.drive.name}. Each school gets its own card
            code (e.g. &quot;L&quot; for Lincoln) used in every card number from that school.
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by name, code, or liaison…" />
        <div className="flex items-center gap-3">
          <p className="text-sm text-ink-muted">
            {schools.length} of {allSchools.length}
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Add school
          </button>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-ink-muted/5 text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">Liaison</th>
              <th className="px-4 py-3 font-medium">Distribution</th>
              <th className="px-4 py-3 font-medium">Households</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {schools.map((s) => (
              <tr key={s.driveSchoolId}>
                <td className="px-4 py-3 text-ink-primary">{s.name}</td>
                <td className="px-4 py-3 text-ink-secondary">{s.code}</td>
                <td className="px-4 py-3 text-ink-secondary">
                  {s.liaisonName ?? "—"}
                  {s.liaisonEmail ? <div className="text-xs text-ink-muted">{s.liaisonEmail}</div> : null}
                </td>
                <td className="px-4 py-3 text-ink-secondary">
                  {s.distributionMethod ? DISTRIBUTION_LABELS[s.distributionMethod] : "Inherits drive default"}
                </td>
                <td className="px-4 py-3 text-ink-secondary">{s.familyCount}</td>
              </tr>
            ))}
            {schools.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-secondary">
                  {allSchools.length === 0 ? "No schools yet. Add the first one." : "No schools match this search."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {showForm ? (
        <AddSchoolForm onClose={() => setShowForm(false)} />
      ) : null}
    </div>
  );
}

function AddSchoolForm({ onClose }: { onClose: () => void }) {
  const { addSchool } = useData();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [liaisonName, setLiaisonName] = useState("");
  const [liaisonPhone, setLiaisonPhone] = useState("");
  const [liaisonEmail, setLiaisonEmail] = useState("");
  const [distributionMethod, setDistributionMethod] = useState<"inherit" | DistributionMethod>("inherit");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await addSchool({ name, code, liaisonName, liaisonPhone, liaisonEmail, distributionMethod });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-ink-primary">Add a school</h2>
        <p className="mt-1 text-sm text-ink-secondary">Creates the school and enrolls it in this year&apos;s drive.</p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <FormField label="School name" value={name} onChange={setName} required />
          <FormField label="Card code (e.g. L)" value={code} onChange={(v) => setCode(v.toUpperCase())} required maxLength={3} />
          <FormField label="Liaison name (optional)" value={liaisonName} onChange={setLiaisonName} />
          <FormField label="Liaison phone (optional)" value={liaisonPhone} onChange={setLiaisonPhone} type="tel" />
          <FormField label="Liaison email (optional)" value={liaisonEmail} onChange={setLiaisonEmail} type="email" />
          <label className="block text-sm">
            <span className="text-ink-secondary">Distribution method</span>
            <select
              value={distributionMethod}
              onChange={(e) => setDistributionMethod(e.target.value as "inherit" | DistributionMethod)}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-ink-primary"
            >
              <option value="inherit">Inherit drive default</option>
              <option value="school_dropoff">School drop-off</option>
              <option value="church_pickup">Church pickup</option>
            </select>
          </label>
          {error ? (
            <div className="rounded-lg bg-status-critical/10 px-3 py-2 text-sm text-ink-primary">{error}</div>
          ) : null}
          <div className="mt-2 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-ink-secondary hover:bg-ink-muted/10"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "Adding…" : "Add school"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
