import type { Metadata } from "next";

// A review link opens a season-long roster of children's first names and ages.
// It must never be indexed, cached by a proxy, or followed.
export const metadata: Metadata = {
  title: "Confirm your families — Reach Christmas",
  robots: { index: false, follow: false, nocache: true },
};

export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
