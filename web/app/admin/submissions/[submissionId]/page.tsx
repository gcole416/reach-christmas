"use client";

import { use } from "react";
import { AdminPageHeader } from "../../AdminPageHeader";
import { SubmissionDetail } from "./SubmissionDetail";

export default function SubmissionDetailPage({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const { submissionId } = use(params);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <AdminPageHeader
        title="Registration"
        backLink={{ href: "/admin/submissions", label: "All registrations" }}
        description="Everything this household submitted, plus anything their counselor corrected. Importing turns it into a household in the drive."
      />

      <SubmissionDetail submissionId={submissionId} />
    </div>
  );
}
