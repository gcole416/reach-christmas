import type { Metadata } from "next";

// A registration link is meant to travel from a counselor to one family, not
// to sit in a search index. `noindex, nofollow` is the cheap half of that; the
// real control is that the token itself is the only way in and get_form
// returns nothing but the blank questionnaire.
export const metadata: Metadata = {
  title: "Family Gift Registration — Reach Christmas",
  robots: { index: false, follow: false, nocache: true },
};

export default function FormLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
