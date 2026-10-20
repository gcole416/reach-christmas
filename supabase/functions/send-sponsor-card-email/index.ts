// send-sponsor-card-email — renders a one-page PDF of a sponsored child's
// card (same whitelist public_available_cards/the thank-you email already
// use: first name, grade, sizes, wish list, specific needs — NEVER last
// name, school, or address) and sends it as an attachment on the existing
// sponsor thank-you email via Resend.
//
// =============================================================================
// WHY THIS IS A SEPARATE EDGE FUNCTION, NOT MORE PL/PGSQL
// =============================================================================
// Postgres has no PDF renderer. Every other outbound email in this project
// (request_claim_code, claim_card_with_code's thank-you step, counselor
// digest emails) calls Resend directly from a plpgsql function via
// pg_net.http_post because a plain-text email needs nothing else. A PDF
// attachment does, so this function exists purely to do the one thing
// Postgres can't: render the card to bytes. It still sends the email itself
// (rather than handing bytes back to Postgres) because pg_net.http_post is
// fire-and-forget — the calling function never sees a response body, so
// there's no way to hand a rendered PDF back into the plpgsql call that
// triggered this. Keeping the whole send (render + attach + Resend call)
// in one place avoids a two-hop handoff that would need pg_net to work
// synchronously, which it doesn't.
//
// =============================================================================
// AUTH: shared-secret header, not a Supabase JWT
// =============================================================================
// The only caller is claim_card_with_code via pg_net, which has no end-user
// session to forward as a JWT. Deployed with --no-verify-jwt (see below) and
// gated instead on an `x-internal-secret` header matched against this
// function's own INTERNAL_WEBHOOK_SECRET env secret. Postgres sends the same
// value from vault.decrypted_secrets (name = 'internal_webhook_secret') — see
// the migration that calls this function for exactly how. Without this check
// anyone who found this function's URL could make it burn Resend send quota;
// with it, only a caller who already has the Vault secret can.
//
// =============================================================================
// HOW TO DEPLOY THIS (you, not Claude — needs the Supabase CLI logged in and
// linked to the project)
// =============================================================================
//
// 1. From the repo root:
//      supabase functions deploy send-sponsor-card-email --no-verify-jwt
//
// 2. Set this function's own secrets (separate from the Postgres-side Vault
//    secrets — this is the Edge Functions runtime's own secret store):
//      supabase secrets set RESEND_API_KEY="re_xxxxxxxx"
//      supabase secrets set INTERNAL_WEBHOOK_SECRET="<same long random value you put in Vault>"
//
//    RESEND_API_KEY is the SAME key value already in Vault as
//    'resend_api_key' (see 20260818160000's header for how that one was
//    set) — this function needs its own copy because Edge Functions read
//    Deno.env, not Postgres's vault.decrypted_secrets.
//
// 3. Confirm the project's function base URL (Settings -> API in the
//    Supabase dashboard, "Edge Functions" section — looks like
//    https://<project-ref>.supabase.co/functions/v1) and set it once in
//    app_settings.edge_functions_url — see the migration's VERIFY section
//    for the exact UPDATE statement.
//
// 4. Generate the shared secret itself (anything long and random works,
//    e.g. `openssl rand -hex 32`), then store it in BOTH places so they
//    match: Vault (see the migration header) and this function's
//    INTERNAL_WEBHOOK_SECRET (step 2 above).
//
// Until all of steps 1-4 are done, claim_card_with_code's best-effort block
// simply finds app_settings.edge_functions_url or the Vault secret missing
// and skips this step silently — same "degrade, don't fail the claim"
// behavior as a missing Resend key always had. Nothing breaks by deploying
// late; the thank-you email just stays plain-text (no PDF) until it's wired
// up.

import { encodeBase64 } from "jsr:@std/encoding/base64";
import { PDFDocument, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const INTERNAL_SECRET = Deno.env.get("INTERNAL_WEBHOOK_SECRET");

/**
 * Constant-time string compare for the shared secret check below. A plain
 * `!==` short-circuits on the first mismatched byte, which is a (low-value,
 * but free-to-close) timing side channel against a long random secret.
 * `internal_webhook_secret` is this function's entire trust boundary (no
 * Supabase JWT reaches it — see this file's header) — treat it with the
 * same handling discipline as resend_api_key: never logged, rotated
 * immediately if it ever leaks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

interface CardEmailPayload {
  sponsor_name: string;
  sponsor_email: string;
  card_number: string;
  first_name: string;
  grade: string | null;
  pant_size: string | null;
  shirt_size: string | null;
  shoe_size: string | null;
  specific_needs: string | null;
  /** Already newline-joined "- item" lines, exactly as claim_card_with_code builds it for the plain-text body. */
  wishlist_lines: string | null;
  dropoff_location: string;
  dropoff_days: string;
  dropoff_deadline: string;
}

function isPayloadValid(value: unknown): value is CardEmailPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.sponsor_email === "string" && v.sponsor_email.length > 0 && typeof v.first_name === "string" &&
    v.first_name.length > 0 && typeof v.card_number === "string";
}

/**
 * A plain, one-card-per-page PDF matching /admin/print's layout (card
 * number, name + grade, the three sizes, wish list, specific needs). No
 * logo or styling — this is a utility attachment for a sponsor to bring
 * shopping, not a print-shop product. Deliberately no text-wrapping: every
 * source field is already length-capped by the intake form (80-500 chars)
 * and rendered at a width that fits them in practice; a line that did
 * overflow would just run past the page edge rather than throw.
 */
async function buildCardPdf(p: CardEmailPayload): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([396, 612]); // half-letter — one small card, not a full sheet
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const gray = rgb(0.4, 0.4, 0.4);

  let y = 560;
  const left = 36;
  function draw(text: string, size: number, useFont = font, color = rgb(0, 0, 0)) {
    page.drawText(text, { x: left, y, size, font: useFont, color });
    y -= size + 8;
  }

  draw(p.card_number, 10, bold, gray);
  draw(`${p.first_name}${p.grade ? `  ·  Grade ${p.grade}` : ""}`, 18, bold);
  y -= 4;
  draw(`Pants: ${p.pant_size ?? "n/a"}   Shirt: ${p.shirt_size ?? "n/a"}   Shoes: ${p.shoe_size ?? "n/a"}`, 11);
  y -= 6;

  if (p.wishlist_lines) {
    draw("Wish list", 11, bold);
    for (const line of p.wishlist_lines.split("\n")) {
      if (line.trim()) draw(line, 11);
    }
    y -= 2;
  }

  if (p.specific_needs) {
    draw(p.specific_needs, 10, font, gray);
    y -= 2;
  }

  y -= 10;
  draw("Drop-off", 11, bold);
  draw(p.dropoff_location, 10);
  draw(`When: ${p.dropoff_days}`, 10);
  draw(`Deadline: ${p.dropoff_deadline}`, 10);

  return doc.save();
}

function thankYouText(p: CardEmailPayload): string {
  return `Hi ${p.sponsor_name},\n\n` +
    `Thank you for sponsoring ${p.first_name}${p.grade ? ` (grade ${p.grade})` : ""} this Christmas! Card ${p.card_number}.\n\n` +
    `Their card is attached as a PDF — bring it with you shopping.\n\n` +
    (p.wishlist_lines ? `Wish list:\n${p.wishlist_lines}\n\n` : "") +
    `Sizes — Pants: ${p.pant_size ?? "n/a"}, Shirt: ${p.shirt_size ?? "n/a"}, Shoes: ${p.shoe_size ?? "n/a"}\n` +
    (p.specific_needs ? `${p.specific_needs}\n` : "") +
    `\nDrop-off:\n` +
    `Location: ${p.dropoff_location}\n` +
    `When: ${p.dropoff_days}\n` +
    `Deadline: ${p.dropoff_deadline}\n\n` +
    `Thank you for partnering with us this season.`;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "method not allowed" }), { status: 405 });
  }
  // Auth gate FIRST, before any other branch — an unauthenticated caller
  // must not be able to learn anything about this function's config state
  // (e.g. "deployed but RESEND_API_KEY missing" vs. "fully configured") by
  // probing it without the secret.
  if (!INTERNAL_SECRET || !timingSafeEqual(req.headers.get("x-internal-secret") ?? "", INTERNAL_SECRET)) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
  }
  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ ok: false, error: "RESEND_API_KEY not configured" }), { status: 500 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "invalid json body" }), { status: 400 });
  }
  if (!isPayloadValid(payload)) {
    return new Response(JSON.stringify({ ok: false, error: "missing required fields" }), { status: 400 });
  }

  const pdfBytes = await buildCardPdf(payload);

  const resendResp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      // TODO(Grant): swap for a verified sending domain — same TODO as every
      // other Resend call in this project (see docs/backlog.md's email epic).
      from: "Reach Christmas <onboarding@resend.dev>",
      to: [payload.sponsor_email],
      subject: `Thank you for sponsoring ${payload.first_name}!`,
      text: thankYouText(payload),
      attachments: [
        {
          filename: `card-${payload.card_number}.pdf`,
          content: encodeBase64(pdfBytes),
        },
      ],
    }),
  });

  if (!resendResp.ok) {
    const detail = await resendResp.text();
    // Logged for whoever checks this function's logs; the caller (pg_net) is
    // fire-and-forget and never reads this response, same as every other
    // best-effort email path in this project.
    console.error("Resend send failed:", resendResp.status, detail);
    return new Response(JSON.stringify({ ok: false, error: detail }), { status: 502 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
