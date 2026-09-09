"use client";

import { StatTile } from "@/components/StatTile";
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

export default function AdminPage() {
  const { data, viewerRole } = useData();
  if (!data) return null;

  const isAdmin = viewerRole === "admin";
  const stats = getDashboardStats(data);
  const overdue = getOverdueAssignments(data);
  const needsPrint = getCardsNeedingPrint(data);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
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

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label="Children registered" value={stats.totalChildren} />
        <StatTile
          label="High schoolers"
          value={stats.totalHighSchoolers}
          hint="Shop day, not sponsored"
        />
        <StatTile
          label="Cards claimed"
          value={`${stats.cardsClaimed} / ${stats.totalCards}`}
          hint={`${stats.cardsAvailable} still need a sponsor`}
        />
        <StatTile label="Gifts delivered" value={stats.cardsDelivered} />
        <StatTile label="Sponsors overdue" value={stats.overdueCount} />
      </div>

      <section className="mt-12">
        <h2 className="text-xl font-semibold text-ink-primary">Sponsors running late</h2>
        <p className="mt-1 text-sm text-ink-secondary">
          Pledged or purchased {OVERDUE_WARNING_DAYS}+ days ago with no further progress since.
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
