"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { FormField } from "@/components/FormField";
import { AdminPageHeader } from "../AdminPageHeader";

// Self-service password change for whoever is currently signed in. There's no
// "current password" field: supabase.auth.updateUser() only needs an active
// session, which proves the caller already is this account, same as any other
// "change your password while logged in" flow.
//
// This exists instead of Supabase's built-in "forgot password" email flow
// because that flow sends mail through Supabase's mailer, which is exactly
// the channel that's been getting blocked by the church's email filters —
// see AGENTS.md and the accounts created via Authentication -> Add user with
// Auto Confirm. Changing your own password here needs no email at all.
const MIN_PASSWORD_LENGTH = 8;

export default function AccountPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Fetching from Supabase on mount.
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      setEmail(data.user?.email ?? null);
    })();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Those two passwords don't match.");
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    setNewPassword("");
    setConfirmPassword("");
    setSuccess(true);
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <AdminPageHeader
        title="Your account"
        description="Change the password for the account you're signed in as. This doesn't affect anyone else's login."
      />

      <div className="mt-6 max-w-sm">
        {email ? <p className="mb-4 text-sm text-ink-secondary">Signed in as {email}</p> : null}
        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField
            label="New password"
            type="password"
            value={newPassword}
            onChange={setNewPassword}
            required
          />
          <FormField
            label="Confirm new password"
            type="password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            required
          />
          {error ? (
            <div className="rounded-lg bg-status-critical/10 px-3 py-2 text-sm text-ink-primary">{error}</div>
          ) : null}
          {success ? (
            <div className="rounded-lg bg-status-good/10 px-3 py-2 text-sm text-ink-primary">
              Password updated.
            </div>
          ) : null}
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Update password"}
          </button>
        </form>
      </div>
    </div>
  );
}
