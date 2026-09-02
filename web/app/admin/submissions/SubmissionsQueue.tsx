"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useData } from "@/lib/store";
import {
  listDriveFormVersions,
  listFormLinks,
  listReviewLinks,
  listSubmissions,
  reviewLinkIsLive,
  type DriveFormVersionRecord,
  type FormLinkRecord,
  type ReviewLinkRecord,
  type SubmissionRecord,
} from "@/lib/intake";
import type { DataBundle } from "@/lib/types";
import { childCountLabel, formatDate } from "@/components/intake/format";
import { SubmissionStatusBadge } from "@/components/intake/SubmissionStatusBadge";
import { FormLinkPanel } from "./FormLinkPanel";
import { CopyLinkButton } from "./CopyLinkButton";
import { STATUS_GROUPS, channelLabel, guardianName } from "./shared";

// The staff queue (US-23) — every registration in the open drive, grouped by
// what still has to happen to it.
//
// A volunteer without confidential clearance never sees a confidential-channel
// submission here because listSubmissions() returns no such row, not because
// this component hides one. There is deliberately no client-side filter to
// "fix" an empty result.

// In the "waiting on counselor" group, a shortcut to re-send each relevant
// school's counselor review link — the same link the FormLinkPanel manages
// below, surfaced next to the submissions that are blocked on it (US-28).
function WaitingCounselorLinks({
  rows,
  data,
  reviewBySchool,
}: {
  rows: SubmissionRecord[];
  data: DataBundle;
  reviewBySchool: Map<string, ReviewLinkRecord>;
}) {
  const schoolIds = Array.from(
    new Set(rows.map((r) => r.driveSchoolId).filter((id): id is string => Boolean(id)))
  );
  if (schoolIds.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {schoolIds.map((id) => {
        const name = channelLabel(data, id).name;
        const link = reviewBySchool.get(id);
        if (link && reviewLinkIsLive(link)) {
          return (
            <span
              key={id}
              className="inline-flex items-center gap-2 rounded-lg border border-gridline bg-surface px-3 py-1.5 text-xs text-ink-secondary"
            >
              Counselor link · {name}
              <CopyLinkButton
                path={`/review/${link.token}`}
                label="Copy"
                className="rounded-md border border-border px-2 py-0.5 text-xs font-medium text-ink-secondary hover:border-cat-blue hover:text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue"
              />
            </span>
          );
        }
        return (
          <span
            key={id}
            className="inline-flex items-center rounded-lg border border-gridline bg-surface px-3 py-1.5 text-xs text-ink-muted"
          >
            {name}: no counselor link yet — set one up in Registration links below
          </span>
        );
      })}
    </div>
  );
}

export function SubmissionsQueue() {
  const { data } = useData();
  const driveId = data?.drive.id ?? null;

  const [submissions, setSubmissions] = useState<SubmissionRecord[] | null>(null);
  const [links, setLinks] = useState<FormLinkRecord[]>([]);
  const [reviewLinks, setReviewLinks] = useState<ReviewLinkRecord[]>([]);
  const [formVersions, setFormVersions] = useState<DriveFormVersionRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!driveId) return;
    const [subs, formLinks, revLinks, versions] = await Promise.all([
      listSubmissions(driveId),
      listFormLinks(driveId),
      listReviewLinks(driveId),
      listDriveFormVersions(driveId),
    ]);
    if (!subs.ok) {
      setError(subs.error);
      setSubmissions([]);
      return;
    }
    setError(null);
    setSubmissions(subs.items);
    setLinks(formLinks.ok ? formLinks.items : []);
    setReviewLinks(revLinks.ok ? revLinks.items : []);
    setFormVersions(versions.ok ? versions.items : []);
  }, [driveId]);

  useEffect(() => {
    // Fetching from Supabase on mount — the sanctioned "sync from an external
    // system" exception to the no-setState-in-effect rule.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // At most one live review link per school (issue_review_token is idempotent).
  const reviewBySchool = useMemo(() => {
    const map = new Map<string, ReviewLinkRecord>();
    for (const rl of reviewLinks) {
      if (!rl.driveSchoolId) continue;
      const current = map.get(rl.driveSchoolId);
      if (!current || (reviewLinkIsLive(rl) && !reviewLinkIsLive(current))) {
        map.set(rl.driveSchoolId, rl);
      }
    }
    return map;
  }, [reviewLinks]);

  if (!data) return null;

  const readyCount = (submissions ?? []).filter((s) => s.status === "verified").length;

  return (
    <div className="space-y-8">
      {error ? (
        <div className="rounded-lg bg-status-critical/10 px-4 py-3 text-sm text-ink-primary">
          {error}
        </div>
      ) : null}

      {submissions === null ? (
        <p className="text-ink-secondary">Loading registrations…</p>
      ) : error ? null : submissions.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-6">
          <h2 className="text-lg font-semibold text-ink-primary">No registrations yet</h2>
          <p className="mt-2 text-ink-secondary">
            Once a household fills in a registration link, it appears here and waits for their school
            counselor to confirm it.
          </p>
        </div>
      ) : (
        <>
          {readyCount > 0 ? (
            <p className="rounded-xl bg-cat-blue/10 px-4 py-3 text-sm font-medium text-ink-primary">
              {readyCount === 1
                ? "1 registration is confirmed and ready to import."
                : `${readyCount} registrations are confirmed and ready to import.`}
            </p>
          ) : null}

          {STATUS_GROUPS.map((group) => {
            const rows = submissions.filter((s) => group.statuses.includes(s.status));
            if (rows.length === 0) return null;
            return (
              <section key={group.key} aria-labelledby={`group-${group.key}`}>
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <h2 id={`group-${group.key}`} className="text-lg font-semibold text-ink-primary">
                    {group.title}
                  </h2>
                  <span className="text-sm text-ink-muted">{rows.length}</span>
                </div>
                <p className="mt-1 text-sm text-ink-secondary">{group.blurb}</p>

                {group.key === "waiting" ? (
                  <WaitingCounselorLinks
                    rows={rows}
                    data={data}
                    reviewBySchool={reviewBySchool}
                  />
                ) : null}

                <ul className="mt-3 space-y-2">
                  {rows.map((submission) => {
                    const source = channelLabel(data, submission.driveSchoolId);
                    return (
                      <li key={submission.id}>
                        <Link
                          href={`/admin/submissions/${submission.id}`}
                          className="block rounded-xl border border-border bg-surface p-4 transition hover:border-cat-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-cat-blue"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-medium text-ink-primary">
                                {guardianName(submission)}
                              </p>
                              <p className="mt-0.5 text-sm text-ink-secondary">
                                {source.name} · {childCountLabel(submission.childCount)} ·
                                Registered {formatDate(submission.submittedAt)}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              {source.confidential ? (
                                <span className="rounded-full bg-cat-violet/10 px-2.5 py-1 text-xs font-medium text-ink-primary">
                                  Confidential
                                </span>
                              ) : null}
                              <SubmissionStatusBadge status={submission.status} audience="staff" />
                            </div>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </>
      )}

      <FormLinkPanel
        data={data}
        links={links}
        reviewLinks={reviewLinks}
        formVersions={formVersions}
        onChanged={load}
      />
    </div>
  );
}
