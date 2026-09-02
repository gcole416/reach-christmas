// Display helpers shared by the three intake surfaces (US-21/22/23).
//
// Nothing here talks to the database — lib/intake.ts is the only data
// interface. These exist so the family form, the counselor roster, and the
// staff queue format a date (and refuse to print a Postgres error) the same
// way.

// ---------------------------------------------------------------------------
// Which server strings a family or counselor is allowed to read
//
// lib/intake.ts flattens two different failure sources into the same
// `{ ok: false, error }` shape: sentences the intake functions deliberately
// WROTE for a parent, and raw strings Postgres/PostgREST/fetch RAISED. This is
// the boundary that keeps the second kind off a parent's phone (US-21) without
// also swallowing the first.
//
// It is an ALLOWLIST, not a list of known-bad substrings. A blocklist fails
// open: anything nobody thought of ships straight to the screen, and it grows
// an entry every time someone finds another one ("canceling statement due to
// statement timeout" and "cannot extract elements from an object" both got
// through the previous version). The cost of inverting it is that a message we
// really did write, in a shape these rules don't recognise, degrades to the
// caller's generic line. That is the direction we want to fail in.
//
// The rules below are structural, not a second copy of the SQL's strings —
// duplicating ~20 sentences across the TS/SQL boundary would just move the
// drift somewhere harder to see. They lean on the fact that the two sources
// write in measurably different styles:
//
//   ours      capitalised, ordinary punctuation, ends the sentence.
//             "This review link is no longer active — ask Reach for a new one."
//             "Correction rejected: Please keep First name under 80 characters."
//   Postgres  lowercase, no terminal period — that is the documented PostgreSQL
//             error message style guide, not a coincidence we're relying on.
//             "canceling statement due to statement timeout"
//   transport identifier-shaped tokens.  "NetworkError when attempting to…",
//             "PGRST202: …", "GET /rest/v1/rpc/submit_form"
//
// Staff surfaces deliberately do NOT use this — an admin debugging an import is
// better served by the real message.
// ---------------------------------------------------------------------------

/**
 * A single sentence in the character set our deliberate messages use: starts
 * with a capital, ends the sentence, and contains nothing but letters, digits
 * and ordinary prose punctuation.
 *
 * Notably absent from the class: underscore, braces, brackets, angle brackets,
 * backslash, pipe, equals, star, hash, at, plus, tilde, slash and newlines —
 * the punctuation of identifiers, JSON paths, URLs and multi-line PostgREST
 * hints. `public.families`, `children[0].age`, `p_review_token` and
 * `/rest/v1/rpc/...` all fail here.
 *
 * No semicolon either, deliberately. Nothing we write for a parent or a
 * counselor uses one; the raised internal errors lean on them ("Form version 7
 * has no repeating child section; corrections cannot be checked against it."),
 * and that one is reachable from the roster's Confirm button. If a future
 * message wants a semicolon it should want a full stop instead.
 *
 * The literal hyphen is last in the class on purpose: anywhere else it would
 * read as a range (`%-–` would admit every identifier character between them).
 */
const SENTENCE_SHAPED = /^[A-Z][A-Za-z0-9 ,.:'’"“”!?()$%–—-]*[.!?”"]$/;

/**
 * Identifier-shaped tokens that a hand-written sentence doesn't contain:
 * an intra-word case change (`NetworkError`, `AbortError`, `submitForm`) or a
 * run of three capitals (`PGRST`, `JWT`, `HTTP`, `SQLSTATE`, `JSON`).
 *
 * A form definition whose field label happens to look like this (`SSN`) costs
 * that message its wording, not its meaning — the caller's generic line shows
 * instead.
 */
const CODE_SHAPED = /[a-z][A-Z]|[A-Z]{3}/;

/**
 * The message to actually show a family or a counselor: the server's own
 * sentence when it is recognisably one of ours, and `fallback` otherwise.
 *
 * Long strings are rejected too — every deliberate message in the intake
 * functions is one or two sentences.
 */
export function friendlyMessage(raw: string | null | undefined, fallback: string): string {
  const text = (raw ?? "").trim();
  if (!text || text.length > 280) return fallback;
  if (!SENTENCE_SHAPED.test(text)) return fallback;
  if (CODE_SHAPED.test(text)) return fallback;
  return text;
}

/** "Aug 30, 2026". Locale is pinned so server and client agree. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** "Aug 30, 2026 at 4:12 PM". */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${formatDate(iso)} at ${date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

/** "1 child" / "3 children". */
export function childCountLabel(count: number): string {
  return `${count} ${count === 1 ? "child" : "children"}`;
}
