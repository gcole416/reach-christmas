"use client";

import { use, useCallback, useEffect, useState } from "react";
import { getForm, type GetFormResult } from "@/lib/intake";
import { FormLinkClosed, PublicLoading } from "@/components/intake/PublicShell";
import { FamilyForm } from "./FamilyForm";

// /form/[token] — the public family intake form (US-21).
//
// Unauthenticated: this route is outside app/admin, so AdminGate and
// DataProvider never wrap it, and nothing here reads a session. getForm() and
// submitForm() are the only two calls the whole flow makes.

export default function FormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [result, setResult] = useState<GetFormResult | null>(null);

  const load = useCallback(async () => {
    const next = await getForm(token);
    setResult(next);
  }, [token]);

  useEffect(() => {
    // Fetching on mount — the sanctioned "sync from an external system"
    // exception to the no-setState-in-effect rule, same as the admin pages.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (!result) {
    return <PublicLoading label="Loading the registration form…" />;
  }

  if (!result.ok) {
    return <FormLinkClosed reason={result.reason} error={result.error} />;
  }

  return (
    <FamilyForm
      token={token}
      definition={result.definition}
      schoolName={result.schoolName}
    />
  );
}
