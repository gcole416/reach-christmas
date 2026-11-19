"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/store";
import type { SponsorFamily } from "@/lib/types";
import {
  buildSponsorCardEmail,
  copyText,
  dropoffIsComplete,
  getSponsorEmailCards,
  markCardsEmailed,
  unmarkCardsEmailed,
  useDropoffDetails,
  type SponsorEmailCard,
} from "@/lib/manualSponsorEmail";
import { buildCardsPdf, cardPdfFileName, downloadPdf } from "@/lib/cardPdf";

// Email is off, so staff send cards from their own mailbox: download the card
// PDFs, copy the pre-written email from here, attach and send, then click
// "Mark as emailed" so the roster's tally knows. See lib/manualSponsorEmail.ts
// and lib/cardPdf.ts.

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function ManualCardEmailModal({
  sponsorFamily,
  onClose,
}: {
  sponsorFamily: SponsorFamily;
  onClose: () => void;
}) {
  const { data, refresh } = useData();
  const { dropoff, setField: setDropoffField, loaded: dropoffLoaded } = useDropoffDetails();
  const [pdfBusy, setPdfBusy] = useState(false);
  const [includeEmailed, setIncludeEmailed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allCards = useMemo(() => (data ? getSponsorEmailCards(data, sponsorFamily.id) : []), [data, sponsorFamily.id]);
  // Confidential cards can't be assigned through the roster today (US-65), so
  // this should never trigger. If one ever does, it stays out of the email.
  const confidential = allCards.filter((c) => c.isConfidential);
  const sendable = allCards.filter((c) => !c.isConfidential);
  const notEmailed = sendable.filter((c) => !c.emailedAt);
  const alreadyEmailed = sendable.filter((c) => c.emailedAt);
  const inEmail = includeEmailed || notEmailed.length === 0 ? sendable : notEmailed;

  const to = sponsorFamily.contactEmail?.trim() ?? "";
  const { subject, body } = buildSponsorCardEmail(sponsorFamily.displayName, inEmail, dropoff);

  async function handleCopy(label: string, text: string) {
    const ok = await copyText(text);
    setCopied(ok ? label : null);
    if (!ok) setError("Couldn't copy. Select the text and copy it by hand.");
  }

  async function handlePdf(cards: SponsorEmailCard[], mode: "each" | "combined") {
    setPdfBusy(true);
    setError(null);
    try {
      if (mode === "combined" || cards.length === 1) {
        const name =
          cards.length === 1
            ? cardPdfFileName(cards[0])
            : `Reach-Christmas-cards-${sponsorFamily.displayName.replace(/[^A-Za-z0-9]+/g, "-")}.pdf`;
        downloadPdf(await buildCardsPdf(cards, dropoff), name);
      } else {
        // One file per card. The browser may ask once to allow several
        // downloads; the short gap keeps it from dropping any.
        for (const c of cards) {
          downloadPdf(await buildCardsPdf([c], dropoff), cardPdfFileName(c));
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    } catch {
      setError("Couldn't make the PDF. Try again, or copy the message without it.");
    }
    setPdfBusy(false);
  }

  async function handleMark() {
    setBusy(true);
    setError(null);
    const res = await markCardsEmailed(inEmail.filter((c) => !c.emailedAt).map((c) => c.assignmentId));
    if (res.ok) await refresh();
    else setError(res.error);
    setBusy(false);
  }

  async function handleUnmark(assignmentId: string) {
    setBusy(true);
    setError(null);
    const res = await unmarkCardsEmailed([assignmentId]);
    if (res.ok) await refresh();
    else setError(res.error);
    setBusy(false);
  }

  const toMark = inEmail.filter((c) => !c.emailedAt).length;

  const copyButton = (label: string, text: string) => (
    <button
      onClick={() => handleCopy(label, text)}
      disabled={!text}
      className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink-secondary hover:border-cat-blue hover:text-ink-primary disabled:opacity-50"
    >
      {copied === label ? "Copied" : "Copy"}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={busy ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-email-title"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="manual-email-title" className="text-lg font-semibold text-ink-primary">
          Email cards to {sponsorFamily.displayName}
        </h2>
        <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm text-ink-secondary">
          <li>Check the drop-off details below, then download the card PDFs.</li>
          <li>Start a new email from the Reach mailbox and copy in the To, Subject and Message.</li>
          <li>Attach the PDFs and send.</li>
          <li>
            Come back and click <span className="font-medium text-ink-primary">Mark as emailed</span>.
          </li>
        </ol>

        {sendable.length === 0 ? (
          <p className="mt-4 text-sm text-ink-secondary">This sponsor has no cards assigned yet.</p>
        ) : (
          <div className="mt-4 space-y-4 text-sm">
            {/* The cards and their status */}
            <div className="rounded-lg border border-border">
              <ul className="divide-y divide-border">
                {sendable.map((c) => (
                  <li key={c.assignmentId} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-ink-primary">
                      <span className="font-medium">{c.cardNumber}</span> · {c.firstName}
                      {c.grade ? ` · Grade ${c.grade}` : ""}
                    </span>
                    <span className="flex items-center gap-3">
                      <button
                        onClick={() => handlePdf([c], "each")}
                        disabled={pdfBusy}
                        className="text-xs font-medium text-cat-blue hover:opacity-80 disabled:opacity-50"
                      >
                        PDF
                      </button>
                      {c.emailedAt ? (
                        <span className="flex items-center gap-2 text-xs text-status-good">
                          Emailed {formatDate(c.emailedAt)}
                          <button
                            onClick={() => handleUnmark(c.assignmentId)}
                            disabled={busy}
                            className="text-ink-muted underline hover:text-ink-primary disabled:opacity-50"
                          >
                            Undo
                          </button>
                        </span>
                      ) : (
                        <span className="text-xs text-status-warning">Not emailed yet</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {alreadyEmailed.length > 0 && notEmailed.length > 0 ? (
              <label className="flex items-center gap-2 text-ink-secondary">
                <input
                  type="checkbox"
                  checked={includeEmailed}
                  onChange={(e) => setIncludeEmailed(e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                Also include the {alreadyEmailed.length} already emailed{" "}
                {alreadyEmailed.length === 1 ? "card" : "cards"}
              </label>
            ) : null}

            {confidential.length > 0 ? (
              <div className="rounded-lg bg-status-warning/10 px-3 py-2 text-ink-primary">
                {confidential.length} confidential {confidential.length === 1 ? "card is" : "cards are"} left out of
                this email. Check with an admin before sending.
              </div>
            ) : null}

            {/* Drop-off: goes on every card and in the email */}
            <fieldset className="rounded-lg border border-border px-3 pb-3 pt-1">
              <legend className="px-1 text-xs font-medium uppercase tracking-wide text-ink-muted">
                Drop-off details
              </legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {(
                  [
                    ["location", "Where", "OneLife Church..."],
                    ["days", "When", "e.g. Sundays Dec 7 and 14"],
                    ["deadline", "Deadline", "e.g. Sunday, Dec 14"],
                  ] as const
                ).map(([field, label, placeholder]) => (
                  <label key={field} className="block text-xs text-ink-secondary">
                    {label}
                    <input
                      value={dropoff[field] ?? ""}
                      onChange={(e) => setDropoffField(field, e.target.value)}
                      placeholder={placeholder}
                      disabled={!dropoffLoaded}
                      className="mt-0.5 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-ink-primary"
                    />
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-ink-muted">
                {dropoffLoaded && !dropoffIsComplete(dropoff)
                  ? 'Fill in all three before downloading. A blank one is left off the cards, and shows as "[add drop-off details]" in the email.'
                  : "Remembered on this computer for the next sponsor."}
              </p>
            </fieldset>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => handlePdf(inEmail, "each")}
                disabled={pdfBusy || !dropoffLoaded}
                className="rounded-lg border border-cat-blue px-4 py-2 text-sm font-medium text-cat-blue hover:bg-cat-blue/5 disabled:opacity-50"
              >
                {pdfBusy
                  ? "Making PDFs…"
                  : `Download ${inEmail.length === 1 ? "card PDF" : `${inEmail.length} card PDFs`}`}
              </button>
              {inEmail.length > 1 ? (
                <button
                  onClick={() => handlePdf(inEmail, "combined")}
                  disabled={pdfBusy || !dropoffLoaded}
                  className="text-xs font-medium text-ink-secondary underline hover:text-ink-primary disabled:opacity-50"
                >
                  or all in one file
                </button>
              ) : null}
            </div>

            {/* To */}
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">To</div>
              <div className="mt-1 flex items-center gap-2">
                <div className="min-w-0 flex-1 truncate rounded-lg border border-border bg-ink-muted/5 px-3 py-2 text-ink-primary">
                  {to || <span className="text-status-warning">No email on file. Add one with Edit first.</span>}
                </div>
                {copyButton("to", to)}
              </div>
            </div>

            {/* Subject */}
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">Subject</div>
              <div className="mt-1 flex items-center gap-2">
                <div className="min-w-0 flex-1 rounded-lg border border-border bg-ink-muted/5 px-3 py-2 text-ink-primary">
                  {subject}
                </div>
                {copyButton("subject", subject)}
              </div>
            </div>

            {/* Body */}
            <div>
              <div className="flex items-end justify-between">
                <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">Message</div>
                {copyButton("body", body)}
              </div>
              <textarea
                readOnly
                value={body}
                rows={12}
                aria-label="Email message"
                className="mt-1 w-full rounded-lg border border-border bg-ink-muted/5 px-3 py-2 font-mono text-xs text-ink-primary"
              />
            </div>
          </div>
        )}

        {error ? (
          <div className="mt-3 rounded-lg bg-status-critical/10 px-3 py-2 text-sm text-ink-primary">{error}</div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink-secondary hover:text-ink-primary disabled:opacity-50"
          >
            Close
          </button>
          {sendable.length > 0 ? (
            <button
              onClick={handleMark}
              disabled={busy || toMark === 0}
              className="rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy
                ? "Saving…"
                : toMark === 0
                  ? "All emailed"
                  : `Mark ${toMark} ${toMark === 1 ? "card" : "cards"} as emailed`}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
