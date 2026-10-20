"use client";

import { AdminPageHeader } from "../AdminPageHeader";
import { SubmissionsQueue } from "./SubmissionsQueue";

export default function SubmissionsPage() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <AdminPageHeader
        title="Registrations"
        description="Households who registered through a form link. A school counselor confirms each one, then you import it. That click is what creates the household, children, and cards in the drive."
      />

      <SubmissionsQueue />
    </div>
  );
}
