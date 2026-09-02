"use client";

import { use } from "react";
import Link from "next/link";
import { AdminNav } from "../../AdminNav";
import { SubmissionDetail } from "./SubmissionDetail";

export default function SubmissionDetailPage({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const { submissionId } = use(params);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div>
        <Link
          href="/admin/submissions"
          className="text-sm font-medium text-ink-secondary hover:text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue"
        >
          ← All registrations
        </Link>
        <h1 className="mt-2 text-3xl font-semibold text-ink-primary">Registration</h1>
        <p className="mt-2 max-w-2xl text-ink-secondary">
          Everything this family submitted, plus anything their counselor corrected. Importing
          turns it into a family in the drive.
        </p>
      </div>

      <AdminNav />

      <SubmissionDetail submissionId={submissionId} />
    </div>
  );
}
