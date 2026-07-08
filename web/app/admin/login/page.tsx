"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FormField } from "@/components/FormField";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/admin");
    router.refresh();
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col px-6 py-20">
      <h1 className="text-2xl font-semibold text-ink-primary">Staff sign in</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        Accounts are created by an admin — there&apos;s no public sign-up.
      </p>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <FormField label="Email" type="email" value={email} onChange={setEmail} required />
        <FormField label="Password" type="password" value={password} onChange={setPassword} required />
        {error ? (
          <div className="rounded-lg bg-status-critical/10 px-3 py-2 text-sm text-ink-primary">{error}</div>
        ) : null}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-cat-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
