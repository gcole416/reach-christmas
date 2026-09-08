"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useData } from "@/lib/store";
import {
  effectiveSize,
  getSubmission,
  importSubmission,
  type ChildCorrection,
  type ImportSubmissionResult,
  type IntakeChildAnswer,
  type SubmissionRecord,
} from "@/lib/intake";
import { childCountLabel, formatDateTime } from "@/components/intake/format";
import { SubmissionStatusBadge } from "@/components/intake/SubmissionStatusBadge";
import { channelLabel, guardianName } from "../shared";

// One registration in full, for staff (US-23).
//
// This surface DOES show the wish list, sizes, and notes — it is behind
// AdminGate and RLS, and staff need them to sanity-check an import. The
// counselor's roster is the one that must not.
//
// `answers` and `corrections` are rendered as two separate things and never
// merged into one value on screen: `answers` is the family's own words and is
// never rewritten, so a counselor's typo fix has to read as a fix.

const FAMILY_ORDER = ["guardian_name", "guardian_phone", "guardian_email", "preferred_language"];
const PICKUP_ORDER = ["can_reach_church_pickup", "consent"];
const CHILD_HANDLED = new Set([
  "first_name",
  "age",
  "grade",
  "sex",
  "shirt_size",
  "shirt_size_other",
  "pant_size",
  "pant_size_other",
  "shoe_size",
  "shoe_size_other",
  "wishlist",
  "specific_needs",
  "other_notes",
]);

const LABELS: Record<string, string> = {
  guardian_name: "Parent or guardian",
  guardian_phone: "Phone",
  guardian_email: "Email",
  preferred_language: "Preferred language",
  can_reach_church_pickup: "Can get to church pickup",
  consent: "Consent given",
  first_name: "First name",
  age: "Age",
  grade: "Grade",
  sex: "Boy or girl",
  specific_needs: "Especially needs",
  other_notes: "Other notes",
};

function labelFor(key: string): string {
  if (LABELS[key]) return LABELS[key];
  const words = key.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// The two locale codes the form stores, spelled out. Scoped to that one field
// on purpose — a blanket value map would rewrite a child's answer that
// happened to read "es".
const LANGUAGE_NAMES: Record<string, string> = { en: "English", es: "Español" };

function displayValue(value: unknown, key?: string): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.filter(Boolean).join(", ") || "—";
  const text = String(value);
  if (key === "preferred_language") return LANGUAGE_NAMES[text] ?? text;
  return text;
}

/** Known keys first, in the order staff read them; anything unexpected after. */
function orderedKeys(values: Record<string, unknown>, known: string[]): string[] {
  const rest = Object.keys(values).filter((key) => !known.includes(key));
  return [...known.filter((key) => key in values), ...rest];
}

export function SubmissionDetail({ submissionId }: { submissionId: string }) {
  const { data, viewerRole, refresh } = useData();
  const [submission, setSubmission] = useState<SubmissionRecord | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await getSubmission(submissionId);
    if (!result.ok) {
      setLoadError(result.error);
      return;
    }
    setSubmission(result.submission);
  }, [submissionId]);

  useEffect(() => {
    // Fetching from Supabase on mount — the sanctioned "sync from an external
    // system" exception to the no-setState-in-effect rule.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (loadError) {
    return (
      <div className="rounded-lg bg-status-critical/10 px-4 py-3 text-sm text-ink-primary">
        {loadError}
      </div>
    );
  }
  if (!data || !submission) {
    return <p className="text-ink-secondary">Loading registration…</p>;
  }

  const source = channelLabel(data, submission.driveSchoolId);
  const family = (submission.answers.family ?? {}) as Record<string, unknown>;
  const pickup = (submission.answers.pickup_consent ?? {}) as Record<string, unknown>;
  const children = Array.isArray(submission.answers.children) ? submission.answers.children : [];
  const correctionEntries = Object.entries(submission.corrections);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-ink-primary">{guardianName(submission)}</h2>
            <p className="mt-1 text-sm text-ink-secondary">
              {source.name} · {childCountLabel(submission.childCount)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {source.confidential ? (
              <span className="rounded-full bg-cat-violet/10 px-2.5 py-1 text-xs font-medium text-ink-primary">
                Confidential referral
              </span>
            ) : null}
            <SubmissionStatusBadge status={submission.status} audience="staff" />
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 border-t border-border pt-4 text-sm sm:grid-cols-2">
          <Trail label="Registered" value={formatDateTime(submission.submittedAt)} />
          <Trail label="First seen by counselor" value={formatDateTime(submission.firstViewedAt)} />
          <Trail
            label="Confirmed"
            value={
              submission.verifiedAt
                ? `${formatDateTime(submission.verifiedAt)}${
                    submission.verifiedByLabel ? ` by ${submission.verifiedByLabel}` : ""
                  }`
                : "—"
            }
          />
          <Trail label="Imported" value={formatDateTime(submission.importedAt)} />
        </dl>

        {submission.resolutionNote ? (
          <p className="mt-4 rounded-lg bg-status-warning/10 px-3 py-2 text-sm text-ink-primary">
            <span className="font-medium">Counselor&apos;s note:</span> {submission.resolutionNote}
          </p>
        ) : null}
      </section>

      <ImportPanel
        submission={submission}
        confidentialChannel={source.confidential}
        viewerIsAdmin={viewerRole === "admin"}
        onImported={async (result) => {
          setSubmission((prev) =>
            prev ? { ...prev, status: "imported", importedFamilyId: result.familyId } : prev
          );
          // So the new family is present the moment staff follow the link into
          // the Families Explorer.
          await refresh();
        }}
      />

      {correctionEntries.length > 0 ? (
        <section
          aria-labelledby="corrections-heading"
          className="rounded-xl border border-cat-yellow/40 bg-cat-yellow/5 p-5"
        >
          <h2 id="corrections-heading" className="text-lg font-semibold text-ink-primary">
            Counselor corrections
          </h2>
          <p className="mt-1 text-sm text-ink-secondary">
            The household&apos;s answers below are shown exactly as they were submitted. These fixes
            are applied when you import.
          </p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {correctionEntries.map(([position, fix]) => {
              const child = children[Number(position) - 1] ?? {};
              return (
                <li key={position}>
                  <span className="font-medium text-ink-primary">Child {position}:</span>{" "}
                  {describeCorrection(child, fix)}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section
        aria-labelledby="family-heading"
        className="rounded-xl border border-border bg-surface p-5"
      >
        <h2 id="family-heading" className="text-lg font-semibold text-ink-primary">
          About the household
        </h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {orderedKeys(family, FAMILY_ORDER).map((key) => (
            <Row key={key} label={labelFor(key)} value={displayValue(family[key], key)} />
          ))}
          {orderedKeys(pickup, PICKUP_ORDER).map((key) => (
            <Row key={key} label={labelFor(key)} value={displayValue(pickup[key])} />
          ))}
        </dl>
      </section>

      <section aria-labelledby="children-heading">
        <h2 id="children-heading" className="text-lg font-semibold text-ink-primary">
          Children
        </h2>
        <div className="mt-3 space-y-4">
          {children.map((child, index) => (
            <ChildBlock
              key={index}
              index={index}
              child={child}
              correction={submission.corrections[index + 1]}
            />
          ))}
          {children.length === 0 ? (
            <p className="rounded-xl border border-border bg-surface p-5 text-sm text-ink-secondary">
              This registration has no children on it.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Trail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-ink-primary">{value}</dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-ink-muted uppercase">{label}</dt>
      <dd className="mt-0.5 text-ink-primary">{value}</dd>
    </div>
  );
}

function describeCorrection(child: IntakeChildAnswer, fix: ChildCorrection): string {
  const parts: string[] = [];
  if (fix.firstName !== undefined)
    parts.push(`first name “${displayValue(child.first_name)}” → “${fix.firstName}”`);
  if (fix.age !== undefined) parts.push(`age ${displayValue(child.age)} → ${fix.age}`);
  if (fix.grade !== undefined)
    parts.push(`grade “${displayValue(child.grade)}” → “${fix.grade}”`);
  return parts.join("; ");
}

function CorrectableRow({
  label,
  original,
  corrected,
}: {
  label: string;
  original: unknown;
  corrected: string | number | undefined;
}) {
  const changed = corrected !== undefined && String(corrected) !== String(original ?? "");
  return (
    <div>
      <dt className="text-xs tracking-wide text-ink-muted uppercase">{label}</dt>
      <dd className="mt-0.5 text-ink-primary">
        {changed ? (
          <>
            <span className="text-ink-muted line-through">{displayValue(original)}</span>{" "}
            <span className="font-medium">{displayValue(corrected)}</span>{" "}
            <span className="rounded-full bg-cat-yellow/20 px-2 py-0.5 text-xs font-medium whitespace-nowrap">
              counselor fix
            </span>
          </>
        ) : (
          displayValue(original)
        )}
      </dd>
    </div>
  );
}

function SizeRow({ label, child, which }: {
  label: string;
  child: IntakeChildAnswer;
  which: "shirt_size" | "pant_size" | "shoe_size";
}) {
  const value = effectiveSize(child, which);
  const described = Boolean(
    typeof child[`${which}_other`] === "string" && (child[`${which}_other`] as string).trim()
  );
  return (
    <div>
      <dt className="text-xs tracking-wide text-ink-muted uppercase">{label}</dt>
      <dd className="mt-0.5 text-ink-primary">
        {value ?? "—"}
        {described ? <span className="ml-1.5 text-xs text-ink-muted">(described)</span> : null}
      </dd>
    </div>
  );
}

function ChildBlock({
  index,
  child,
  correction,
}: {
  index: number;
  child: IntakeChildAnswer;
  correction?: ChildCorrection;
}) {
  const wishlist = Array.isArray(child.wishlist)
    ? child.wishlist.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
  const extras = Object.keys(child).filter((key) => !CHILD_HANDLED.has(key));

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <h3 className="text-base font-semibold text-ink-primary">Child {index + 1}</h3>

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
        <CorrectableRow
          label="First name"
          original={child.first_name}
          corrected={correction?.firstName}
        />
        <CorrectableRow label="Age" original={child.age} corrected={correction?.age} />
        <CorrectableRow label="Grade" original={child.grade} corrected={correction?.grade} />
        <Row label="Boy or girl" value={displayValue(child.sex)} />
        <SizeRow label="Shirt" child={child} which="shirt_size" />
        <SizeRow label="Pant" child={child} which="pant_size" />
        <SizeRow label="Shoe" child={child} which="shoe_size" />
      </dl>

      <div className="mt-4 border-t border-border pt-4">
        <p className="text-xs tracking-wide text-ink-muted uppercase">Wish list</p>
        {wishlist.length > 0 ? (
          <ol className="mt-1 list-inside list-decimal space-y-0.5 text-sm text-ink-primary">
            {wishlist.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ol>
        ) : (
          <p className="mt-1 text-sm text-ink-secondary">—</p>
        )}
      </div>

      {(child.specific_needs || child.other_notes || extras.length > 0) && (
        <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-border pt-4 text-sm">
          {child.specific_needs ? (
            <Row label="Especially needs" value={displayValue(child.specific_needs)} />
          ) : null}
          {child.other_notes ? (
            <Row label="Other notes" value={displayValue(child.other_notes)} />
          ) : null}
          {extras.map((key) => (
            <Row key={key} label={labelFor(key)} value={displayValue(child[key])} />
          ))}
        </dl>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

const WAITING_STATUSES = new Set(["submitted", "under_review"]);

function ImportPanel({
  submission,
  confidentialChannel,
  viewerIsAdmin,
  onImported,
}: {
  submission: SubmissionRecord;
  confidentialChannel: boolean;
  viewerIsAdmin: boolean;
  onImported: (result: Extract<ImportSubmissionResult, { ok: true }>) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [markConfidential, setMarkConfidential] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<ImportSubmissionResult, { ok: true }> | null>(null);

  async function handleImport() {
    if (busy || result) return;
    setBusy(true);
    setError(null);

    // Omitting `isConfidential` is the documented "inherit from the channel"
    // default, which is right for both a school submission (ordinary family)
    // and a confidential-channel one (confidential family). Only an explicit
    // tick sends `true`, so an unticked box never DOWNGRADES a confidential
    // referral.
    const response = await importSubmission(
      submission.id,
      markConfidential ? { isConfidential: true } : undefined
    );
    setBusy(false);

    if (!response.ok) {
      setError(
        response.reason === "forbidden"
          ? "Only an admin can import a registration. Ask a staff admin to do this one."
          : response.error
      );
      return;
    }

    // `alreadyImported: true` is a SUCCESS, not an error — a double-click, a
    // retry, or two admins at once all land here with the family that already
    // exists. Treated identically to a fresh import, which is what makes the
    // double-click case correct in the UI as well as in the database.
    setResult(response);
    setConfirming(false);
    onImported(response);
  }

  if (submission.status === "imported" || result) {
    const familyId = result?.familyId ?? submission.importedFamilyId;
    return (
      <section className="rounded-xl border border-status-good/40 bg-status-good/5 p-5">
        <h2 className="text-lg font-semibold text-ink-primary">
          {result?.alreadyImported ? "Already imported" : "Imported"}
        </h2>
        <p className="mt-1 text-sm text-ink-secondary">
          {result
            ? result.alreadyImported
              ? "This registration had already been imported. Here's the household it created; no second household was made."
              : `Created Household ${result.familyNumber ?? "?"} with ${childCountLabel(result.childrenCreated)}.`
            : "This registration is already a household in the drive."}
          {result?.isConfidential ? " Imported as a confidential household." : ""}
        </p>
        {familyId ? (
          <Link
            href={`/admin/families/${familyId}`}
            className="mt-4 inline-block rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue focus-visible:ring-offset-2"
          >
            Open the household
          </Link>
        ) : null}
      </section>
    );
  }

  if (WAITING_STATUSES.has(submission.status)) {
    return (
      <section className="rounded-xl border border-status-warning/40 bg-status-warning/10 p-5">
        <h2 className="text-lg font-semibold text-ink-primary">Waiting on the counselor</h2>
        <p className="mt-1 text-sm text-ink-secondary">
          You can import this once the school counselor confirms it on their review link. Until
          then there&apos;s nothing to do here — Reach doesn&apos;t create a household from a
          registration nobody has vouched for.
        </p>
      </section>
    );
  }

  if (submission.status === "rejected" || submission.status === "duplicate") {
    return (
      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold text-ink-primary">
          {submission.status === "duplicate" ? "Marked a duplicate" : "Not approved"}
        </h2>
        <p className="mt-1 text-sm text-ink-secondary">
          The counselor didn&apos;t approve this registration, so it can&apos;t be imported.
        </p>
      </section>
    );
  }

  // status === "verified"
  return (
    <section className="rounded-xl border border-cat-blue/40 bg-cat-blue/5 p-5">
      <h2 className="text-lg font-semibold text-ink-primary">Ready to import</h2>
      <p className="mt-1 text-sm text-ink-secondary">
        Importing creates the household, its children, and their cards in this drive, exactly as if
        someone had entered them by hand.
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-status-critical/10 px-3 py-2 text-sm font-medium text-ink-primary"
        >
          {error}
        </p>
      ) : null}

      {!viewerIsAdmin ? (
        <p className="mt-4 rounded-lg bg-ink-muted/10 px-3 py-2 text-sm text-ink-primary">
          Importing is admin-only. Ask a staff admin to import this one.
        </p>
      ) : !confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-4 rounded-lg bg-cat-blue px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue focus-visible:ring-offset-2"
        >
          Import this household
        </button>
      ) : (
        <div className="mt-4 rounded-lg border border-border bg-surface p-4">
          {confidentialChannel ? (
            <p className="text-sm text-ink-primary">
              This came in through the confidential channel, so it will be created as a{" "}
              <strong className="font-medium">confidential household</strong> — visible only to staff
              with confidential clearance.
            </p>
          ) : (
            <>
              <div className="flex items-start gap-2.5">
                <input
                  id="import-confidential"
                  type="checkbox"
                  checked={markConfidential}
                  onChange={(e) => setMarkConfidential(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 rounded border border-border accent-cat-blue focus:ring-2 focus:ring-cat-blue focus:outline-none"
                />
                <label htmlFor="import-confidential" className="text-sm text-ink-primary">
                  Create this as a <strong className="font-medium">confidential household</strong>
                </label>
              </div>
              <p className="mt-2 pl-7 text-sm text-ink-secondary">
                Set it here, not afterwards. A household imported normally and edited later is
                readable by every volunteer in between.
              </p>
            </>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={handleImport}
              className="rounded-lg bg-cat-blue px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Importing…" : "Import now"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-ink-secondary underline underline-offset-4 hover:text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
