"use client";

import { useState } from "react";
import { useData, type SendSponsorEmailsResult, type SponsorEmailKind } from "@/lib/store";
import type { SponsorFamily } from "@/lib/types";

// The roster's "Email all assigned" / "Remind all assigned" confirm step.
// Counts here come from the loaded data bundle and are a preview; the
// database decides who actually gets an email (get_sponsor_email_batch in
// 20261019120000), including the 20-hour reminder cooldown this page can't
// see.
export function SendSponsorEmailsModal({
  kind,
  sponsorFamilies,
  onClose,
}: {
  kind: SponsorEmailKind;
  /** Every roster entry for the current drive, unfiltered. */
  sponsorFamilies: SponsorFamily[];
  onClose: () => void;
}) {
  const { sendSponsorEmails } = useData();
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendSponsorEmailsResult | null>(null);

  const isReminder = kind === "reminder";
  const countFor = (sf: SponsorFamily) => (isReminder ? sf.awaitingGiftCount : sf.unemailedCount);
  const waiting = sponsorFamilies.filter((sf) => sf.isActive && countFor(sf) > 0);
  const reachable = waiting.filter((sf) => sf.contactEmail?.trim());
  const noEmail = waiting.filter((sf) => !sf.contactEmail?.trim());
  const cardTotal = reachable.reduce((sum, sf) => sum + countFor(sf), 0);

  async function handleSend() {
    setSending(true);
    setResult(await sendSponsorEmails(kind));
    setSending(false);
  }

  const title = isReminder ? "Remind all assigned" : "Email all assigned";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={sending ? undefined : onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-ink-primary">{title}</h2>

        {result ? (
          <div className="mt-3 space-y-3 text-sm">
            <p className="text-ink-primary">
              {result.sent === 0
                ? "No emails were sent."
                : `Sent ${result.sent} ${result.sent === 1 ? "email" : "emails"}.`}
            </p>
            {result.error ? (
              <div className="rounded-lg bg-status-critical/10 px-3 py-2 text-ink-primary">{result.error}</div>
            ) : null}
            {result.failed.length > 0 ? (
              <div className="rounded-lg bg-status-warning/10 px-3 py-2 text-ink-primary">
                <p className="font-medium">Not sent:</p>
                <ul className="mt-1 list-disc pl-5">
                  {result.failed.map((f) => (
                    <li key={f.sponsorName}>
                      {f.sponsorName}: {f.reason}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-ink-secondary">
                  These sponsors can be retried after 10 minutes. Until then they&apos;re held so nobody gets two
                  copies.
                </p>
              </div>
            ) : null}
            <div className="flex justify-end pt-1">
              <button
                onClick={onClose}
                className="rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-3 text-sm text-ink-secondary">
            {reachable.length === 0 ? (
              <p>
                {isReminder
                  ? "Nobody to remind. Every emailed sponsor's gifts are already in, or nothing has been emailed yet."
                  : "Nothing new to send. Every assigned card has already been emailed."}
              </p>
            ) : (
              <p>
                {isReminder ? (
                  <>
                    Sends a reminder to <span className="font-medium text-ink-primary">{reachable.length}</span>{" "}
                    {reachable.length === 1 ? "sponsor" : "sponsors"} with{" "}
                    <span className="font-medium text-ink-primary">{cardTotal}</span>{" "}
                    {cardTotal === 1 ? "gift" : "gifts"} not yet received at church, with their cards attached again.
                    Cards emailed or reminded in the last 20 hours are skipped, so the number sent may be lower.
                  </>
                ) : (
                  <>
                    Emails <span className="font-medium text-ink-primary">{reachable.length}</span>{" "}
                    {reachable.length === 1 ? "sponsor" : "sponsors"} their{" "}
                    <span className="font-medium text-ink-primary">{cardTotal}</span> new{" "}
                    {cardTotal === 1 ? "card" : "cards"}: one email each, one PDF card per child. Cards already
                    emailed aren&apos;t sent again.
                  </>
                )}
              </p>
            )}
            {noEmail.length > 0 ? (
              <div className="rounded-lg bg-status-warning/10 px-3 py-2 text-ink-primary">
                {noEmail.length} {noEmail.length === 1 ? "sponsor has" : "sponsors have"} no email on file and will
                be skipped: {noEmail.map((sf) => sf.displayName).join(", ")}.
              </div>
            ) : null}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                disabled={sending}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink-secondary hover:text-ink-primary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={sending || reachable.length === 0}
                className="rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {sending ? "Sending…" : isReminder ? "Send reminders" : "Send emails"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
