"use client";

import { useEffect, useState } from "react";
import { StatTile } from "@/components/StatTile";
import { listSubmissions } from "@/lib/intake";
import { OverdueBadge, StatusBadge } from "@/components/StatusBadge";
import { useData } from "@/lib/store";
import {
  displayFirstName,
  getCardsNeedingPrint,
  getDashboardStats,
  getOverdueAssignments,
  OVERDUE_WARNING_DAYS,
} from "@/lib/queries";
import { AdminPageHeader } from "./AdminPageHeader";

// Registrations waiting on staff or on a counselor. Same grouping as the
// Registrations page (submissions/shared.ts): verified = ready to import;
// submitted / under_review = waiting on the counselor.
function useRegistrationCounts(driveId: string | undefined) {
  const [counts, setCounts] = useState<{ ready: number; waiting: number } | null>(null);
  useEffect(() => {
    if (!driveId) return;
    let cancelled = false;
    listSubmissions(driveId).then((res) => {
      if (cancelled || !res.ok) return;
      setCounts({
        ready: res.items.filter((s) => s.status === "verified").length,
        waiting: res.items.filter((s) => s.status === "submitted" || s.status === "under_review").length,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [driveId]);
  return counts;
}

export default function AdminPage() {
  const { data, viewerRole } = useData();
  const registrations = useRegistrationCounts(data?.drive.id);
  if (!data) return null;

  const isAdmin = viewerRole === "admin";
  const stats = getDashboardStats(data);
  const overdue = getOverdueAssignments(data);
  const needsPrint = getCardsNeedingPrint(data);

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <AdminPageHeader
        title="Staff dashboard"
        description={
          <>
            {stats.totalChildren} children in the sponsor pool for {data.drive.name}
            {stats.totalHighSchoolers > 0
              ? `, plus ${stats.totalHighSchoolers} high schooler${
                  stats.totalHighSchoolers === 1 ? "" : "s"
                } who shop for themselves`
              : ""}
            . This data is real and shared; changes here are visible to the whole team.
          </>
        }
      />

      <section>
        <h2 className="text-sm font-semibold text-ink-secondary">Needs your attention</h2>
        <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile
            label="Ready to import"
            value={registrations ? registrations.ready : "…"}
            hint="Confirmed by the counselor"
            href="/admin/submissions"
          />
          <StatTile
            label="Waiting on counselor"
            value={registrations ? registrations.waiting : "…"}
            hint="Registered, not yet confirmed"
            href="/admin/submissions"
          />
          <StatTile label="On hold" value={stats.onHoldCount} hint="Duplicate review" href="/admin/on-hold" />
          <StatTile
            label="Need a sponsor"
            value={stats.cardsAvailable}
            hint="Ready to assign"
            href="/admin/assign"
          />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold text-ink-secondary">This season so far</h2>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile label="Children registered" value={stats.totalChildren} />
          <StatTile
            label="Church sign-ups needed"
            value={stats.churchSignupsNeeded}
            hint={
              stats.churchSignupsSoFar === 0
                ? "Kids the church shops for"
                : stats.churchSignupsSoFar >= stats.churchSignupsNeeded
                  ? `${stats.churchSignupsSoFar} signed up, all covered`
                  : `${stats.churchSignupsSoFar} signed up, ${
                      stats.churchSignupsNeeded - stats.churchSignupsSoFar
                    } to go`
            }
            href="/admin/sponsors"
          />
          <StatTile
            label="High schoolers"
            value={stats.totalHighSchoolers}
            hint="Shop day, not sponsored"
          />
          <StatTile label="Sponsors assigned" value={`${stats.cardsClaimed} / ${stats.totalCards}`} />
          <StatTile label="Gifts delivered" value={stats.cardsDelivered} />
          <StatTile label="Sponsors overdue" value={stats.overdueCount} />
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-semibold text-ink-primary">Sponsors running late</h2>
        <p className="mt-1 text-sm text-ink-secondary">
          Assigned {OVERDUE_WARNING_DAYS}+ days ago and not yet received at church.
        </p>
        <div className="mt-4 overflow-x-auto rounded-xl border border-border">
          {overdue.length === 0 ? (
            <div className="p-6 text-center text-sm text-ink-secondary">No overdue sponsors right now.</div>
          ) : (
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-ink-muted/5 text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Child / card</th>
                  <th className="px-4 py-3 font-medium">Sponsor</th>
                  <th className="px-4 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Overdue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {overdue.map((row) => (
                  <tr key={row.assignmentId}>
                    <td className="px-4 py-3 text-ink-primary">
                      {displayFirstName(row.childFirstName, row.isConfidential, isAdmin)}{" "}
                      <span className="text-ink-muted">({row.cardNumber})</span>
                    </td>
                    <td className="px-4 py-3 text-ink-primary">{row.sponsorName}</td>
                    <td className="px-4 py-3 text-ink-secondary">
                      {row.sponsorEmail ?? "—"}
                      {row.sponsorPhone ? ` · ${row.sponsorPhone}` : ""}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-4 py-3">
                      <OverdueBadge severity={row.severity} days={row.daysSinceClaimed} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-semibold text-ink-primary">Cards to print</h2>
        <p className="mt-1 text-sm text-ink-secondary">Children whose card hasn&apos;t been printed yet.</p>
        <div className="mt-4 overflow-x-auto rounded-xl border border-border">
          {needsPrint.length === 0 ? (
            <div className="p-6 text-center text-sm text-ink-secondary">Everything is printed and up to date.</div>
          ) : (
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead className="bg-ink-muted/5 text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Child</th>
                  <th className="px-4 py-3 font-medium">Card</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {needsPrint.map((row) => (
                  <tr key={row.childId}>
                    <td className="px-4 py-3 text-ink-primary">
                      {displayFirstName(row.firstName, row.isConfidential, isAdmin)}
                    </td>
                    <td className="px-4 py-3 text-ink-secondary">{row.cardNumber}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
