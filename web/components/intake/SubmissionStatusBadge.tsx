import type { SubmissionStatus } from "@/lib/intake";

// One submission status, in the words of whoever is looking at it. The same
// row is "Needs your confirmation" to a counselor and "Waiting on counselor"
// to staff — same state, different job — so the audience picks the copy while
// the colour stays consistent across both screens.
//
// Styling mirrors components/StatusBadge.tsx: a tinted pill with ink-primary
// text (never coloured text), so contrast holds in both light and dark mode,
// and a colour dot that is decorative only — the label always carries the
// meaning.
export type StatusAudience = "counselor" | "staff";

type Tone = "waiting" | "ready" | "done" | "closed";

const TONE_CLASSES: Record<Tone, { dot: string; bg: string }> = {
  waiting: { dot: "bg-status-warning", bg: "bg-status-warning/20" },
  ready: { dot: "bg-cat-blue", bg: "bg-cat-blue/10" },
  done: { dot: "bg-status-good", bg: "bg-status-good/10" },
  closed: { dot: "bg-ink-muted", bg: "bg-ink-muted/15" },
};

const CONFIG: Record<SubmissionStatus, { tone: Tone; counselor: string; staff: string }> = {
  draft: { tone: "closed", counselor: "Not submitted", staff: "Draft" },
  submitted: { tone: "waiting", counselor: "Needs your confirmation", staff: "Waiting on counselor" },
  under_review: { tone: "waiting", counselor: "Needs your confirmation", staff: "Waiting on counselor" },
  verified: { tone: "ready", counselor: "Confirmed", staff: "Ready to import" },
  imported: { tone: "done", counselor: "Confirmed", staff: "Imported" },
  rejected: { tone: "closed", counselor: "Not approved", staff: "Rejected" },
  duplicate: { tone: "closed", counselor: "Marked a duplicate", staff: "Duplicate" },
};

export function SubmissionStatusBadge({
  status,
  audience,
}: {
  status: SubmissionStatus;
  audience: StatusAudience;
}) {
  const config = CONFIG[status];
  const tone = TONE_CLASSES[config.tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium text-ink-primary ${tone.bg}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden="true" />
      {audience === "counselor" ? config.counselor : config.staff}
    </span>
  );
}
