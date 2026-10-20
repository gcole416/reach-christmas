// Turns a database permission refusal into a message staff can act on.
//
// Admin-only writes are enforced in the database: RLS policies gated on
// is_admin(), plus is_admin() checks inside database functions. The functions
// already return plain "Only an administrator can ..." messages. Plain table
// writes don't: a blocked INSERT comes back as Postgres 42501 "new row
// violates row-level security policy for table ...", which says nothing about
// WHY. A blocked UPDATE or DELETE is worse: RLS just filters the row out, so
// the write "succeeds" with zero rows changed and no error at all. Callers of
// admin-only updates/deletes therefore check the affected row count, and
// admin-only pages hide the control from volunteers (VolunteerNotice) instead
// of relying on this message alone.
//
// This is messaging only. The database is still the security boundary.

type DbError = { message: string; code?: string | null } | null | undefined;

const ADMIN_HELP =
  "Ask an admin to do it, or ask an admin to change your role under Staff & permissions.";

export function isPermissionError(error: DbError): boolean {
  if (!error) return false;
  return error.code === "42501" || /row-level security|permission denied/i.test(error.message);
}

/** e.g. adminOnlyMessage("add a school") */
export function adminOnlyMessage(action: string): string {
  return `Only an admin can ${action}. You're signed in as a volunteer. ${ADMIN_HELP}`;
}

/**
 * The message to show for a failed Supabase call. Permission refusals get a
 * plain explanation (naming the admin-only action when the caller knows it);
 * anything else passes the database's own message through unchanged.
 */
export function describeDbError(
  error: DbError,
  opts: { adminAction?: string; fallback?: string } = {}
): string {
  if (!error) return opts.fallback ?? "Something went wrong. Please try again.";
  if (isPermissionError(error)) {
    if (opts.adminAction) return adminOnlyMessage(opts.adminAction);
    return (
      "Your account isn't allowed to make this change. Some changes are limited to admins, or to " +
      `staff with confidential access. ${ADMIN_HELP} (Database said: ${error.message})`
    );
  }
  return error.message;
}
