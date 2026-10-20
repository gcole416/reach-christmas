// One-card-per-page PDF of a sponsored child's card, shared by the Edge
// Functions that email sponsors. Same whitelist as /admin/print and
// public_available_cards: card number, first name, grade, sizes, wish list,
// specific needs. NEVER last name, school, or address.
//
// Same layout as send-sponsor-card-email's own buildCardPdf (which predates
// this file and still keeps its own copy, so that function doesn't change
// under anyone who already deployed it).

import { PDFDocument, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";

export interface CardPdfInput {
  card_number: string;
  first_name: string;
  grade: string | null;
  pant_size: string | null;
  shirt_size: string | null;
  shoe_size: string | null;
  specific_needs: string | null;
  /** Newline-joined "- item" lines. */
  wishlist_lines: string | null;
}

export interface DropoffInfo {
  dropoff_location: string | null;
  dropoff_days: string | null;
  dropoff_deadline: string | null;
}

// The standard Helvetica font only covers the Windows-1252 character set
// (Latin letters incl. Spanish accents, common punctuation). Anything else
// (emoji, arrows, non-Latin scripts) makes drawText throw, which would fail
// the whole email, so swap a few common ones and drop the rest.
const WIN_ANSI_EXTRAS = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
const REPLACEMENTS: Record<string, string> = { "→": "->", "←": "<-", "≥": ">=", "≤": "<=", "×": "x" };

function pdfSafe(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (ch === "\n" || ch === "\t" || ch === "\r") out += " ";
    else if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRAS.has(ch)) out += ch;
    else if (REPLACEMENTS[ch]) out += REPLACEMENTS[ch];
  }
  return out;
}

export async function buildCardPdf(card: CardPdfInput, dropoff: DropoffInfo): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([396, 612]); // half-letter
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const gray = rgb(0.4, 0.4, 0.4);

  let y = 560;
  const left = 36;
  function draw(text: string, size: number, useFont = font, color = rgb(0, 0, 0)) {
    page.drawText(pdfSafe(text), { x: left, y, size, font: useFont, color });
    y -= size + 8;
  }

  draw(card.card_number, 10, bold, gray);
  draw(`${card.first_name}${card.grade ? `  ·  Grade ${card.grade}` : ""}`, 18, bold);
  y -= 4;
  draw(`Pants: ${card.pant_size ?? "n/a"}   Shirt: ${card.shirt_size ?? "n/a"}   Shoes: ${card.shoe_size ?? "n/a"}`, 11);
  y -= 6;

  if (card.wishlist_lines) {
    draw("Wish list", 11, bold);
    for (const line of card.wishlist_lines.split("\n")) {
      if (line.trim()) draw(line, 11);
    }
    y -= 2;
  }

  if (card.specific_needs) {
    draw(card.specific_needs, 10, font, gray);
    y -= 2;
  }

  y -= 10;
  draw("Drop-off", 11, bold);
  draw(dropoff.dropoff_location ?? "", 10);
  draw(`When: ${dropoff.dropoff_days ?? ""}`, 10);
  draw(`Deadline: ${dropoff.dropoff_deadline ?? ""}`, 10);

  return doc.save();
}
