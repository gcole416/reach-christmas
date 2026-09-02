# Family Intake Form — Draft for Review

*Status: DRAFT for team redline. This is the questionnaire itself, not the system design — see
[INTAKE_FORMS.md](INTAKE_FORMS.md) for that.*

**Two things need human review before this goes anywhere:**

1. **The Spanish needs a fluent speaker on staff to read it.** Form wording carries tone, and a stiff
   translation reads as bureaucratic to a family already uneasy about asking for help.
2. **Four questions collect things the current schema has nowhere to put** — flagged inline as
   ⚠️ **NEW FIELD**. Each needs a yes/no from you before it stays.

---

## Design principles used here

- **Short.** Families fill this on a phone, possibly at a kitchen table with kids around. Every question
  has to earn its place.
- **Selects over free text wherever possible.** Each dropdown is a field nobody has to translate and a
  size nobody enters as "medium." (See [INTAKE_FORMS.md §4.3](INTAKE_FORMS.md#43-reduce-the-translation-surface).)
- **No address, ever.** DESIGN §5 commits to not collecting home addresses. Nothing here breaks that.
- **No school question.** The link already knows the school. Asking is a chance to get it wrong.
- **Warm, not clinical.** This is a church asking a family what their kids would like for Christmas.

---

## Intro screen

> **Reach Christmas — Family Gift Registration**
>
> We're glad you're here. Fill this out for each child in your home you'd like to register, and your
> school counselor will confirm it with us.
>
> This takes about five minutes. We ask only for first names — we never ask for your address.
>
> *Questions? Contact your school counselor.*

> **Reach Christmas — Registro de Regalos para Familias**
>
> Nos alegra que esté aquí. Complete este formulario para cada niño en su hogar que desee registrar, y
> el consejero de su escuela lo confirmará con nosotros.
>
> Toma unos cinco minutos. Solo pedimos los primeros nombres — nunca pedimos su dirección.
>
> *¿Preguntas? Comuníquese con el consejero de su escuela.*

---

## Section 1 — About your family / Sobre su familia

| # | Question (EN) | Question (ES) | Type | Required | Lands in |
|---|---|---|---|---|---|
| 1.1 | Parent or guardian name | Nombre del padre, madre o tutor | text | ✅ | `families.guardian_name` |
| 1.2 | Phone number | Número de teléfono | phone | ✅ | `families.guardian_phone` |
| 1.3 | Email address (optional) | Correo electrónico (opcional) | email | — | `families.guardian_email` |
| 1.4 | What language should we use to contact you? | ¿En qué idioma prefiere que le contactemos? | select: English / Español | ✅ | `families.preferred_language` |

**Notes:**

- **1.1 is a single name field, not first + last.** The guardian's full name is how you'll identify the
  family at a pickup table, and splitting it invites the "which box does my two-part surname go in"
  problem that Spanish-speaking families hit constantly.
- **1.2 is required** — it's the only reliable way to reach a family about pickup, and DESIGN §7 commits
  to supporting a church pickup event.
- **1.4 defaults to the link's locale** but is asked anyway, because the family filling the Spanish form
  isn't necessarily the person who answers the phone in December.

---

## Section 2 — Each child / Cada niño

*Repeating section. "Add another child" / "Agregar otro niño."*

| # | Question (EN) | Question (ES) | Type | Required | Lands in |
|---|---|---|---|---|---|
| 2.1 | Child's first name | Nombre del niño o niña | text | ✅ | `children.first_name` |
| 2.2 | Age | Edad | number (0–19) | ✅ | `children.age` |
| 2.3 | Grade | Grado escolar | select (below) | ✅ | `children.grade` |
| 2.4 | Boy or girl | Niño o niña | select: Boy/Niño, Girl/Niña, Prefer not to say / Prefiero no decir | ✅ | `children.sex` |
| 2.5 | Shirt size | Talla de camisa | select + Other | ✅ | `children.shirt_size` |
| 2.6 | Pant size | Talla de pantalón | select + Other | ✅ | `children.pant_size` |
| 2.7 | Shoe size | Talla de zapato | select + Other | ✅ | `children.shoe_size` |
| 2.8 | What would they like for Christmas? (up to 3 ideas) | ¿Qué le gustaría para Navidad? (hasta 3 ideas) | text × 3, first required | ✅ | `wishlist_items` |
| 2.9 | Is there anything they especially need? | ¿Hay algo que necesite especialmente? | textarea | — | `children.specific_needs` |
| 2.10 | Anything else we should know? | ¿Algo más que debamos saber? | textarea | — | `children.other_notes` |

### Grade options

`Not in school yet / Aún no va a la escuela` · `Pre-K / Pre-Kínder` · `Kindergarten / Kínder` ·
`1st–12th / 1º–12º`

Stored as text — matches SCHEMA.md's deliberate choice to keep `grade` as text for `"K"`, `"1"`, etc.

### Size options

| Field | Options |
|---|---|
| Shirt | Youth XS/S/M/L/XL · Adult XS/S/M/L/XL/XXL · Other (describe) |
| Pant | Youth 4–20 (even) · Adult waist 28–44 · Other (describe) |
| Shoe | Toddler 5–13 · Youth 1–7 · Adult 5–14 · Other (describe) |

Spanish equivalents: `Niños` / `Adulto` / `Otro (describa)`.

**Why selects with an escape hatch:** the 2021 sheet had values like `"32-34"` and `"Girls 6"`. A
dropdown catches ~90% cleanly and the "Other" box preserves the messy real-world cases the schema was
already built to accept. Only "Other" text ever needs translating.

### Wishlist wording

**2.8 is the most important question on the form** and the one most likely to be answered badly. Consider
help text under it:

> Be as specific as you can — brand, color, or size helps a lot. Gifts are usually around $50 per child.
>
> Sea lo más específico posible — la marca, el color o la talla ayudan mucho. Los regalos son
> generalmente de unos $50 por niño.

⚠️ **Confirm the dollar figure before this ships.** Setting expectations here prevents the "a PS5" and
"a puppy" problem better than any validation rule, but only if the number is right.

---

## Section 3 — Pickup and consent

| # | Question (EN) | Question (ES) | Type | Required | Lands in |
|---|---|---|---|---|---|
| 3.1 | If gifts are distributed at the church, can you get there? | Si los regalos se entregan en la iglesia, ¿puede llegar allí? | select: Yes / No / Not sure | ✅ | ⚠️ **NEW FIELD** |
| 3.2 | I understand my family's information will be shared with Reach Church and its volunteers. | Entiendo que la información de mi familia será compartida con Reach Church y sus voluntarios. | checkbox | ✅ | `families.consent_given_at` |

**3.1** exists because DESIGN §7 says distribution method varies year to year and isn't decided yet. If
this year turns out to be church pickup, you need this answer, and you can't collect it retroactively
from 400 families in December. Asking now costs one dropdown; not asking could cost a family their
gifts. Suggested column: `families.can_reach_church_pickup text`.

**3.2** — worth confirming what the church's existing policy says about collecting minors' data before
you finalize the wording. Consider adding a plain-language line about what sponsors actually see:

> Sponsors who provide gifts see only your child's first name, grade, and wish list.
>
> Los patrocinadores que proveen los regalos solo ven el primer nombre, el grado y la lista de deseos de
> su hijo.

That sentence does real work — it's the answer to the unspoken worry a family has when a church asks
about their kids.

---

## Questions I considered and left out

| Candidate | Verdict |
|---|---|
| **Household size** | Cut. Nothing in the drive uses it — you buy per child, not per household. Add only if you start doing family-level gifts (a food box, a household item). |
| **Sibling notes / "keep these together"** | Cut. `families` already groups siblings, and `cards` already handles splitting gifts across sponsors. The grouping is structural, not a note. |
| **Child's last name** | Cut. Guardian name (1.1) plus family number identifies the family at pickup. Collecting minors' surnames without a use is PII you'd have to protect for nothing. |
| **Coat / jacket size** | Cut, but reconsider. Shirt size approximates it, and Houston winters are mild. If coats are a common ask, make it 2.11 rather than letting it land in "specific needs" as untranslated free text. |
| **Best time to reach you** | Cut. Nobody will act on it, and phone tag is a two-minute problem. |
| **Allergies / medical** | Cut deliberately. It invites health information into a database that isn't built to hold it, for gifts that rarely need it. If a food allergy matters, "anything else we should know" catches it. |
| **Photo/media consent** | Cut for year one. If the church photographs a distribution event, that's a separate consent handled at the event, not here. |

---

## Four decisions needed from you

1. **Is 3.1 (transportation to church pickup) worth a new column?** I think yes — it's cheap now and
   impossible to backfill.
2. **What's the actual per-child gift budget** for the help text under 2.8?
3. **Are sizes required?** I've marked them required, which slows the form down but prevents a purchaser
   guessing in December. Making them optional is defensible if most wishes are toys rather than clothes.
4. **Does the consent line (3.2) need review** by whoever owns the church's data policy?

---

## What this maps to in the schema

Everything above lands in existing columns except:

| Form field | Needs |
|---|---|
| 1.1 Guardian name | `families.guardian_name` *(proposed in INTAKE_FORMS.md §5.7)* |
| 1.2 Phone | `families.guardian_phone` *(proposed)* |
| 1.3 Email | `families.guardian_email` *(proposed)* |
| 1.4 Language | `families.preferred_language` *(proposed)* |
| 3.1 Pickup transport | ⚠️ **`families.can_reach_church_pickup`** — not yet proposed anywhere |
| 3.2 Consent | `families.consent_given_at` *(proposed)* |

The per-child fields all map cleanly onto `children` and `wishlist_items` as they stand — which is the
payoff of having designed the schema from the 2021 spreadsheet first.
