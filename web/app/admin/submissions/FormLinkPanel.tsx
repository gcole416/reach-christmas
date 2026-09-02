"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  createFormLink,
  formPath,
  revokeFormLink,
  type DriveFormVersionRecord,
  type FormLinkRecord,
} from "@/lib/intake";
import { getSchoolsForDrive } from "@/lib/queries";
import type { DataBundle } from "@/lib/types";
import { formatDate } from "@/components/intake/format";
import { channelLabel } from "./shared";

// The staff surface for registration links (ADM-24): the manual fallback
// INTAKE_FORMS §11 asks for — every link on screen, copyable, sendable by hand —
// plus the create/revoke controls that used to be SQL-only.
//
// Grouped by school so "which of my schools has a link" is answerable at a
// glance, which the flat list wasn't: a school with no link showed nothing at
// all rather than "no link yet".
//
// Confidentiality is handled entirely by RLS on form_links — an uncleared
// volunteer never gets the confidential-channel row back, so there is no
// client-side filtering here and none to add. Creating a confidential
// (null-school) link stays SQL-only; this UI only makes school links, and only
// 'family' channel (a 'counselor'/'staff' link auto-verifies and its token is
// readable by every signed-in user — ADM-20).

function linkState(link: FormLinkRecord): { label: string; live: boolean } {
  const now = Date.now();
  if (link.revokedAt) return { label: "Revoked", live: false };
  if (link.expiresAt && new Date(link.expiresAt).getTime() < now)
    return { label: `Expired ${formatDate(link.expiresAt)}`, live: false };
  if (link.opensAt && new Date(link.opensAt).getTime() > now)
    return { label: `Opens ${formatDate(link.opensAt)}`, live: false };
  if (link.maxSubmissions !== null && link.submissionCount >= link.maxSubmissions)
    return { label: "Full", live: false };
  return { label: "Open", live: true };
}

function isoToDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateInputToIso(dateStr: string, endOfDay: boolean): string | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T${endOfDay ? "23:59:59" : "00:00:00"}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const fieldClass =
  "mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-ink-primary focus:ring-2 focus:ring-cat-blue focus:outline-none";

function LinkItem({
  link,
  onRevoke,
  busy,
}: {
  link: FormLinkRecord;
  onRevoke: (link: FormLinkRecord) => void;
  busy: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const state = linkState(link);

  async function copy() {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    try {
      await navigator.clipboard.writeText(`${origin}${formPath(link.token)}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // The read-only input beside the button is the fallback; nothing to recover.
      setCopied(false);
    }
  }

  return (
    <li className="rounded-lg border border-gridline p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {link.label ? (
          <span className="font-medium text-ink-primary">{link.label}</span>
        ) : (
          <span className="text-sm text-ink-secondary">No label</span>
        )}
        <span className="rounded-full bg-ink-muted/10 px-2 py-0.5 text-xs font-medium text-ink-primary uppercase">
          {link.locale}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            state.live
              ? "bg-status-good/10 text-ink-primary"
              : "bg-ink-muted/15 text-ink-primary"
          }`}
        >
          {state.label}
        </span>
        <span className="text-xs text-ink-muted">
          {link.submissionCount} submitted
          {link.maxSubmissions !== null ? ` of ${link.maxSubmissions}` : ""}
          {link.expiresAt && !link.revokedAt ? ` · expires ${formatDate(link.expiresAt)}` : ""}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor={`link-${link.id}`} className="sr-only">
          Registration link ({link.label ?? link.token})
        </label>
        <input
          id={`link-${link.id}`}
          type="text"
          readOnly
          value={formPath(link.token)}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-ink-primary focus:ring-2 focus:ring-cat-blue focus:outline-none"
        />
        <button
          type="button"
          onClick={copy}
          className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-ink-secondary hover:border-cat-blue hover:text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue"
        >
          {copied ? "Copied" : "Copy full link"}
        </button>
        {!link.revokedAt ? (
          <button
            type="button"
            onClick={() => onRevoke(link)}
            disabled={busy}
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-status-critical hover:border-status-critical focus:outline-none focus-visible:ring-2 focus-visible:ring-status-critical disabled:opacity-50"
          >
            Revoke
          </button>
        ) : null}
      </div>
    </li>
  );
}

function CreateLinkForm({
  data,
  formVersions,
  initialDriveSchoolId,
  onCreate,
  onCancel,
}: {
  data: DataBundle;
  formVersions: DriveFormVersionRecord[];
  initialDriveSchoolId: string | null;
  onCreate: (input: {
    driveSchoolId: string;
    formVersionId: string;
    locale: string;
    label: string;
    opensAt: string | null;
    expiresAt: string | null;
    maxSubmissions: number | null;
  }) => Promise<string | null>;
  onCancel: () => void;
}) {
  const schools = useMemo(() => getSchoolsForDrive(data), [data]);

  const [driveSchoolId, setDriveSchoolId] = useState(
    initialDriveSchoolId ?? schools[0]?.driveSchoolId ?? ""
  );
  const [formVersionId, setFormVersionId] = useState(formVersions[0]?.formVersionId ?? "");
  const [label, setLabel] = useState("");
  const [opensOn, setOpensOn] = useState("");
  const [expiresOn, setExpiresOn] = useState(
    isoToDateInput(data.drive.referralWindowEnd)
  );
  const [maxSubmissions, setMaxSubmissions] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (formVersions.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-border bg-background p-4 text-sm text-ink-secondary">
        This drive has no published registration questionnaire yet, so there&apos;s nothing for a
        link to point at. Publish a form version first, then create links here.
        <div className="mt-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-ink-secondary hover:border-cat-blue hover:text-ink-primary"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const chosenVersion =
    formVersions.find((v) => v.formVersionId === formVersionId) ?? formVersions[0];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!driveSchoolId) {
      setError("Pick a school for this link.");
      return;
    }
    const max = maxSubmissions.trim() === "" ? null : Number(maxSubmissions);
    if (max !== null && (!Number.isInteger(max) || max < 1)) {
      setError("Max submissions must be a whole number of 1 or more, or left blank.");
      return;
    }
    const opensAt = dateInputToIso(opensOn, false);
    const expiresAt = dateInputToIso(expiresOn, true);
    // INTAKE_FORMS §11 lists "expires_at always set" as a Phase 1 spam control.
    if (!expiresAt) {
      setError("Set an expiry date — a link with no end date is one of the spam controls we skip.");
      return;
    }
    if (opensAt && new Date(opensAt).getTime() >= new Date(expiresAt).getTime()) {
      setError("The open date has to be before the expiry date.");
      return;
    }

    setSubmitting(true);
    const message = await onCreate({
      driveSchoolId,
      formVersionId: chosenVersion.formVersionId,
      locale: chosenVersion.locale,
      label,
      opensAt,
      expiresAt,
      maxSubmissions: max,
    });
    setSubmitting(false);
    if (message) setError(message);
  }

  return (
    <form
      onSubmit={submit}
      className="mt-4 space-y-3 rounded-lg border border-border bg-background p-4"
    >
      <p className="text-sm font-medium text-ink-primary">New registration link</p>

      <label className="block text-sm">
        <span className="text-ink-secondary">School</span>
        <select
          value={driveSchoolId}
          onChange={(e) => setDriveSchoolId(e.target.value)}
          className={fieldClass}
        >
          {schools.length === 0 ? <option value="">No schools in this drive</option> : null}
          {schools.map((s) => (
            <option key={s.driveSchoolId} value={s.driveSchoolId}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      {formVersions.length === 1 ? (
        <p className="text-xs text-ink-muted">
          Questionnaire: {chosenVersion.formName} (v{chosenVersion.version},{" "}
          {chosenVersion.locale})
        </p>
      ) : (
        <label className="block text-sm">
          <span className="text-ink-secondary">Questionnaire</span>
          <select
            value={formVersionId}
            onChange={(e) => setFormVersionId(e.target.value)}
            className={fieldClass}
          >
            {formVersions.map((v) => (
              <option key={v.formVersionId} value={v.formVersionId}>
                {v.formName} — v{v.version} ({v.locale})
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="block text-sm">
        <span className="text-ink-secondary">Label (optional — shown to staff, not families)</span>
        <input
          type="text"
          value={label}
          maxLength={120}
          placeholder={`e.g. "${chosenVersion.formName} — ${chosenVersion.locale}"`}
          onChange={(e) => setLabel(e.target.value)}
          className={fieldClass}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-ink-secondary">Opens (optional)</span>
          <input
            type="date"
            value={opensOn}
            onChange={(e) => setOpensOn(e.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="block text-sm">
          <span className="text-ink-secondary">Expires</span>
          <input
            type="date"
            required
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
            className={fieldClass}
          />
          <span className="mt-1 block text-xs text-ink-muted">
            Usually the drive close date. Required.
          </span>
        </label>
      </div>

      <label className="block text-sm">
        <span className="text-ink-secondary">Max submissions (optional)</span>
        <input
          type="number"
          min={1}
          inputMode="numeric"
          value={maxSubmissions}
          onChange={(e) => setMaxSubmissions(e.target.value)}
          className={fieldClass}
        />
      </label>

      {error ? (
        <p className="rounded-lg bg-status-critical/10 px-3 py-2 text-sm text-ink-primary" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create link"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink-secondary hover:border-cat-blue hover:text-ink-primary"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function FormLinkPanel({
  data,
  links,
  formVersions,
  onChanged,
}: {
  data: DataBundle;
  links: FormLinkRecord[];
  formVersions: DriveFormVersionRecord[];
  onChanged: () => void | Promise<void>;
}) {
  const [creatingFor, setCreatingFor] = useState<string | null | undefined>(undefined);
  const [busyLinkId, setBusyLinkId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const schools = useMemo(() => getSchoolsForDrive(data), [data]);

  // school driveSchoolId -> its links; null key holds confidential-channel links.
  const bySchool = useMemo(() => {
    const map = new Map<string | null, FormLinkRecord[]>();
    for (const link of links) {
      const key = link.driveSchoolId;
      const list = map.get(key) ?? [];
      list.push(link);
      map.set(key, list);
    }
    return map;
  }, [links]);

  const confidentialLinks = bySchool.get(null) ?? [];

  async function handleCreate(input: {
    driveSchoolId: string;
    formVersionId: string;
    locale: string;
    label: string;
    opensAt: string | null;
    expiresAt: string | null;
    maxSubmissions: number | null;
  }): Promise<string | null> {
    setError(null);
    setNotice(null);
    const result = await createFormLink({
      driveId: data.drive.id,
      driveSchoolId: input.driveSchoolId,
      formVersionId: input.formVersionId,
      locale: input.locale,
      label: input.label,
      opensAt: input.opensAt,
      expiresAt: input.expiresAt,
      maxSubmissions: input.maxSubmissions,
    });
    if (!result.ok) return result.error;
    setCreatingFor(undefined);
    setNotice("Registration link created.");
    await onChanged();
    return null;
  }

  async function handleRevoke(link: FormLinkRecord) {
    const name = link.label ?? "this link";
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Revoke ${name}? Families who already have it will see "ask your counselor for a current link". This can't be undone.`
      )
    ) {
      return;
    }
    setError(null);
    setNotice(null);
    setBusyLinkId(link.id);
    const result = await revokeFormLink(link.id);
    setBusyLinkId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice("Link revoked.");
    await onChanged();
  }

  function renderSchoolGroup(driveSchoolId: string, name: string) {
    const schoolLinks = bySchool.get(driveSchoolId) ?? [];
    return (
      <div key={driveSchoolId} className="rounded-lg border border-gridline p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium text-ink-primary">{name}</h3>
          <button
            type="button"
            onClick={() => setCreatingFor(driveSchoolId)}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-ink-secondary hover:border-cat-blue hover:text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue"
          >
            New link
          </button>
        </div>

        {schoolLinks.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No registration link yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {schoolLinks.map((link) => (
              <LinkItem
                key={link.id}
                link={link}
                onRevoke={handleRevoke}
                busy={busyLinkId === link.id}
              />
            ))}
          </ul>
        )}

        {creatingFor === driveSchoolId ? (
          <CreateLinkForm
            data={data}
            formVersions={formVersions}
            initialDriveSchoolId={driveSchoolId}
            onCreate={handleCreate}
            onCancel={() => setCreatingFor(undefined)}
          />
        ) : null}
      </div>
    );
  }

  return (
    <section
      aria-labelledby="form-links-heading"
      className="rounded-xl border border-border bg-surface p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="form-links-heading" className="text-lg font-semibold text-ink-primary">
          Registration links
        </h2>
        <button
          type="button"
          onClick={() => setCreatingFor(null)}
          className="rounded-lg bg-cat-blue px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          New registration link
        </button>
      </div>
      <p className="mt-1 text-sm text-ink-secondary">
        Send these to a school counselor to pass on to families. Anyone with the link can register;
        nobody with it can read anything.
      </p>

      {notice ? (
        <p className="mt-3 rounded-lg bg-status-good/10 px-3 py-2 text-sm text-ink-primary">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 rounded-lg bg-status-critical/10 px-3 py-2 text-sm text-ink-primary" role="alert">
          {error}
        </p>
      ) : null}

      {creatingFor === null ? (
        <CreateLinkForm
          data={data}
          formVersions={formVersions}
          initialDriveSchoolId={null}
          onCreate={handleCreate}
          onCancel={() => setCreatingFor(undefined)}
        />
      ) : null}

      <div className="mt-4 space-y-4">
        {schools.length === 0 ? (
          <p className="text-sm text-ink-muted">
            This drive has no schools yet. Add one under Schools, then create its link here.
          </p>
        ) : (
          schools.map((s) => renderSchoolGroup(s.driveSchoolId, s.name))
        )}

        {confidentialLinks.length > 0 ? (
          <div className="rounded-lg border border-gridline p-4">
            <h3 className="font-medium text-ink-primary">
              {channelLabel(data, null).name}
            </h3>
            <p className="mt-1 text-xs text-ink-muted">
              The direct channel for families with no school referral. Created outside this screen.
            </p>
            <ul className="mt-3 space-y-3">
              {confidentialLinks.map((link) => (
                <LinkItem
                  key={link.id}
                  link={link}
                  onRevoke={handleRevoke}
                  busy={busyLinkId === link.id}
                />
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <p className="mt-4 border-t border-border pt-4 text-sm text-ink-secondary">
        <strong className="font-medium text-ink-primary">
          Counselor review links can&apos;t be shown here.
        </strong>{" "}
        A review link opens a roster of children&apos;s names, so its token is stored hashed and is
        shown exactly once, when it&apos;s issued. If a counselor loses theirs, issue a new one —
        the old one can&apos;t be recovered from the database by anyone.
      </p>
    </section>
  );
}
