"use client";

import Link from "next/link";
import { AdminNav } from "../AdminNav";
import { FamiliesExplorer } from "./FamiliesExplorer";

export default function FamilyAdminPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-ink-primary">Family admin</h1>
          <p className="mt-2 text-ink-secondary">
            Every referral, one row per card. Confidential families are flagged, and their children only
            show a first initial to non-admin staff.
          </p>
        </div>
        <Link
          href="/admin/intake"
          className="shrink-0 rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          + Add family
        </Link>
      </div>

      <AdminNav />

      <FamiliesExplorer />
    </div>
  );
}
