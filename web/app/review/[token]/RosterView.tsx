"use client";

import { useState } from "react";
import type { CorrectionFields, RosterSubmission } from "@/lib/intake";
import { formatDate } from "@/components/intake/format";
import { PublicCard, PublicMasthead, PublicPage, QuietNote } from "@/components/intake/PublicShell";
import { RosterCard } from "./RosterCard";

// The counselor's season-long roster for one school (US-22).
//
// WHAT IS NOT HERE, and is not in the network response either: wishlist items,
// sizes, specific needs, other notes, and the guardian's name/phone/email.
// get_review_roster returns first name / age / grade per child and nothing
// else — the payload is the boundary, so there is nothing to filter in this
// file and nothing may be fetched from anywhere else to fill it in.

export function isPending(submission: RosterSubmission): boolean {
  return submission.status === "submitted" || submission.status === "under_review";
}

export function RosterView({
  reviewToken,
  schoolName,
  expiresAt,
  correctionFields,
  initialSubmissions,
}: {
  reviewToken: string;
  schoolName: string | null;
  expiresAt: string | null;
  /**
   * The pinned form definition's rule for each of the three fields a counselor
   * may correct. Passed straight through to every card, which builds its edit
   * controls from it — the page states none of these rules itself.
   */
  correctionFields: CorrectionFields;
  initialSubmissions: RosterSubmission[];
}) {
  const [submissions, setSubmissions] = useState<RosterSubmission[]>(initialSubmissions);
  // Remembered across cards so a counselor confirming four families types
  // their name once. Each card still asks — the typed name is the attestation,
  // so it is always shown and always editable before confirming.
  const [verifierName, setVerifierName] = useState("");

  function replace(updated: RosterSubmission) {
    setSubmissions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }

  const waiting = submissions.filter(isPending);
  const handled = submissions.filter((s) => !isPending(s));

  return (
    <PublicPage wide>
      <PublicMasthead title="Confirm your families" schoolName={schoolName}>
        <p>
          These families registered for the Reach Christmas gift drive and named your school.
          You&apos;re confirming that they&apos;re real families you referred and that the children
          listed look right — nothing more.
        </p>
      </PublicMasthead>

      <QuietNote>
        You only see each child&apos;s first name, age, and grade. Gift lists, sizes, and family
        contact details aren&apos;t shown here, on purpose.
        {expiresAt ? ` This link works until ${formatDate(expiresAt)}.` : ""}
      </QuietNote>

      <p className="mt-4 text-sm font-medium text-ink-secondary">
        {submissions.length === 0
          ? "No families yet"
          : `${waiting.length} waiting on you · ${handled.length} already handled`}
      </p>

      {submissions.length === 0 ? (
        <div className="mt-4">
          <PublicCard>
            <h2 className="text-lg font-semibold text-ink-primary">Nothing to confirm yet</h2>
            <p className="mt-2 text-ink-secondary">
              When a family from your school registers, they&apos;ll appear here. Check back after
              you&apos;ve shared the registration link.
            </p>
          </PublicCard>
        </div>
      ) : null}

      {waiting.length > 0 ? (
        <section aria-labelledby="waiting-heading" className="mt-8">
          <h2 id="waiting-heading" className="text-lg font-semibold text-ink-primary">
            Waiting on you
          </h2>
          <div className="mt-3 space-y-4">
            {waiting.map((submission) => (
              <RosterCard
                key={submission.id}
                reviewToken={reviewToken}
                submission={submission}
                correctionFields={correctionFields}
                verifierName={verifierName}
                onVerifierNameChange={setVerifierName}
                onUpdated={replace}
              />
            ))}
          </div>
        </section>
      ) : null}

      {handled.length > 0 ? (
        <section aria-labelledby="handled-heading" className="mt-8">
          <h2 id="handled-heading" className="text-lg font-semibold text-ink-primary">
            Already handled
          </h2>
          <div className="mt-3 space-y-4">
            {handled.map((submission) => (
              <RosterCard
                key={submission.id}
                reviewToken={reviewToken}
                submission={submission}
                correctionFields={correctionFields}
                verifierName={verifierName}
                onVerifierNameChange={setVerifierName}
                onUpdated={replace}
              />
            ))}
          </div>
        </section>
      ) : null}

      <p className="mt-8 text-sm text-ink-muted print:hidden">
        Questions about a family on this list? Contact Reach Church — please don&apos;t forward this
        link.
      </p>
    </PublicPage>
  );
}
