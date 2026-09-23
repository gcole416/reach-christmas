import { SponsorBrowser } from "./SponsorBrowser";

export default function SponsorPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold text-ink-primary">Sponsor a child this Christmas</h1>
        <p className="mt-3 text-ink-secondary">
          Browse the kids below who still need a sponsor and claim one to buy for.
          You see a child&apos;s first name, grade, sizes, wish list, and any specific needs.
        </p>
      </div>
      <SponsorBrowser />
    </div>
  );
}
