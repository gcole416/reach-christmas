"use client";

// Browser-side sponsor card PDF for manual card emails (US-77). One
// half-letter page per child, so it prints on its own or two-up on letter.
//
// Same field whitelist as /admin/print, public_available_cards and the Edge
// Functions' supabase/functions/_shared/cardPdf.ts: card number, first name,
// grade, sizes, wish list, specific needs, plus the church's drop-off
// details. Plus M/F, which only these sponsor emails carry (Grant,
// 2026-11-18: M/F yes, age no). NEVER last name, school, or address. Don't
// add a child field here without checking it against DESIGN.md §5.
//
// Black and white on purpose (Grant, 2026-11-18): prints cleanly on any
// office printer, and a white header uses no toner.

import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from "pdf-lib";
import type { DropoffInfo, SponsorEmailCard } from "./manualSponsorEmail";

const W = 396; // half-letter, points
const H = 612;
const M = 32; // side margin

const INK = rgb(0, 0, 0);
const GRAY = rgb(0.4, 0.4, 0.4);
const FILL = rgb(0.94, 0.94, 0.94);
const WHITE = rgb(1, 1, 1);

// Standard Helvetica only covers Windows-1252. Anything outside it (emoji,
// arrows, non-Latin scripts) makes drawText throw, so swap a few common ones
// and drop the rest. Same rule as the Edge Function's pdfSafe.
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

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = pdfSafe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (let word of words) {
    // Hard-break a single word wider than the line (a long URL, say).
    while (font.widthOfTextAtSize(word, size) > maxWidth) {
      let cut = word.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(word.slice(0, cut), size) > maxWidth) cut--;
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Filled rounded rectangle; (x, y) is the bottom-left corner. */
function roundRect(page: PDFPage, x: number, y: number, w: number, h: number, r: number, color = FILL, border = 0) {
  const path = `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
  // drawSvgPath's origin is the path's top-left, with y growing downward.
  page.drawSvgPath(path, { x, y: y + h, color, borderWidth: border, borderColor: border ? INK : undefined });
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

function drawHeader(page: PDFPage, f: Fonts, cardNumber: string, continued: boolean) {
  page.drawText("REACH CHRISTMAS", { x: M, y: H - 38, size: 13, font: f.bold, color: INK });
  page.drawText(continued ? "Sponsor card (continued)" : "Sponsor card", {
    x: M,
    y: H - 53,
    size: 9,
    font: f.regular,
    color: GRAY,
  });
  const label = pdfSafe(cardNumber);
  const size = 14;
  const tw = f.bold.widthOfTextAtSize(label, size);
  const pw = tw + 22;
  roundRect(page, W - M - pw, H - 54, pw, 26, 13, WHITE, 1.5);
  page.drawText(label, { x: W - M - pw + 11, y: H - 46, size, font: f.bold, color: INK });
  page.drawRectangle({ x: M, y: H - 70, width: W - 2 * M, height: 2, color: INK });
}

const DROPOFF_TOP = 128; // the drop-off panel lives below this line on the last page

function drawDropoff(page: PDFPage, f: Fonts, d: DropoffInfo, firstName: string) {
  const rows = (
    [
      ["Where", d.location],
      ["When", d.days],
      ["Deadline", d.deadline],
    ] as const
  ).filter(([, v]) => v && v.trim());
  const inner = W - 2 * M - 24;
  if (rows.length > 0) {
    // Height from the wrapped lines, so long text grows the panel upward.
    const wrapped = rows.map(([k, v]) => [k, wrap(v!, f.regular, 9.5, inner - 58)] as const);
    const lineCount = wrapped.reduce((n, [, ls]) => n + ls.length, 0);
    const h = 30 + lineCount * 13;
    const y0 = 48;
    roundRect(page, M, y0, W - 2 * M, h, 8, FILL);
    page.drawText("DROP-OFF", { x: M + 12, y: y0 + h - 18, size: 8, font: f.bold, color: GRAY });
    let y = y0 + h - 33;
    for (const [k, ls] of wrapped) {
      page.drawText(k, { x: M + 12, y, size: 9.5, font: f.bold, color: INK });
      for (const l of ls) {
        page.drawText(l, { x: M + 12 + 58, y, size: 9.5, font: f.regular, color: INK });
        y -= 13;
      }
    }
  }
  const thanks = pdfSafe(`Thank you for sponsoring ${firstName} this Christmas!`);
  const tw = f.regular.widthOfTextAtSize(thanks, 9);
  page.drawText(thanks, { x: (W - tw) / 2, y: 26, size: 9, font: f.regular, color: GRAY });
}

async function drawCard(doc: PDFDocument, f: Fonts, card: SponsorEmailCard, dropoff: DropoffInfo) {
  let page = doc.addPage([W, H]);
  drawHeader(page, f, card.cardNumber, false);
  let y = H - 112;
  const contentW = W - 2 * M;

  // Leaves room for the drop-off panel; past it, continue on a new page.
  function ensure(h: number) {
    if (y - h < DROPOFF_TOP) {
      page = doc.addPage([W, H]);
      drawHeader(page, f, card.cardNumber, true);
      y = H - 100;
    }
  }

  // Name and grade
  page.drawText(pdfSafe(card.firstName), { x: M, y, size: 28, font: f.bold, color: INK });
  y -= 22;
  const subtitle = [card.grade ? `Grade ${card.grade}` : null, card.sexLabel].filter(Boolean).join("   ·   ");
  if (subtitle) {
    page.drawText(pdfSafe(subtitle), { x: M, y, size: 13, font: f.regular, color: GRAY });
    y -= 12;
  }
  y -= 18;

  // Sizes: three tiles. Never drop part of a size: shrink it to fit one line,
  // and past that wrap it, growing every tile to the tallest one.
  const gap = 8;
  const tileW = (contentW - 2 * gap) / 3;
  const textW = tileW - 20;
  const tiles = (
    [
      ["PANTS", card.pantSize],
      ["SHIRT", card.shirtSize],
      ["SHOES", card.shoeSize],
    ] as const
  ).map(([label, value]) => {
    const text = pdfSafe(value?.trim() || "n/a");
    let size = 12;
    while (size > 9 && f.bold.widthOfTextAtSize(text, size) > textW) size -= 0.5;
    if (f.bold.widthOfTextAtSize(text, size) <= textW) return { label, lines: [text], size, filled: !!value?.trim() };
    return { label, lines: wrap(text, f.bold, 9, textW), size: 9, filled: true };
  });
  const tileH = Math.max(44, ...tiles.map((t) => 26 + t.lines.length * (t.size + 2) + 4));
  tiles.forEach((t, i) => {
    const x = M + i * (tileW + gap);
    roundRect(page, x, y - tileH, tileW, tileH, 6, FILL);
    page.drawText(t.label, { x: x + 10, y: y - 15, size: 7.5, font: f.bold, color: GRAY });
    t.lines.forEach((l, li) =>
      page.drawText(l, { x: x + 10, y: y - 33 - li * (t.size + 2), size: t.size, font: f.bold, color: t.filled ? INK : GRAY }),
    );
  });
  y -= tileH + 26;

  // Wish list
  if (card.wishlist.length > 0) {
    ensure(30);
    page.drawText("WISH LIST", { x: M, y, size: 8, font: f.bold, color: GRAY });
    y -= 18;
    card.wishlist.forEach((item, i) => {
      const lines = wrap(item, f.regular, 12, contentW - 22);
      ensure(lines.length * 16 + 4);
      page.drawText(`${i + 1}.`, { x: M, y, size: 12, font: f.bold, color: INK });
      for (const l of lines) {
        page.drawText(l, { x: M + 20, y, size: 12, font: f.regular, color: INK });
        y -= 16;
      }
      y -= 4;
    });
    y -= 10;
  }

  // Specific needs
  if (card.specificNeeds?.trim()) {
    const lines = wrap(card.specificNeeds, f.regular, 10.5, contentW - 24);
    const boxH = 28 + lines.length * 14;
    ensure(boxH);
    roundRect(page, M, y - boxH, contentW, boxH, 8, FILL);
    page.drawText("GOOD TO KNOW", { x: M + 12, y: y - 16, size: 8, font: f.bold, color: GRAY });
    let ly = y - 32;
    for (const l of lines) {
      page.drawText(l, { x: M + 12, y: ly, size: 10.5, font: f.regular, color: INK });
      ly -= 14;
    }
    y -= boxH + 12;
  }

  drawDropoff(page, f, dropoff, card.firstName);
}

/** One PDF, one page (or more, if a wish list runs long) per card. */
export async function buildCardsPdf(cards: SponsorEmailCard[], dropoff: DropoffInfo): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(cards.length === 1 ? `Reach Christmas card ${cards[0].cardNumber}` : "Reach Christmas sponsor cards");
  doc.setCreator("Reach Christmas");
  const f: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  for (const c of cards) await drawCard(doc, f, c, dropoff);
  return doc.save();
}

export function cardPdfFileName(card: SponsorEmailCard): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "");
  return `Reach-Christmas-card-${safe(card.cardNumber)}-${safe(card.firstName) || "child"}.pdf`;
}

export function downloadPdf(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
