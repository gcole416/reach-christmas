"use client";

import Link from "next/link";
import { AdminPageHeader } from "../AdminPageHeader";
import { FamiliesExplorer } from "./FamiliesExplorer";

export default function FamilyAdminPage() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <AdminPageHeader
        title="Households"
        description="Every referral, one row per card. Confidential households are flagged, and their children only show a first initial to non-admin staff."
        action={
          <Link
            href="/admin/intake"
            className="rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            + Add household
          </Link>
        }
      />

      <FamiliesExplorer />
    </div>
  );
}
