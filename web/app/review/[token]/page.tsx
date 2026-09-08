"use client";

import { use, useCallback, useEffect, useState } from "react";
import { getReviewRoster, type ReviewRosterResult } from "@/lib/intake";
import { PublicLoading, ReviewLinkClosed } from "@/components/intake/PublicShell";
import { RosterView } from "./RosterView";

// /review/[token] — the counselor's roster (US-22).
//
// No login, no session, no admin imports: this route sits outside app/admin so
// AdminGate never wraps it, and get_review_roster decides what the token may
// see from the token alone.
//
// The roster call is made ONCE per page load, not polled: it stamps
// first_viewed_at on every submission it returns for the first time, so it is
// a real action with a side effect, not a free read. Everything after that is
// updated in place from the verify/reject responses.

export default function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [result, setResult] = useState<ReviewRosterResult | null>(null);

  const load = useCallback(async () => {
    const next = await getReviewRoster(token);
    setResult(next);
  }, [token]);

  useEffect(() => {
    // Fetching on mount — the sanctioned "sync from an external system"
    // exception to the no-setState-in-effect rule.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (!result) {
    return <PublicLoading label="Loading your households…" />;
  }

  // Never a partial roster: any refusal replaces the whole page.
  if (!result.ok) {
    return <ReviewLinkClosed reason={result.reason} error={result.error} />;
  }

  return (
    <RosterView
      reviewToken={token}
      schoolName={result.schoolName}
      expiresAt={result.expiresAt}
      correctionFields={result.correctionFields}
      initialSubmissions={result.submissions}
    />
  );
}
