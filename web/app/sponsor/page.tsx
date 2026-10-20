"use client";

import { useEffect, useState } from "react";
import { getChurchCenterSignupUrl } from "@/lib/store";
import { PublicPage, PublicCard, PublicMasthead } from "@/components/intake/PublicShell";

// US-59: this used to render the self-serve browse/claim grid
// (SponsorBrowser + friends). On this branch sponsoring moved to Church
// Center, entirely outside this app, so this page is now just a pointer
// there. SponsorBrowser.tsx, public_available_cards, request_claim_code, and
// claim_card_with_code are deliberately left in place, unused — see the
// backlog story.
export default function SponsorPage() {
  // undefined = still loading, null = loaded but not configured (or the
  // fetch failed) — both render no link, only the wording differs.
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;
    getChurchCenterSignupUrl()
      .then((value) => {
        if (active) setUrl(value);
      })
      .catch(() => {
        if (active) {
          setLoadFailed(true);
          setUrl(null);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <PublicPage>
      <PublicCard>
        <PublicMasthead title="Sponsor a child this Christmas">
          Sponsoring works a little differently this year: sign-ups happen through Church Center
          instead of here. Sign up there and we&apos;ll match you with a child to shop for.
        </PublicMasthead>

        {url === undefined ? null : url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-lg bg-cat-blue px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue"
          >
            Sign up on Church Center
            <span aria-hidden="true" className="ml-1.5">
              →
            </span>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          <p className="text-ink-secondary">
            {loadFailed
              ? "We couldn't load the sign-up link just now. Please try again in a bit."
              : "Sign-ups aren't open yet — check back soon."}
          </p>
        )}
      </PublicCard>
    </PublicPage>
  );
}
