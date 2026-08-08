-- Found during review: nothing stopped two drives from both being 'open' at
-- once (e.g. forgetting to close last year's before opening this year's) —
-- the dashboard would have just silently picked the newer year with no
-- warning. A partial unique index makes that a real constraint instead of an
-- unwritten assumption: at most one 'open' drive at a time, enforced by the
-- database regardless of which code path tries to set it.
create unique index one_open_drive on drives (status) where status = 'open';
