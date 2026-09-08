import Link from "next/link";

export default function Home() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col items-center px-6 py-20 text-center">
      <h1 className="mt-6 text-4xl font-semibold text-ink-primary sm:text-5xl">
        Reach Christmas gift drive
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-ink-secondary">
        Replacing the spreadsheet with one place to register households, match kids with sponsors, and
        track every gift from referral to delivery.
      </p>

      <div className="mt-10 grid w-full grid-cols-1 gap-5 sm:grid-cols-2">
        <Link
          href="/sponsor"
          className="rounded-xl border border-border bg-surface p-6 text-left transition hover:border-cat-blue"
        >
          <h2 className="text-lg font-semibold text-ink-primary">Sponsor a child</h2>
          <p className="mt-2 text-sm text-ink-secondary">
            The public page anyone can use to browse kids who need a sponsor and claim a gift. No
            login.
          </p>
        </Link>
        <Link
          href="/admin"
          className="rounded-xl border border-border bg-surface p-6 text-left transition hover:border-cat-blue"
        >
          <h2 className="text-lg font-semibold text-ink-primary">Staff dashboard</h2>
          <p className="mt-2 text-sm text-ink-secondary">
            Everything the team needs: registered households, sponsors running late, and which cards
            still need to be printed.
          </p>
        </Link>
      </div>
    </div>
  );
}
