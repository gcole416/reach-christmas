import { SponsorBrowser } from "./SponsorBrowser";

export default function SponsorPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold text-ink-primary">Sponsor a child this Christmas</h1>
        <p className="mt-3 text-ink-secondary">
          Browse the kids below who still need a sponsor and claim one to buy for — no account needed.
          We only ever show a first name, grade, and wishlist here; family details stay private.
        </p>
      </div>
      <SponsorBrowser />
    </div>
  );
}
