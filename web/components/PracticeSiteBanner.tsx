// Dev and prod share the same logins and (after a prod-to-dev copy) the same
// data, so the two sites are otherwise indistinguishable. This strip is the
// only visual cue that work done here is practice.
//
// It shows on every site that is NOT wired to the prod Supabase project, so a
// mis-set env var fails toward showing the strip, never toward a practice
// site that looks like the real one.
const PROD_SUPABASE_REF = "mpiueduyrmplrueviupl";

export function PracticeSiteBanner() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (url.includes(PROD_SUPABASE_REF)) return null;

  return (
    <div
      role="status"
      data-testid="practice-site-banner"
      className="bg-amber-400 px-4 py-2 text-center text-sm font-semibold text-black print:hidden"
    >
      PRACTICE SITE. Changes here do not affect the real Reach Christmas site, and no emails are sent.
    </div>
  );
}
