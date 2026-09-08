import type { ReactNode } from "react";
import type { FormLinkProblem, ReviewTokenProblem } from "@/lib/intake";
import { friendlyMessage } from "./format";

// The chrome the two PUBLIC intake surfaces share — the family form
// (/form/[token]) and the counselor roster (/review/[token]).
//
// Both routes live outside app/admin, so nothing here may import AdminGate,
// the store, or anything else that assumes a session. It is deliberately all
// presentational.
//
// The measure is capped near 60ch for the form and a little wider for the
// roster: this is a page a parent reads on a phone and a counselor skims on a
// laptop, and neither is served by full-bleed text.

export function PublicPage({
  children,
  wide = false,
}: {
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={`mx-auto w-full ${wide ? "max-w-3xl" : "max-w-2xl"} px-4 py-8 sm:px-6 sm:py-12`}
    >
      {children}
    </div>
  );
}

export function PublicCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-8 print:border-0 print:shadow-none ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * The warm banner both public pages open with: who is asking, and which
 * school this link belongs to. Showing the school back is the reassurance
 * US-21 asks for in place of a school question the family would have to answer
 * (and could get wrong).
 */
export function PublicMasthead({
  title,
  schoolName,
  children,
}: {
  title: string;
  schoolName?: string | null;
  children?: ReactNode;
}) {
  return (
    <header className="mb-6">
      {schoolName ? (
        <p className="text-sm font-medium tracking-wide text-cat-yellow uppercase">
          {schoolName}
        </p>
      ) : null}
      <h1 className="mt-1 text-2xl leading-tight font-semibold tracking-tight text-ink-primary sm:text-3xl">
        {title}
      </h1>
      {children ? <div className="mt-3 text-ink-secondary">{children}</div> : null}
    </header>
  );
}

/** A calm, warm-tinted aside — the privacy note, the "what happens next" line. */
export function QuietNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl bg-cat-yellow/10 px-4 py-3 text-sm leading-relaxed text-ink-secondary">
      {children}
    </p>
  );
}

export function PublicLoading({ label }: { label: string }) {
  return (
    <PublicPage>
      <div
        role="status"
        aria-live="polite"
        className="rounded-2xl border border-border bg-surface px-5 py-10 text-center text-ink-secondary"
      >
        {label}
      </div>
    </PublicPage>
  );
}

// ---------------------------------------------------------------------------
// Dead-link states
//
// The server writes the sentence; `reason` only picks the heading and the
// "what do I do now" line. friendlyMessage() is the guard that keeps a raw
// Postgres string off a family's screen if something unexpected surfaces.
// ---------------------------------------------------------------------------

const FORM_PROBLEM_COPY: Record<FormLinkProblem, { heading: string; body: string; next: string }> =
  {
    not_found: {
      heading: "This registration link isn't active",
      body: "We couldn't find this link. It may have been replaced with a newer one.",
      next: "Ask your school counselor for a current link.",
    },
    expired: {
      heading: "Registration has closed",
      body: "This link is no longer accepting registrations.",
      next: "If you still need to register, contact your school counselor.",
    },
    not_yet_open: {
      heading: "Registration hasn't opened yet",
      body: "This link isn't open for registrations at the moment.",
      next: "Please check back, or ask your school counselor when it opens.",
    },
    full: {
      heading: "This school's list is full",
      body: "This link has reached the number of households it can accept.",
      next: "Please contact your school counselor, who can tell you what's next.",
    },
    unpublished: {
      heading: "This form isn't ready yet",
      body: "This registration form hasn't been published.",
      next: "Ask your school counselor for a current link.",
    },
    drive_closed: {
      heading: "This year's drive has closed",
      body: "Registration for this gift drive is finished.",
      next: "Your school counselor can tell you about next year.",
    },
    unknown: {
      heading: "We couldn't open this form",
      body: "Something went wrong loading this registration form.",
      next: "Please try again in a few minutes, or ask your school counselor for a current link.",
    },
  };

export function FormLinkClosed({
  reason,
  error,
}: {
  reason: FormLinkProblem;
  error: string;
}) {
  const copy = FORM_PROBLEM_COPY[reason] ?? FORM_PROBLEM_COPY.unknown;
  // Every failure get_form RETURNS carries a real reason. `unknown` therefore
  // means the string came from a transport or Postgres error instead — a
  // family must never read one of those, so it is dropped rather than
  // filtered. friendlyMessage() is the second line of defence on the rest.
  const body = reason === "unknown" ? copy.body : friendlyMessage(error, copy.body);
  return (
    <PublicPage>
      <PublicCard>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-primary">{copy.heading}</h1>
        <p className="mt-3 text-ink-secondary">{body}</p>
        <p className="mt-4 rounded-xl bg-cat-yellow/10 px-4 py-3 text-sm text-ink-secondary">
          {copy.next}
        </p>
      </PublicCard>
    </PublicPage>
  );
}

const REVIEW_PROBLEM_COPY: Record<ReviewTokenProblem, string> = {
  not_found: "This review link is no longer active.",
  unsupported: "This review link can't be opened.",
  unknown: "We couldn't open this review list.",
};

export function ReviewLinkClosed({
  reason,
  error,
}: {
  reason: ReviewTokenProblem;
  error: string;
}) {
  return (
    <PublicPage wide>
      <PublicCard>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-primary">
          This link is no longer active
        </h1>
        <p className="mt-3 text-ink-secondary">
          {/* Same rule as FormLinkClosed: `unknown` means the string is not one
              get_review_roster wrote for a counselor, so it isn't shown. */}
          {reason === "unknown"
            ? REVIEW_PROBLEM_COPY.unknown
            : friendlyMessage(error, REVIEW_PROBLEM_COPY[reason] ?? REVIEW_PROBLEM_COPY.unknown)}
        </p>
        <p className="mt-4 rounded-xl bg-cat-yellow/10 px-4 py-3 text-sm text-ink-secondary">
          Ask Reach Church for a new review link, and they can issue you a fresh one. For your
          households&apos; privacy, an old link can&apos;t be reopened.
        </p>
      </PublicCard>
    </PublicPage>
  );
}
