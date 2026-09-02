"use client";

import { useState } from "react";
import { formPath, type FormLinkRecord } from "@/lib/intake";
import type { DataBundle } from "@/lib/types";
import { formatDate } from "@/components/intake/format";
import { channelLabel } from "./shared";

// The manual fallback INTAKE_FORMS §11 says to build on day one: the family
// form link, on screen, copyable, so staff can send it by hand when a digest
// email doesn't arrive.
//
// Confidentiality is handled entirely by RLS on form_links — an uncleared
// volunteer simply doesn't get the confidential-channel row back, so there is
// no client-side filtering here and none to add.

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

export function FormLinkPanel({ data, links }: { data: DataBundle; links: FormLinkRecord[] }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function copy(link: FormLinkRecord) {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    try {
      await navigator.clipboard.writeText(`${origin}${formPath(link.token)}`);
      setCopiedId(link.id);
      window.setTimeout(() => setCopiedId((id) => (id === link.id ? null : id)), 2500);
    } catch {
      // Clipboard permission can be refused; the read-only input beside the
      // button is the fallback, so there is nothing to recover from.
      setCopiedId(null);
    }
  }

  return (
    <section
      aria-labelledby="form-links-heading"
      className="rounded-xl border border-border bg-surface p-5"
    >
      <h2 id="form-links-heading" className="text-lg font-semibold text-ink-primary">
        Registration links
      </h2>
      <p className="mt-1 text-sm text-ink-secondary">
        Send these to a school counselor to pass on to families. Anyone with the link can register;
        nobody with it can read anything.
      </p>

      {links.length === 0 ? (
        <p className="mt-4 text-sm text-ink-muted">
          No registration links exist for this drive yet.
        </p>
      ) : (
        <ul className="mt-4 space-y-4">
          {links.map((link) => {
            const source = channelLabel(data, link.driveSchoolId);
            const state = linkState(link);
            return (
              <li key={link.id} className="rounded-lg border border-gridline p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium text-ink-primary">
                    {link.label ?? source.name}
                  </span>
                  {link.label && link.label !== source.name ? (
                    <span className="text-sm text-ink-secondary">{source.name}</span>
                  ) : null}
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
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <label htmlFor={`link-${link.id}`} className="sr-only">
                    Registration link for {source.name}
                  </label>
                  <input
                    id={`link-${link.id}`}
                    type="text"
                    readOnly
                    value={formPath(link.token)}
                    onFocus={(e) => e.currentTarget.select()}
                    className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-ink-primary focus:ring-2 focus:ring-cat-blue focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => copy(link)}
                    className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-ink-secondary hover:border-cat-blue hover:text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue"
                  >
                    {copiedId === link.id ? "Copied" : "Copy full link"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 border-t border-border pt-4 text-sm text-ink-secondary">
        <strong className="font-medium text-ink-primary">
          Counselor review links can&apos;t be shown here.
        </strong>{" "}
        A review link opens a roster of children&apos;s names, so its token is stored hashed and is
        shown exactly once, when it&apos;s issued. If a counselor loses theirs, issue a new one —
        the old one can&apos;t be recovered from the database by anyone.
      </p>
    </section>
  );
}
