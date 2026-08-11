"use client";

import { useState } from "react";
import { useData } from "@/lib/store";
import type { Profile } from "@/lib/types";
import { AdminNav } from "../AdminNav";

const ROLE_LABELS: Record<Profile["role"], string> = {
  admin: "Admin",
  volunteer: "Volunteer",
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function VolunteersAdminPage() {
  const { data } = useData();

  if (!data) return null;

  const profiles = data.profiles;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-3xl font-semibold text-ink-primary">Volunteers &amp; staff</h1>
      <p className="mt-2 text-ink-secondary">
        Manage roles and confidential-family access for existing accounts. New accounts are created in
        the Supabase dashboard, not here.
      </p>

      <AdminNav />

      <p className="text-sm text-ink-muted">{profiles.length} accounts</p>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-ink-muted/5 text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Confidential access?</th>
              <th className="px-4 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {profiles.map((profile) => (
              <VolunteerRow key={profile.id} profile={profile} />
            ))}
            {profiles.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-ink-secondary">
                  No accounts visible to you yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VolunteerRow({ profile }: { profile: Profile }) {
  const { updateVolunteerAccess } = useData();
  const [role, setRole] = useState(profile.role);
  const [canViewConfidential, setCanViewConfidential] = useState(profile.canViewConfidential);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRoleChange(nextRole: Profile["role"]) {
    const previous = role;
    setRole(nextRole);
    setSaving(true);
    setError(null);
    const result = await updateVolunteerAccess(profile.id, { role: nextRole });
    setSaving(false);
    if (!result.ok) {
      setRole(previous);
      setError(result.error);
    }
  }

  async function handleConfidentialToggle(next: boolean) {
    const previous = canViewConfidential;
    setCanViewConfidential(next);
    setSaving(true);
    setError(null);
    const result = await updateVolunteerAccess(profile.id, { canViewConfidential: next });
    setSaving(false);
    if (!result.ok) {
      setCanViewConfidential(previous);
      setError(result.error);
    }
  }

  return (
    <tr>
      <td className="px-4 py-3 text-ink-primary">{profile.fullName}</td>
      <td className="px-4 py-3">
        <label className="sr-only" htmlFor={`role-${profile.id}`}>
          Role for {profile.fullName}
        </label>
        <select
          id={`role-${profile.id}`}
          value={role}
          disabled={saving}
          onChange={(e) => handleRoleChange(e.target.value as Profile["role"])}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink-primary focus:outline-none focus:ring-2 focus:ring-cat-blue disabled:opacity-50"
        >
          {(Object.keys(ROLE_LABELS) as Profile["role"][]).map((value) => (
            <option key={value} value={value}>
              {ROLE_LABELS[value]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-3">
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={canViewConfidential}
            aria-label={`Confidential access for ${profile.fullName}`}
            disabled={saving}
            onClick={() => handleConfidentialToggle(!canViewConfidential)}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-cat-blue focus:ring-offset-2 disabled:opacity-50 ${
              canViewConfidential ? "bg-cat-blue" : "bg-ink-muted/30"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-surface shadow transition-transform ${
                canViewConfidential ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
          <span className="text-ink-secondary">{canViewConfidential ? "Yes" : "No"}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-ink-secondary">
        {formatDate(profile.createdAt)}
        {saving ? <div className="mt-1 text-xs text-ink-muted">Saving…</div> : null}
        {error ? <div className="mt-1 text-xs text-status-critical">{error}</div> : null}
      </td>
    </tr>
  );
}
