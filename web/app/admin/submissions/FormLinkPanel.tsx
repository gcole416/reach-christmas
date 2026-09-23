"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  createFormLink,
  formPath,
  issueReviewLink,
  reviewLinkIsLive,
  revokeFormLink,
  sendCounselorRegistrationLink,
  sendCounselorReviewLink,
  type CounselorEmailRecord,
  type DriveFormVersionRecord,
  type FormLinkRecord,
  type ReviewLinkRecord,
} from "@/lib/intake";
import { useData } from "@/lib/store";
import { getSchoolsForDrive } from "@/lib/queries";
import type { DataBundle } from "@/lib/types";
import { formatDate } from "@/components/intake/format";
import { channelLabel } from "./shared";
import { CopyLinkButton } from "./CopyLinkButton";

/** Per-school pending-review counts (US-42), computed by the caller from the
 *  same `submissions` list SubmissionsQueue already loads — no extra query. */
export interface PendingReviewCounts {
  count: number;
  oldestIso: string | null;
}

// The staff surface for registration links (ADM-24, US-28): every link on
// screen, copyable, sendable by hand — the family form link AND the counselor
// review link — plus create/revoke.
//
// Grouped by school so "which of my schools has a link" is answerable at a
// glance. Confidentiality is handled entirely by RLS: an uncleared volunteer
// never gets a confidential-channel form_links or review_tokens row back, so
// there is no client-side filtering here and none to add.
//
// This UI only makes 'family' channel school links (a 'counselor'/'staff' link
// auto-verifies and its token is readable by every signed-in user — ADM-20).
// The counselor review link is stored plaintext as of US-28 so staff can
// re-copy it to re-send all season — see the 20260903120000 migration header
// for that trade-off.

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

const readonlyInputClass =
  "min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-ink-primary focus:ring-2 focus:ring-cat-blue focus:outline-none";

// The disclosure caret for the per-school dropdowns. Rotates when the parent
// <details class="group"> is open.
function Caret() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      className="size-4 shrink-0 text-ink-muted transition-transform group-open:rotate-180"
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function LinkItem({
  link,
  onRevoke,
  busy,
}: {
  link: FormLinkRecord;
  onRevoke: (link: FormLinkRecord) => void;
  busy: boolean;
}) {
  const state = linkState(link);
  const path = formPath(link.token);

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
          value={path}
          onFocus={(e) => e.currentTarget.select()}
          className={readonlyInputClass}
        />
        <CopyLinkButton path={path} />
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

// The counselor review link for one school. Unlike the family link, there is
// only ever one live one per school (issue_review_token is idempotent), so this
// is a single row, not a list — either "here it is, copy it" or "set one up".
function ReviewLinkRow({
  driveSchoolId,
  reviewLink,
  liaisonEmail,
  onIssue,
}: {
  driveSchoolId: string;
  reviewLink: ReviewLinkRecord | undefined;
  liaisonEmail: string | null;
  onIssue: (driveSchoolId: string, email: string) => Promise<string | null>;
}) {
  const [email, setEmail] = useState(liaisonEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const live = reviewLink && reviewLinkIsLive(reviewLink);

  async function issue(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError("Enter the counselor's email.");
      return;
    }
    setBusy(true);
    const message = await onIssue(driveSchoolId, email.trim());
    setBusy(false);
    if (message) setError(message);
  }

  if (live && reviewLink) {
    const path = `/review/${reviewLink.token}`;
    return (
      <div className="rounded-lg border border-gridline bg-background p-4">
        <p className="text-sm font-medium text-ink-primary">Counselor review link</p>
        <p className="mt-0.5 text-xs text-ink-muted">
          For {reviewLink.issuedToEmail}
          {reviewLink.expiresAt ? ` · expires ${formatDate(reviewLink.expiresAt)}` : ""}
          {reviewLink.lastUsedAt ? ` · last opened ${formatDate(reviewLink.lastUsedAt)}` : " · not opened yet"}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor={`review-${reviewLink.id}`} className="sr-only">
            Counselor review link
          </label>
          <input
            id={`review-${reviewLink.id}`}
            type="text"
            readOnly
            value={path}
            onFocus={(e) => e.currentTarget.select()}
            className={readonlyInputClass}
          />
          <CopyLinkButton path={path} label="Copy link" />
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          Re-send this same link to the counselor any time. It stays valid until it expires.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={issue} className="rounded-lg border border-gridline bg-background p-4">
      <p className="text-sm font-medium text-ink-primary">Counselor review link</p>
      <p className="mt-0.5 text-xs text-ink-muted">
        None yet. This is the link the school counselor opens to confirm the households that
        registered.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="block flex-1 text-sm">
          <span className="text-ink-secondary">Counselor email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="counselor@school.org"
            className={fieldClass}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create counselor link"}
        </button>
      </div>
      {error ? (
        <p className="mt-2 rounded-lg bg-status-critical/10 px-3 py-2 text-sm text-ink-primary" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

// One send-to-counselor action (US-41): "Email English link" / "Email Spanish
// link" / "Email review link". Three of these render per school — see the
// "Counselor email" block in renderSchoolGroup. Sending itself, and every
// notice/error, is handled by the parent (FormLinkPanel) the same way
// handleIssueReview/handleRevoke already work — this component is just the
// row and its own busy state.
function CounselorSendRow({
  label,
  hasLiveTarget,
  noTargetReason,
  liaisonEmail,
  lastSend,
  openedHint,
  busy,
  onSend,
}: {
  label: string;
  hasLiveTarget: boolean;
  /** Shown when there's nothing live to send yet (no liaison-email case is handled separately). */
  noTargetReason: string;
  liaisonEmail: string | null;
  lastSend: CounselorEmailRecord | undefined;
  /** "opened" / "not opened yet", or null when there's no such signal (registration links). */
  openedHint: string | null;
  busy: boolean;
  onSend: () => void;
}) {
  const hasLiaison = Boolean(liaisonEmail && liaisonEmail.trim());
  const disabled = busy || !hasLiaison || !hasLiveTarget;
  const reason = !hasLiaison
    ? "No liaison email on file for this school."
    : !hasLiveTarget
      ? noTargetReason
      : null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gridline bg-background px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-primary">{label}</p>
        <p className="mt-0.5 text-xs text-ink-muted">
          {lastSend ? `Emailed ${formatDate(lastSend.sentAt)} to ${lastSend.sentTo}` : "Not emailed yet"}
          {openedHint ? ` · ${openedHint}` : ""}
        </p>
        {reason ? <p className="mt-0.5 text-xs text-ink-muted">{reason}</p> : null}
      </div>
      <button
        type="button"
        onClick={onSend}
        disabled={disabled}
        className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-ink-secondary hover:border-cat-blue hover:text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue disabled:opacity-50"
      >
        {busy ? "Sending…" : "Email"}
      </button>
    </div>
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
    formVersionId: string | null;
    locale: string | null;
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
  const [expiresOn, setExpiresOn] = useState(isoToDateInput(data.drive.referralWindowEnd));
  const [maxSubmissions, setMaxSubmissions] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // formVersions is empty on a drive that has never had a link — createFormLink
  // publishes the standard questionnaire on the first one (ensureDriveFormVersion).
  const chosenVersion =
    formVersions.find((v) => v.formVersionId === formVersionId) ?? formVersions[0] ?? null;

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
      setError("Set an expiry date. A link with no end date is one of the spam controls we skip.");
      return;
    }
    if (opensAt && new Date(opensAt).getTime() >= new Date(expiresAt).getTime()) {
      setError("The open date has to be before the expiry date.");
      return;
    }

    setSubmitting(true);
    const message = await onCreate({
      driveSchoolId,
      formVersionId: chosenVersion?.formVersionId ?? null,
      locale: chosenVersion?.locale ?? null,
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

      {formVersions.length === 0 ? (
        <p className="text-xs text-ink-muted">
          Uses the standard Reach Christmas registration questionnaire. It&apos;s set up for this
          drive automatically when you create the first link.
        </p>
      ) : formVersions.length === 1 && chosenVersion ? (
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
                {v.formName} · v{v.version} ({v.locale})
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="block text-sm">
        <span className="text-ink-secondary">Label (optional, shown to staff, not households)</span>
        <input
          type="text"
          value={label}
          maxLength={120}
          placeholder={
            chosenVersion
              ? `e.g. "${chosenVersion.formName} · ${chosenVersion.locale}"`
              : 'e.g. "OneLife Elementary · English"'
          }
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
  reviewLinks,
  formVersions,
  counselorEmails,
  pendingBySchool,
  onChanged,
}: {
  data: DataBundle;
  links: FormLinkRecord[];
  reviewLinks: ReviewLinkRecord[];
  formVersions: DriveFormVersionRecord[];
  /** US-41 send log, newest first (as listCounselorEmails returns it). */
  counselorEmails: CounselorEmailRecord[];
  /** US-42: per-school pending-review counts, computed by the caller from the
   *  submissions list it already has loaded. */
  pendingBySchool: Map<string, PendingReviewCounts>;
  onChanged: () => void | Promise<void>;
}) {
  const { setSchoolDigestPaused } = useData();
  const [creatingFor, setCreatingFor] = useState<string | null | undefined>(undefined);
  const [busyLinkId, setBusyLinkId] = useState<string | null>(null);
  // Keyed "<driveSchoolId>:<kind>:<locale>" (locale omitted for review sends).
  const [busySendKey, setBusySendKey] = useState<string | null>(null);
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

  // At most one live review link per school (issue_review_token is idempotent),
  // so a plain lookup by school is enough. Prefer a live one if somehow >1.
  const reviewBySchool = useMemo(() => {
    const map = new Map<string, ReviewLinkRecord>();
    for (const rl of reviewLinks) {
      if (!rl.driveSchoolId) continue;
      const current = map.get(rl.driveSchoolId);
      if (!current || (reviewLinkIsLive(rl) && !reviewLinkIsLive(current))) {
        map.set(rl.driveSchoolId, rl);
      }
    }
    return map;
  }, [reviewLinks]);

  const confidentialLinks = bySchool.get(null) ?? [];

  // Newest-first per school (listCounselorEmails already orders this way, and
  // grouping preserves that order) — CounselorSendRow's `.find` below picks
  // up the most recent send for a given kind/locale.
  const emailsBySchool = useMemo(() => {
    const map = new Map<string, CounselorEmailRecord[]>();
    for (const e of counselorEmails) {
      if (!e.driveSchoolId) continue;
      const list = map.get(e.driveSchoolId) ?? [];
      list.push(e);
      map.set(e.driveSchoolId, list);
    }
    return map;
  }, [counselorEmails]);

  async function handleSendRegistration(driveSchoolId: string, locale: string) {
    setError(null);
    setNotice(null);
    const key = `${driveSchoolId}:registration_link:${locale}`;
    setBusySendKey(key);
    const result = await sendCounselorRegistrationLink(driveSchoolId, locale);
    setBusySendKey(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice("Registration link emailed to the counselor.");
    await onChanged();
  }

  async function handleSendReview(driveSchoolId: string) {
    setError(null);
    setNotice(null);
    const key = `${driveSchoolId}:review_link`;
    setBusySendKey(key);
    const result = await sendCounselorReviewLink(driveSchoolId);
    setBusySendKey(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice("Review link emailed to the counselor.");
    await onChanged();
  }

  async function handleToggleDigest(driveSchoolId: string, paused: boolean) {
    setError(null);
    const result = await setSchoolDigestPaused(driveSchoolId, paused);
    if (!result.ok) setError(result.error);
  }

  async function handleCreate(input: {
    driveSchoolId: string;
    formVersionId: string | null;
    locale: string | null;
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

  async function handleIssueReview(driveSchoolId: string, email: string): Promise<string | null> {
    setError(null);
    setNotice(null);
    const result = await issueReviewLink({ driveSchoolId, issuedToEmail: email });
    if (!result.ok) return result.error;
    setNotice(result.reused ? "Counselor link is ready to copy." : "Counselor review link created.");
    await onChanged();
    return null;
  }

  async function handleRevoke(link: FormLinkRecord) {
    const name = link.label ?? "this link";
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Revoke ${name}? Households who already have it will see "ask your counselor for a current link". This can't be undone.`
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

  function renderSchoolGroup(
    driveSchoolId: string,
    name: string,
    liaisonEmail: string | null,
    digestPaused: boolean
  ) {
    const schoolLinks = bySchool.get(driveSchoolId) ?? [];
    const liveFamily = schoolLinks.filter((l) => linkState(l).live).length;
    const review = reviewBySchool.get(driveSchoolId);
    const hasLiveReview = Boolean(review && reviewLinkIsLive(review));

    const emails = emailsBySchool.get(driveSchoolId) ?? [];
    const hasLiveEnglish = schoolLinks.some((l) => l.locale === "en" && linkState(l).live);
    const hasLiveSpanish = schoolLinks.some((l) => l.locale === "es" && linkState(l).live);
    const lastEnglishSend = emails.find((e) => e.kind === "registration_link" && e.locale === "en");
    const lastSpanishSend = emails.find((e) => e.kind === "registration_link" && e.locale === "es");
    const lastReviewSend = emails.find((e) => e.kind === "review_link");
    const reviewOpenedHint = review ? (review.lastUsedAt ? "opened" : "not opened yet") : null;
    const pending = pendingBySchool.get(driveSchoolId);

    const bits: string[] = [];
    if (schoolLinks.length > 0) {
      bits.push(
        liveFamily > 0
          ? `${liveFamily} household link${liveFamily > 1 ? "s" : ""}`
          : "household link (inactive)"
      );
    }
    if (hasLiveReview) bits.push("counselor link");
    const status = bits.length > 0 ? bits.join(" · ") : "Not set up yet";

    return (
      <details
        key={driveSchoolId}
        data-school-group={driveSchoolId}
        className="group rounded-lg border border-gridline"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg p-4 hover:bg-ink-muted/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">
            <span className="font-medium text-ink-primary">{name}</span>
            <span className="ml-2 text-xs text-ink-muted">{status}</span>
          </span>
          <Caret />
        </summary>

        <div className="space-y-3 border-t border-gridline p-4">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setCreatingFor(driveSchoolId)}
              className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-ink-secondary hover:border-cat-blue hover:text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue"
            >
              New link
            </button>
          </div>

          {schoolLinks.length === 0 ? (
            <p className="text-sm text-ink-muted">No household registration link yet.</p>
          ) : (
            <ul className="space-y-3">
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

          <ReviewLinkRow
            driveSchoolId={driveSchoolId}
            reviewLink={review}
            liaisonEmail={liaisonEmail}
            onIssue={handleIssueReview}
          />

          <div className="space-y-2 rounded-lg border border-gridline bg-background p-3">
            <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">
              Counselor email
            </p>
            <div className="space-y-2">
              <CounselorSendRow
                label="Email English registration link"
                hasLiveTarget={hasLiveEnglish}
                noTargetReason="No live English registration link for this school yet."
                liaisonEmail={liaisonEmail}
                lastSend={lastEnglishSend}
                openedHint={null}
                busy={busySendKey === `${driveSchoolId}:registration_link:en`}
                onSend={() => handleSendRegistration(driveSchoolId, "en")}
              />
              <CounselorSendRow
                label="Email Spanish registration link"
                hasLiveTarget={hasLiveSpanish}
                noTargetReason="No live Spanish registration link for this school yet."
                liaisonEmail={liaisonEmail}
                lastSend={lastSpanishSend}
                openedHint={null}
                busy={busySendKey === `${driveSchoolId}:registration_link:es`}
                onSend={() => handleSendRegistration(driveSchoolId, "es")}
              />
              <CounselorSendRow
                label="Email review link"
                hasLiveTarget={hasLiveReview}
                noTargetReason="Create a counselor review link above first."
                liaisonEmail={liaisonEmail}
                lastSend={lastReviewSend}
                openedHint={reviewOpenedHint}
                busy={busySendKey === `${driveSchoolId}:review_link`}
                onSend={() => handleSendReview(driveSchoolId)}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gridline pt-2">
              {pending && pending.count > 0 ? (
                <p className="text-xs text-ink-secondary">
                  {pending.count} household{pending.count > 1 ? "s" : ""} waiting since{" "}
                  {formatDate(pending.oldestIso)}
                </p>
              ) : (
                <p className="text-xs text-ink-muted">Nothing waiting on this counselor right now.</p>
              )}
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-ink-secondary">
                <input
                  type="checkbox"
                  checked={digestPaused}
                  onChange={(e) => handleToggleDigest(driveSchoolId, e.target.checked)}
                  className="size-3.5 rounded border-border"
                />
                Pause daily digest for this school
              </label>
            </div>
          </div>

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
      </details>
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
        Each school gets a <strong className="font-medium text-ink-primary">household link</strong>{" "}
        (the counselor passes it to households to register) and a{" "}
        <strong className="font-medium text-ink-primary">counselor review link</strong> (the
        counselor opens it to confirm those households). Re-send either as often as you need.
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
          schools.map((s) =>
            renderSchoolGroup(s.driveSchoolId, s.name, s.liaisonEmail, s.digestPaused)
          )
        )}

        {confidentialLinks.length > 0 ? (
          <details className="group rounded-lg border border-gridline">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg p-4 hover:bg-ink-muted/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue [&::-webkit-details-marker]:hidden">
              <span className="font-medium text-ink-primary">{channelLabel(data, null).name}</span>
              <Caret />
            </summary>
            <div className="border-t border-gridline p-4">
              <p className="text-xs text-ink-muted">
                The direct channel for households with no school referral. Created outside this screen.
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
          </details>
        ) : null}
      </div>

      <p className="mt-4 border-t border-border pt-4 text-xs text-ink-muted">
        A counselor review link opens a roster of children&apos;s first names, ages, and grades for
        that school. Treat it like a password, and send it to the counselor only.
      </p>
    </section>
  );
}
