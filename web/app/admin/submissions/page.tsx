"use client";

import { AdminNav } from "../AdminNav";
import { SubmissionsQueue } from "./SubmissionsQueue";

export default function SubmissionsPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div>
        <h1 className="text-3xl font-semibold text-ink-primary">Registrations</h1>
        <p className="mt-2 max-w-2xl text-ink-secondary">
          Families who registered through a form link. A school counselor confirms each one, then
          you import it — that click is what creates the family, children, and cards in the drive.
        </p>
      </div>

      <AdminNav />

      <SubmissionsQueue />
    </div>
  );
}
