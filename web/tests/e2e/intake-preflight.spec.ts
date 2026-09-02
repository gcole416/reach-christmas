import { test, expect } from "@playwright/test";
import { signInAs, getOpenDriveId, anonClient } from "./helpers/testClient";
import { DEMO_FORM_TOKEN, DEMO_REVIEW_TOKEN, intakeStatus, rpcGetReviewRoster } from "./helpers/intake";

// PREFLIGHT — the standing red/green signal for "is the intake feature actually
// on the database this suite is pointed at?"
//
// supabase/migrations/20260830120000_intake_forms.sql and
// supabase/intake_demo_seed.sql were applied by hand in the DEV SQL editor
// (project ref thvyntrxmahygesltgft) on 2026-09-01. There is no migration
// runner in this repo and nothing in this suite applies them.
//
// These tests FAIL rather than skip. An earlier revision of this suite skipped
// the whole intake feature when the functions were missing, which made sense
// while it was genuinely unapplied — but now a skip would report green for the
// exact thing under test.

test.describe("intake preflight", () => {
  test("the intake migration is applied to the project this suite talks to", async () => {
    const status = await intakeStatus();
    expect(
      status.functionsPresent,
      "The intake server functions are not on this database. Check that " +
        "web/.env.development.local names the DEV project (thvyntrxmahygesltgft) — " +
        "playwright.config.ts loads it over .env.local, which points at prod. " +
        `Probe said: ${status.detail}`
    ).toBe(true);
  });

  test("the intake demo seed is present, and the 9/9 walkthrough links resolve", async () => {
    const status = await intakeStatus();
    expect(
      status.seedPresent,
      `supabase/intake_demo_seed.sql has not been run, so /form/${DEMO_FORM_TOKEN} and ` +
        `/review/${DEMO_REVIEW_TOKEN} have nothing behind them. Probe said: ${status.detail}`
    ).toBe(true);
  });

  // reach-reviewer runtime check 1.
  //
  // FOR THE RECORD: the `extensions.digest(..., 'sha256')` call site the review
  // flagged is GONE from the migration as applied — L1 removed IP hashing
  // entirely and submit_form writes ip_hash as NULL, so `digest` survives only
  // in comments (grep over the migration confirms it: zero executable call
  // sites). What is left is extensions.crypt / extensions.gen_salt, which is
  // the same call shape that broke SPN-3 live as an unqualified `gen_salt`.
  //
  // This exercises it the hard way: a token that matches NOTHING forces crypt()
  // to run against every live review_tokens row, so an unqualified call
  // surfaces as 42883 "function crypt does not exist" rather than a clean
  // ok:false. The seeded token then proves the matching path works too.
  test("schema-qualified pgcrypto resolves at runtime (both the miss and the hit)", async () => {
    const anon = anonClient();

    const unknown = await rpcGetReviewRoster(anon, "autotest-not-a-real-review-token");
    expect(
      unknown.error,
      "get_review_roster raised instead of refusing an unknown token — if this is 42883, " +
        "an unqualified pgcrypto call slipped back in"
    ).toBeNull();
    expect((unknown.data as { ok?: boolean }).ok).toBe(false);
    expect((unknown.data as { reason?: string }).reason).toBe("not_found");

    const real = await rpcGetReviewRoster(anon, DEMO_REVIEW_TOKEN);
    expect(real.error, "get_review_roster raised on the seeded demo review token").toBeNull();
    expect((real.data as { ok?: boolean }).ok).toBe(true);
  });

  // VERIFY check 25 / L1.
  test("ip_hash is never populated — no digest call site was reintroduced", async () => {
    const admin = await signInAs("admin");
    await getOpenDriveId(admin); // fails early and clearly if dev has no open drive
    const { count, error } = await admin
      .from("form_submissions")
      .select("id", { count: "exact", head: true })
      .not("ip_hash", "is", null);

    expect(error).toBeNull();
    expect(count ?? 0, "form_submissions.ip_hash must stay NULL — see VERIFY check 25").toBe(0);
  });
});
