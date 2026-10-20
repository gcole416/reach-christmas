// send-sponsor-emails: the sponsor roster's "Email all assigned" and
// "Remind all assigned" buttons (/admin/sponsors). One email per sponsor
// household, one PDF card attached per child. See
// supabase/migrations/20261019120000_staff_sponsor_emails.sql for the
// decisions behind this and the two database functions it calls.
//
// =============================================================================
// AUTH: the caller's own staff session, never a service key
// =============================================================================
// The browser calls this with the signed-in staff member's Supabase session
// (supabase.functions.invoke attaches it). This function never reads the
// database directly: it forwards that same Authorization header to
// get_sponsor_email_batch / record_sponsor_emails_sent through PostgREST,
// using the public anon key as `apikey`. Those functions are granted to
// `authenticated` only, so a caller without a real staff session (including
// the anon key itself) gets "permission denied" from Postgres, not data.
//
// =============================================================================
// ONE BATCH PER CALL
// =============================================================================
// Each call claims and sends at most one batch (up to 20 households), one at
// a time and spaced out to stay under Resend's default rate limit, then
// returns { sent, failed, batchSize, remaining }. The browser calls again
// until nothing is left or a batch comes back empty. That keeps every call far inside the Edge
// Function time limit, and a card is marked emailed only after Resend
// accepts its email, so a failure part-way through is simply retried by
// the next click.
//
// =============================================================================
// DEPLOY (you, not Claude: needs the Supabase CLI logged in and linked)
// =============================================================================
//   supabase functions deploy send-sponsor-emails
//   (JWT verification stays ON, the default. Do not pass --no-verify-jwt.)
//
// Secrets it reads (set once per project with `supabase secrets set`):
//   RESEND_API_KEY  already set if send-sponsor-card-email was set up.
//   EMAIL_FROM      optional, e.g. "Reach Christmas <christmas@yourdomain>".
//                   Defaults to Resend's onboarding sender, which only
//                   delivers to the Resend account owner's own address.
// SUPABASE_URL and SUPABASE_ANON_KEY are provided automatically.

import { encodeBase64 } from "jsr:@std/encoding/base64";
import { buildCardPdf, type CardPdfInput, type DropoffInfo } from "../_shared/cardPdf.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "Reach Christmas <onboarding@resend.dev>";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const BATCH_SIZE = 20;
// Resend's default limit is 2 requests/second.
const SEND_SPACING_MS = 600;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Kind = "card_assignment" | "reminder";

interface BatchCard extends CardPdfInput {
  assignment_id: string;
}

interface BatchSponsor {
  sponsor_family_id: string;
  sponsor_name: string;
  sponsor_email: string;
  cards: BatchCard[];
}

interface BatchResponse extends DropoffInfo {
  ok: boolean;
  error?: string;
  sponsors?: BatchSponsor[];
  total_sponsors?: number;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function rpc(name: string, args: Record<string, unknown>, authHeader: string): Promise<Response> {
  return await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: authHeader,
    },
    body: JSON.stringify(args),
  });
}

function childLabel(c: BatchCard): string {
  return `${c.first_name}${c.grade ? ` (grade ${c.grade})` : ""}, card ${c.card_number}`;
}

function cardDetails(c: BatchCard): string {
  return `${childLabel(c)}\n` +
    `  Sizes: pants ${c.pant_size ?? "n/a"}, shirt ${c.shirt_size ?? "n/a"}, shoes ${c.shoe_size ?? "n/a"}\n` +
    (c.wishlist_lines ? `  Wish list:\n${c.wishlist_lines.split("\n").map((l) => `  ${l}`).join("\n")}\n` : "") +
    (c.specific_needs ? `  Notes: ${c.specific_needs}\n` : "");
}

function dropoffText(d: DropoffInfo): string {
  return `Drop-off:\n` +
    `Location: ${d.dropoff_location ?? ""}\n` +
    `When: ${d.dropoff_days ?? ""}\n` +
    `Deadline: ${d.dropoff_deadline ?? ""}\n`;
}

function buildEmail(kind: Kind, s: BatchSponsor, d: DropoffInfo): { subject: string; text: string } {
  const many = s.cards.length > 1;
  if (kind === "card_assignment") {
    return {
      subject: many ? "Your Reach Christmas sponsor cards" : `Your Reach Christmas sponsor card for ${s.cards[0].first_name}`,
      text: `Hi ${s.sponsor_name},\n\n` +
        `Thank you for sponsoring this Christmas! Here ${many ? `are the ${s.cards.length} children` : "is the child"} ` +
        `you're shopping for. ${many ? "Each card is" : "The card is"} attached as a PDF, so you can bring it with you shopping.\n\n` +
        s.cards.map(cardDetails).join("\n") + "\n" +
        dropoffText(d) + "\n" +
        `Thank you for partnering with us this season.`,
    };
  }
  return {
    subject: "Reminder: Christmas gift drop-off",
    text: `Hi ${s.sponsor_name},\n\n` +
      `A friendly reminder that we haven't received the gifts for ${many ? "these children" : "this child"} yet:\n\n` +
      s.cards.map((c) => `- ${childLabel(c)}`).join("\n") + "\n\n" +
      dropoffText(d) + "\n" +
      `${many ? "Their cards are" : "The card is"} attached again in case you need ${many ? "them" : "it"}. ` +
      `If you've already dropped off, thank you, and please ignore this email.`,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "Not signed in." }, 401);
  if (!RESEND_API_KEY) return json({ ok: false, error: "Email isn't set up yet (RESEND_API_KEY missing)." }, 500);

  let kind: Kind;
  try {
    const body = await req.json();
    if (body?.kind !== "card_assignment" && body?.kind !== "reminder") throw new Error();
    kind = body.kind;
  } catch {
    return json({ ok: false, error: "Body must be { kind: 'card_assignment' | 'reminder' }." }, 400);
  }

  const batchResp = await rpc("get_sponsor_email_batch", { p_kind: kind, p_limit: BATCH_SIZE }, authHeader);
  if (!batchResp.ok) {
    console.error("get_sponsor_email_batch failed:", batchResp.status);
    return json({ ok: false, error: "Couldn't load who to email. Are you signed in as staff?" }, batchResp.status === 401 ? 401 : 403);
  }
  const batch = await batchResp.json() as BatchResponse;
  if (!batch.ok) return json({ ok: false, error: batch.error ?? "Couldn't load who to email." }, 400);

  const sponsors = batch.sponsors ?? [];
  const total = batch.total_sponsors ?? 0;
  const dropoff: DropoffInfo = batch;
  let sent = 0;
  const failed: { sponsorName: string; reason: string }[] = [];

  for (let i = 0; i < sponsors.length; i++) {
    const s = sponsors[i];
    if (i > 0) await new Promise((r) => setTimeout(r, SEND_SPACING_MS));
    try {
      const attachments = [];
      for (const c of s.cards) {
        const pdf = await buildCardPdf(c, dropoff);
        attachments.push({ filename: `card-${c.card_number}.pdf`, content: encodeBase64(pdf) });
      }
      const { subject, text } = buildEmail(kind, s, dropoff);
      const resendResp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({ from: EMAIL_FROM, to: [s.sponsor_email], subject, text, attachments }),
      });
      if (!resendResp.ok) {
        // Status only: Resend's error body can echo the recipient address.
        console.error("Resend send failed:", resendResp.status);
        await resendResp.body?.cancel();
        failed.push({ sponsorName: s.sponsor_name, reason: `Email service returned ${resendResp.status}.` });
        continue;
      }
      await resendResp.body?.cancel();

      const recordResp = await rpc("record_sponsor_emails_sent", {
        p_kind: kind,
        p_assignment_ids: s.cards.map((c) => c.assignment_id),
        p_sent_to: s.sponsor_email,
      }, authHeader);
      await recordResp.body?.cancel();
      if (!recordResp.ok) {
        // The email went out but wasn't recorded. Stop here rather than risk
        // the next call sending it again.
        console.error("record_sponsor_emails_sent failed:", recordResp.status);
        failed.push({
          sponsorName: s.sponsor_name,
          reason: "The email went out but couldn't be recorded, so sending stopped. Tell an admin before sending again, or this sponsor may get a second copy.",
        });
        return json({ ok: false, sent: sent + 1, failed, batchSize: sponsors.length, remaining: 0, stopped: true });
      }
      sent++;
    } catch (_e) {
      console.error("Send failed for one sponsor (exception).");
      failed.push({ sponsorName: s.sponsor_name, reason: "Unexpected error building or sending the email." });
    }
  }

  // Failed sponsors keep their 10-minute lease (see the migration), so the
  // next call moves on to the households after them instead of retrying.
  return json({ ok: true, sent, failed, batchSize: sponsors.length, remaining: Math.max(0, total - sponsors.length) });
});
