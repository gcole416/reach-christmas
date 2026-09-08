"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { mapDrive } from "@/lib/supabase/mappers";
import type { Drive, DriveStatus, DistributionMethod } from "@/lib/types";
import { FormField } from "@/components/FormField";
import { AdminNav } from "../AdminNav";
import { AdminPageHeader } from "../AdminPageHeader";

const STATUS_LABELS: Record<DriveStatus, string> = {
  draft: "Draft",
  open: "Open",
  closed: "Closed",
  archived: "Archived",
};

const DISTRIBUTION_LABELS: Record<DistributionMethod, string> = {
  school_dropoff: "School drop-off",
  church_pickup: "Church pickup",
};

export default function DrivesPage() {
  const [drives, setDrives] = useState<Drive[] | null>(null);
  const [isViewerAdmin, setIsViewerAdmin] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingDrive, setEditingDrive] = useState<Drive | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const supabase = createClient();
    const [{ data: userData }, { data, error }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("drives").select("*").order("year", { ascending: false }),
    ]);
    if (error) {
      setLoadError(error.message);
      return;
    }
    setDrives((data ?? []).map(mapDrive));

    if (userData.user) {
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", userData.user.id).single();
      setIsViewerAdmin(profile?.role === "admin");
    }
  }, []);

  useEffect(() => {
    // Fetching from Supabase on mount — the sanctioned "sync from an external
    // system" exception to the no-setState-in-effect rule.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleStatusChange(drive: Drive, status: DriveStatus) {
    setRowError(null);
    if (status === "open" && drives) {
      const otherOpen = drives.find((d) => d.id !== drive.id && d.status === "open");
      if (otherOpen) {
        setRowError({
          id: drive.id,
          message: `Close "${otherOpen.name}" first. Only one drive can be open at a time.`,
        });
        return;
      }
    }
    setBusyId(drive.id);
    const supabase = createClient();
    const { error } = await supabase.from("drives").update({ status }).eq("id", drive.id);
    setBusyId(null);
    if (error) {
      setRowError({ id: drive.id, message: error.message });
      return;
    }
    await load();
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <AdminNav />
        <div className="rounded-lg bg-status-critical/10 px-4 py-3 text-sm text-ink-primary">
          Couldn&apos;t load drives: {loadError}
        </div>
      </div>
    );
  }

  if (!drives) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-10">
        <AdminNav />
        <p className="text-ink-secondary">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <AdminPageHeader
        title="Drives"
        description={
          <>
            Every year&apos;s drive is its own row here. Exactly one can be &quot;Open&quot; at a
            time, and that&apos;s the one the rest of the app reads and writes to.
          </>
        }
      />

      {!isViewerAdmin ? (
        <div className="mb-6 rounded-lg bg-status-warning/15 px-4 py-3 text-sm text-ink-primary">
          You&apos;re signed in as a volunteer, so only an admin can create a drive or change its status.
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-muted">{drives.length} drives</p>
        {isViewerAdmin ? (
          <button
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Create drive
          </button>
        ) : null}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-ink-muted/5 text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Year</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Default distribution</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {drives.map((drive) => (
              <tr key={drive.id}>
                <td className="px-4 py-3 text-ink-primary">{drive.year}</td>
                <td className="px-4 py-3 text-ink-secondary">{drive.name}</td>
                <td className="px-4 py-3">
                  <select
                    value={drive.status}
                    disabled={!isViewerAdmin || busyId === drive.id}
                    onChange={(e) => handleStatusChange(drive, e.target.value as DriveStatus)}
                    className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink-primary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {(Object.keys(STATUS_LABELS) as DriveStatus[]).map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                  {rowError?.id === drive.id ? (
                    <p className="mt-1 text-xs text-status-critical">{rowError.message}</p>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-ink-secondary">
                  {drive.defaultDistributionMethod ? DISTRIBUTION_LABELS[drive.defaultDistributionMethod] : "Not set"}
                </td>
                <td className="px-4 py-3 text-right">
                  {isViewerAdmin ? (
                    <button
                      onClick={() => setEditingDrive(drive)}
                      className="text-xs font-medium text-cat-blue hover:opacity-80"
                    >
                      Edit
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {drives.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-secondary">
                  No drives yet. Create the first one.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {showForm ? <CreateDriveForm onClose={() => setShowForm(false)} onCreated={load} /> : null}
      {editingDrive ? (
        <EditDriveForm drive={editingDrive} onClose={() => setEditingDrive(null)} onSaved={load} />
      ) : null}
    </div>
  );
}

function CreateDriveForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const suggestedYear = new Date().getFullYear() + 1;
  const [year, setYear] = useState(String(suggestedYear));
  const [name, setName] = useState(`Reach Christmas ${suggestedYear}`);
  const [distributionMethod, setDistributionMethod] = useState<"" | DistributionMethod>("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const parsedYear = Number(year);
    if (!Number.isInteger(parsedYear) || parsedYear < 2000) {
      setError("Enter a valid year.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: insertError } = await supabase.from("drives").insert({
      year: parsedYear,
      name: name.trim() || `Reach Christmas ${parsedYear}`,
      status: "draft",
      default_distribution_method: distributionMethod || null,
    });
    setSubmitting(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    onCreated();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-ink-primary">Create a drive</h2>
        <p className="mt-1 text-sm text-ink-secondary">
          Starts as &quot;Draft&quot;. Switch it to &quot;Open&quot; here once you&apos;re ready for it
          to be the one the app uses.
        </p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <FormField label="Year" value={year} onChange={setYear} type="number" required />
          <FormField label="Name" value={name} onChange={setName} required />
          <label className="block text-sm">
            <span className="text-ink-secondary">Default distribution method (optional)</span>
            <select
              value={distributionMethod}
              onChange={(e) => setDistributionMethod(e.target.value as "" | DistributionMethod)}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-ink-primary"
            >
              <option value="">Not set yet</option>
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
              {submitting ? "Creating…" : "Create drive"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditDriveForm({
  drive,
  onClose,
  onSaved,
}: {
  drive: Drive;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [year, setYear] = useState(String(drive.year));
  const [name, setName] = useState(drive.name);
  const [distributionMethod, setDistributionMethod] = useState<"" | DistributionMethod>(
    drive.defaultDistributionMethod ?? ""
  );
  const [referralWindowStart, setReferralWindowStart] = useState(drive.referralWindowStart ?? "");
  const [referralWindowEnd, setReferralWindowEnd] = useState(drive.referralWindowEnd ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const parsedYear = Number(year);
    if (!Number.isInteger(parsedYear) || parsedYear < 2000) {
      setError("Enter a valid year.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("drives")
      .update({
        year: parsedYear,
        name: name.trim() || `Reach Christmas ${parsedYear}`,
        default_distribution_method: distributionMethod || null,
        referral_window_start: referralWindowStart || null,
        referral_window_end: referralWindowEnd || null,
      })
      .eq("id", drive.id);
    setSubmitting(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-ink-primary">Edit {drive.name}</h2>
        <p className="mt-1 text-sm text-ink-secondary">
          Status is changed from the dropdown on the drives list, not here.
        </p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <FormField label="Year" value={year} onChange={setYear} type="number" required />
          <FormField label="Name" value={name} onChange={setName} required />
          <label className="block text-sm">
            <span className="text-ink-secondary">Default distribution method</span>
            <select
              value={distributionMethod}
              onChange={(e) => setDistributionMethod(e.target.value as "" | DistributionMethod)}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-ink-primary"
            >
              <option value="">Not set yet</option>
              <option value="school_dropoff">School drop-off</option>
              <option value="church_pickup">Church pickup</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-ink-secondary">Referral window start</span>
              <input
                type="date"
                value={referralWindowStart}
                onChange={(e) => setReferralWindowStart(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-ink-primary"
              />
            </label>
            <label className="block text-sm">
              <span className="text-ink-secondary">Referral window end</span>
              <input
                type="date"
                value={referralWindowEnd}
                onChange={(e) => setReferralWindowEnd(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-ink-primary"
              />
            </label>
          </div>
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
              {submitting ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
