"use client";

import { useState } from "react";

// One copy button, shared by the family-link and counselor-link rows. Copies
// the absolute URL (origin + path); the read-only input beside it is the
// fallback when clipboard permission is refused, so a failed copy needs no
// error handling of its own.

export function CopyLinkButton({
  path,
  label = "Copy full link",
  className,
}: {
  path: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    try {
      await navigator.clipboard.writeText(`${origin}${path}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={
        className ??
        "rounded-lg border border-border px-3 py-2 text-sm font-medium text-ink-secondary hover:border-cat-blue hover:text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue"
      }
    >
      {copied ? "Copied" : label}
    </button>
  );
}
