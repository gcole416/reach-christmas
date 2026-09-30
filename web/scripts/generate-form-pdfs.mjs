// Renders the public-facing pages (family intake form, its confirmation
// screen, the counselor review roster, and the sponsor browsing page +
// claim modal) to PDF against a running local dev server, for handing to
// non-technical reviewers (outreach copy review, translation reference).
//
// Requires:
//   1. `npm run dev` already running (dev Supabase project) at localhost:3000
//   2. supabase/demo_seed.sql and supabase/intake_demo_seed.sql already run
//      against the dev project, so the demo token below resolves.
//
// Usage: node scripts/generate-form-pdfs.mjs

import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.PDF_BASE_URL ?? "http://localhost:3000";
const REVIEW_TOKEN = "demo-north-review-2026";
const OUT_DIR = path.join(import.meta.dirname, "form-review-pdfs");

async function pdf(page, file, opts = {}) {
  await mkdir(OUT_DIR, { recursive: true });
  await page.pdf({
    path: path.join(OUT_DIR, file),
    format: "Letter",
    printBackground: true,
    margin: { top: "0.4in", bottom: "0.4in", left: "0.4in", right: "0.4in" },
    ...opts,
  });
  console.log("wrote", file);
}

// One language's family-form flow: blank -> filled -> confirmation. Shared by
// the English and Spanish runs below so the two stay in lockstep — a new
// field added to the flow gets added once, not twice.
//
// Both runs hit the SAME token and use the page's own English/Español toggle
// (top of the form) to switch language — there's no separate Spanish link.
// The two questionnaires share identical field ids/validation, so the toggle
// is a pure client-side display swap regardless of which locale this
// particular link happens to be pinned to server-side.
async function familyFormFlow(page, { formToken, toggleTo, prefix, heading, labels, options, submitLabel, thankYouHeading }) {
  // 1. Family intake form, blank.
  await page.goto(`${BASE_URL}/form/${formToken}`, { waitUntil: "networkidle" });
  if (toggleTo) {
    await page.getByRole("button", { name: toggleTo }).click();
  }
  await page.getByRole("heading", { name: heading }).waitFor();
  await pdf(page, `01-family-form-blank${prefix}.pdf`);

  // 2. Fill it out with obviously-fake placeholder data and submit, to
  //    capture the confirmation screen.
  await page.getByLabel(labels.guardianName).fill("Sample Parent");
  await page.getByLabel(labels.phone).fill("555-010-0100");
  await page.getByLabel(labels.email).fill("sample.parent@example.com");
  await page.getByLabel(labels.preferredLanguage).selectOption({ label: options.language });

  await page.getByLabel(labels.childFirstName).fill("Sample Child");
  await page.getByRole("spinbutton", { name: labels.age }).fill("8");
  await page.getByLabel(labels.grade).selectOption({ label: options.grade });
  await page.getByLabel(labels.sex).selectOption({ label: options.preferNotToSay });
  await page.getByLabel(labels.shirtSize).selectOption({ label: options.shirtSize });
  await page.getByLabel(labels.pantSize).selectOption({ label: options.pantSize });
  await page.getByLabel(labels.shoeSize).selectOption({ label: options.shoeSize });
  await page.getByLabel(labels.firstIdea).fill("A building block set");
  await page.getByLabel(labels.specificNeeds).fill("Could use a warm winter coat.");
  await page.getByLabel(labels.consent).check();
  await page.getByLabel(labels.livesTogether).check();

  await pdf(page, `02-family-form-filled${prefix}.pdf`);

  await page.getByRole("button", { name: submitLabel }).click();
  await page.getByRole("heading", { name: thankYouHeading }).waitFor();
  await pdf(page, `03-family-form-confirmation${prefix}.pdf`);
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  await page.emulateMedia({ colorScheme: "light" });

  await familyFormFlow(page, {
    formToken: "demo-north-family-2026",
    prefix: "",
    heading: "Reach Christmas Gift Registration",
    submitLabel: "Submit registration",
    thankYouHeading: /Thank you/,
    labels: {
      guardianName: "Parent or guardian name",
      phone: "Phone number",
      email: "Email address",
      preferredLanguage: "What language should we use to contact you?",
      childFirstName: "Child's first name",
      age: "Age",
      grade: "Grade",
      sex: "Boy or girl",
      shirtSize: "Shirt size",
      pantSize: "Pant size",
      shoeSize: "Shoe size",
      firstIdea: "First idea",
      specificNeeds: "Is there anything they especially need?",
      consent: /I understand my household's information/,
      livesTogether: /Everyone I've listed lives in my home/,
    },
    options: {
      language: "English",
      grade: "3rd grade",
      preferNotToSay: "Prefer not to say",
      shirtSize: "Youth M",
      pantSize: "Youth 8",
      shoeSize: "Youth 2",
    },
  });

  // Spanish set — same token as above, toggled to Español on the page itself.
  // Draft translation, see web/lib/intakeFormDefinition.ts's
  // PHASE_1_FORM_DEFINITION_ES — this PDF set is exactly what a native-speaker
  // reviewer should read before it goes to a real family.
  await familyFormFlow(page, {
    formToken: "demo-north-family-2026",
    toggleTo: "Español",
    prefix: "-es",
    heading: "Registro de Regalos de Reach Christmas",
    submitLabel: "Enviar registro",
    thankYouHeading: /Gracias/,
    labels: {
      guardianName: "Nombre del padre, madre o tutor",
      phone: "Número de teléfono",
      email: "Correo electrónico",
      preferredLanguage: "¿En qué idioma preferiría que nos comuniquemos con usted?",
      childFirstName: "Nombre del niño o niña",
      age: "Edad",
      grade: "Grado escolar",
      sex: "Niño o niña",
      shirtSize: "Talla de camisa",
      pantSize: "Talla de pantalón",
      shoeSize: "Talla de zapato",
      firstIdea: "Primera idea",
      specificNeeds: "¿Hay algo que necesiten especialmente?",
      consent: /Entiendo que la información de mi hogar/,
      livesTogether: /Todos los que he mencionado viven en mi hogar/,
    },
    options: {
      language: "Español",
      grade: "3er grado",
      preferNotToSay: "Prefiero no decir",
      shirtSize: "Juvenil M",
      pantSize: "Juvenil 8",
      shoeSize: "Juvenil 2",
    },
  });

  // Counselor review roster — should now show both submissions above (the
  // roster itself is staff-facing and English-only by design; not per-locale).
  await page.goto(`${BASE_URL}/review/${REVIEW_TOKEN}`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Confirm your households" }).waitFor();
  await page.waitForTimeout(500); // let the roster fetch resolve past the loading state
  await pdf(page, "04-counselor-review-roster.pdf");

  // Sponsor browsing page.
  await page.goto(`${BASE_URL}/sponsor`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await pdf(page, "05-sponsor-browse.pdf");

  // Sponsor claim modal (details step), on the first available card.
  const sponsorButton = page.getByRole("button", { name: "Sponsor this gift" }).first();
  if (await sponsorButton.count()) {
    await sponsorButton.click();
    await page.getByRole("heading", { level: 2, name: /^Sponsor / }).waitFor();
    await pdf(page, "06-sponsor-claim-modal.pdf");
  } else {
    console.log("skipped 06-sponsor-claim-modal.pdf: no available cards to click");
  }

  await browser.close();
  console.log("\nAll PDFs written to", OUT_DIR);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
