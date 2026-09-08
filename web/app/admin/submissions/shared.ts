import type { SubmissionRecord } from "@/lib/intake";
import type { DataBundle, SubmissionStatus } from "@/lib/types";

// Small helpers the queue list and the detail view both need. Nothing here
// fetches — lib/intake.ts is the only data interface.

/**
 * The label for a submission's referral source.
 *
 * `driveSchoolId === null` is the confidential channel. A volunteer without
 * clearance never reaches this function for such a row: RLS returns no row at
 * all, so there is nothing for the UI to hide (US-23).
 */
export function channelLabel(
  data: DataBundle,
  driveSchoolId: string | null
): { name: string; confidential: boolean } {
  if (!driveSchoolId) return { name: "Confidential referral", confidential: true };
  const driveSchool = data.driveSchools.find((ds) => ds.id === driveSchoolId);
  const school = driveSchool ? data.schools.find((s) => s.id === driveSchool.schoolId) : undefined;
  return { name: school?.name ?? "Unknown school", confidential: false };
}

/** The guardian's name, preferring the column the server extracted at submit. */
export function guardianName(submission: SubmissionRecord): string {
  const fromAnswers = submission.answers.family?.guardian_name;
  return (
    submission.submitterName?.trim() ||
    (typeof fromAnswers === "string" ? fromAnswers.trim() : "") ||
    "No name given"
  );
}

export interface StatusGroup {
  key: string;
  title: string;
  blurb: string;
  statuses: SubmissionStatus[];
}

/**
 * The four groups US-23 asks for, in that order: the actionable group leads, so
 * the work staff can actually do right now sits at the top of the queue, then
 * what's blocked on someone else, then the two settled/archival groups.
 *
 * This array order *is* the rendered order — SubmissionsQueue maps over it
 * directly and skips empty groups — so reordering here reorders the page.
 *
 * `draft` is absent on purpose: listSubmissions() filters it out, because a
 * draft is a row nobody has submitted yet. Every other SubmissionStatus is
 * claimed by exactly one group below, so no submission can render ungrouped.
 */
export const STATUS_GROUPS: StatusGroup[] = [
  {
    key: "verified",
    title: "Confirmed by counselor, ready to import",
    blurb: "The counselor confirmed these. One click creates the household.",
    statuses: ["verified"],
  },
  {
    key: "waiting",
    title: "Waiting on counselor",
    blurb: "Submitted by a household. Not importable until the school confirms it.",
    statuses: ["submitted", "under_review"],
  },
  {
    key: "imported",
    title: "Imported",
    blurb: "Already in the drive as ordinary households.",
    statuses: ["imported"],
  },
  {
    key: "rejected",
    title: "Rejected",
    blurb: "The counselor didn't approve these, or marked them duplicates.",
    statuses: ["rejected", "duplicate"],
  },
];
