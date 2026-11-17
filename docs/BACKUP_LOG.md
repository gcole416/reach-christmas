# Prod backup log

Prod (`mpiueduyrmplrueviupl`) is on Supabase's free plan, which includes **no
backups** (checked 2026-11-16). Grant decided not to upgrade to Pro this year,
so our only backups are local snapshots taken with
[web/scripts/backup-prod.mjs](../web/scripts/backup-prod.mjs). How to run one
is in [web/README.md](../web/README.md#backing-up-prod).

**Every run of the script adds a row to this table on its own.** Commit the
change so the whole team can see when the latest backup was taken. If a backup
file is deleted or moved, note it in the Notes column rather than removing the
row.

When to take one:
- before any prod migration or other risky prod step;
- before a large import (sponsor roster, intake batch);
- at least once a week during the drive (November and December).

The backup files themselves hold real PII and are **never** committed. This
log holds only counts, file names and checksums, which is enough to tell
which file is the latest and to prove a file hasn't been altered (compare its
`.sha256`).

The newest backup is the last row.

| Taken (UTC) | Computer | Total rows | Households | Children | File | SHA-256 (first 16) | Kept in | Notes |
|---|---|---|---|---|---|---|---|---|
| 2026-11-17 03:44 | Grant-PC | 3122 | 91 | 193 | `prod-backup-2026-11-17T03-44-09-743Z.json` | `20240c37d6c94e58` | ~/Reach Christmas backups | First backup. Taken before the US-76 prod migration. |
