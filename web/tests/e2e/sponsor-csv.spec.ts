import { test, expect } from "@playwright/test";
import {
  buildImportPayload,
  snapshotOf,
  defaultSelection,
  parseChurchCenterSubmitted,
  parseSponsorCsv,
  planSponsorImport,
  type ParsedSponsorCsv,
  type RosterSnapshot,
} from "../../lib/sponsorCsv";

// US-76: the Church Center import/update plan. Pure functions, no browser,
// no database: nothing here touches dev. All names, emails and addresses
// below are made up; the header row is the real Church Center export's.

const CC_HEADER =
  "Registration ID,Registration Contact First Name,Registration Contact Last Name,Registration Contact Phone Number," +
  "Registration Contact Address,Registration Contact Home Email Address,Registration Contact Work Email Address," +
  "Registration Contact Other Email Address,Selection,Count,Status,Submitted,Registration Cost";

function ccRow(o: {
  id: string;
  first: string;
  last: string;
  phone?: string;
  email?: string;
  count?: string;
  status?: string;
  submitted?: string;
}) {
  return [
    o.id,
    o.first,
    o.last,
    o.phone ?? "(555) 010-0000",
    '"1 Test Ln Springfield, TX 77000"',
    o.email ?? "",
    '""',
    '""',
    "How Many Children Would You Like To Shop For?",
    o.count ?? "1",
    o.status ?? "Active",
    o.submitted ?? "11/14/2026 at 5:00pm",
    "$0",
  ].join(",");
}

function parse(text: string): ParsedSponsorCsv {
  const r = parseSponsorCsv(text);
  if (!r.ok) throw new Error(r.error);
  return r.parsed;
}

function entry(o: Partial<RosterSnapshot> & { id: string; displayName: string }): RosterSnapshot {
  return {
    contactEmail: null,
    contactPhone: null,
    capacity: null,
    isActive: true,
    assignedCount: 0,
    churchCenterRegistrationId: null,
    signedUpAt: null,
    ...o,
    churchCenterSnapshot: o.churchCenterSnapshot ?? null,
  };
}

test.describe("Church Center CSV parsing", () => {
  test("reads the real export shape without keeping addresses", () => {
    const parsed = parse(
      [
        CC_HEADER,
        ccRow({ id: "1001", first: "Ada", last: "Tester", email: "ada@example.com;ada.work@example.com", count: "3" }),
        ccRow({ id: "1002", first: "Mary Ann", last: "De Test", count: "x" }),
      ].join("\r\n") + "\r\n",
    );
    expect(parsed.format).toBe("church_center");
    expect(parsed.rows).toHaveLength(2);
    const [a, b] = parsed.rows;
    expect(a.registrationId).toBe("1001");
    expect(a.displayName).toBe("Ada Tester");
    expect(a.emails).toEqual(["ada@example.com", "ada.work@example.com"]);
    expect(a.capacity).toBe(3);
    expect(a.status).toBe("Active");
    expect(a.signedUpAt).not.toBeNull();
    expect(JSON.stringify(parsed)).not.toContain("Test Ln");
    expect(b.displayName).toBe("Mary Ann De Test");
    expect(b.capacity).toBeNull();
    expect(b.capacityRaw).toBe("x");
  });

  test("reads Church Center's Submitted time as local time", () => {
    const iso = parseChurchCenterSubmitted("11/14/2026 at 5:00pm")!;
    const d = new Date(iso);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 10, 14, 17, 0]);
    expect(new Date(parseChurchCenterSubmitted("1/2/2026 at 12:05am")!).getHours()).toBe(0);
    expect(parseChurchCenterSubmitted("not a date")).toBeNull();
  });

  test("still accepts the simple name,email,phone,capacity file", () => {
    const parsed = parse("name,email,phone,capacity\nPat Example,pat@example.com,555-0100,2\n");
    expect(parsed.format).toBe("simple");
    expect(parsed.rows[0]).toMatchObject({ displayName: "Pat Example", emails: ["pat@example.com"], capacity: 2 });
  });

  test("explains an unrecognized file", () => {
    const r = parseSponsorCsv("first,last\nA,B\n");
    expect(r.ok).toBe(false);
  });
});

test.describe("Import plan", () => {
  test("first import: everyone new, a second registration with the same email is a possible duplicate", () => {
    const parsed = parse(
      [
        CC_HEADER,
        ccRow({ id: "1", first: "Ada", last: "Tester", email: "ada@example.com", count: "2" }),
        ccRow({ id: "2", first: "Ben", last: "Tester", email: "ben@example.com" }),
        ccRow({ id: "3", first: "Ada", last: "Tester", email: "ada@example.com", count: "2" }),
        ccRow({ id: "4", first: "Cy", last: "Gone", email: "cy@example.com", status: "Canceled" }),
        ccRow({ id: "5", first: "", last: "", email: "noname@example.com" }),
      ].join("\n"),
    );
    const plan = planSponsorImport(parsed, []);
    expect(plan.newRows.map((n) => n.row.registrationId)).toEqual(["1", "2"]);
    expect(plan.duplicates.map((d) => d.row.registrationId)).toEqual(["3"]);
    expect(plan.skipped.map((s) => s.row.registrationId)).toEqual(["4", "5"]);

    const payload = buildImportPayload(plan, defaultSelection(plan));
    expect(payload.p_new).toHaveLength(2);
    expect(payload.p_updates).toHaveLength(0);
    expect(payload.p_counts).toEqual({ unchanged: 0, skipped: 3, flagged: 0 });

    const sel = defaultSelection(plan);
    sel.duplicateLines.add(plan.duplicates[0].row.lineNumber);
    expect(buildImportPayload(plan, sel).p_new).toHaveLength(3);
  });

  test("re-import keeps everyone already there and only adds new sign-ups", () => {
    const roster: RosterSnapshot[] = [
      entry({ id: "a", displayName: "Ada Tester", contactEmail: "ada@example.com", contactPhone: "(555) 010-0000", capacity: 2, assignedCount: 2, churchCenterRegistrationId: "1", signedUpAt: "2026-11-14T23:00:00.000Z" }),
      entry({ id: "b", displayName: "Ben Tester", contactEmail: "ben@example.com", contactPhone: "(555) 010-0000", capacity: 1, assignedCount: 0, churchCenterRegistrationId: "2", signedUpAt: "2026-11-14T23:00:00.000Z" }),
      entry({ id: "c", displayName: "Cara Tester", contactEmail: "cara@example.com", capacity: 3, assignedCount: 3, churchCenterRegistrationId: "3" }),
      entry({ id: "d", displayName: "Dee Tester", contactEmail: "dee@example.com", capacity: 1, assignedCount: 1, churchCenterRegistrationId: "4" }),
      entry({ id: "h", displayName: "Hand Added", contactEmail: "hand@example.com", capacity: 1 }),
    ];
    const parsed = parse(
      [
        CC_HEADER,
        ccRow({ id: "1", first: "Ada", last: "Tester", email: "ada@example.com", count: "2" }), // unchanged
        ccRow({ id: "2", first: "Ben", last: "Tester", email: "ben.new@example.com", count: "1" }), // email changed
        ccRow({ id: "3", first: "Cara", last: "Tester", email: "cara@example.com", count: "1" }), // count below assigned
        // id 4 (Dee) missing from this export
        ccRow({ id: "6", first: "Hand", last: "Added", email: "HAND@example.com", count: "2" }), // links hand-added
        ccRow({ id: "7", first: "New", last: "Person", email: "new@example.com", count: "2" }), // new
      ].join("\n"),
    );
    const plan = planSponsorImport(parsed, roster);

    expect(plan.newRows.map((n) => n.row.displayName)).toEqual(["New Person"]);
    expect(plan.unchanged.map((u) => u.entry.id)).toEqual(["a"]);

    const byId = Object.fromEntries(plan.updates.map((u) => [u.entry.id, u]));
    expect(Object.keys(byId).sort()).toEqual(["b", "c", "h"]);
    expect(byId.b.patch).toEqual({ contact_email: "ben.new@example.com" }); // only what changed
    // Cara: count dropped to 1 but 3 are assigned, so her limit is left at 3
    // (flagged below); the only change is the phone her entry was missing.
    expect(byId.c.patch.contact_phone).toBe("(555) 010-0000");
    expect(byId.c.patch.capacity).toBeUndefined();
    expect(byId.h.patch).toMatchObject({ church_center_registration_id: "6", capacity: 2 });
    expect(byId.h.patch.contact_email).toBeUndefined(); // same address, different case

    expect(plan.flagged.map((f) => [f.entry.id, f.kind]).sort()).toEqual([
      ["c", "capacity_kept"],
      ["d", "missing"],
    ]);
    expect(plan.duplicates).toHaveLength(0);
  });

  test("a cancelled registration already on the roster is flagged, never changed", () => {
    const roster = [entry({ id: "a", displayName: "Ada Tester", contactEmail: "ada@example.com", capacity: 2, assignedCount: 1, churchCenterRegistrationId: "1" })];
    const plan = planSponsorImport(
      parse([CC_HEADER, ccRow({ id: "1", first: "Ada", last: "Tester", email: "ada@example.com", status: "Canceled" })].join("\n")),
      roster,
    );
    expect(plan.flagged).toHaveLength(1);
    expect(plan.flagged[0].kind).toBe("cancelled");
    expect(plan.updates).toHaveLength(0);
    expect(buildImportPayload(plan, defaultSelection(plan)).p_updates).toHaveLength(0);
  });

  test("keeps the roster's email when it's the row's second address", () => {
    const roster = [entry({ id: "a", displayName: "Ada Tester", contactEmail: "ada.work@example.com", contactPhone: "(555) 010-0000", capacity: 1, churchCenterRegistrationId: "1", signedUpAt: "2026-11-14T23:00:00.000Z" })];
    const plan = planSponsorImport(
      parse([CC_HEADER, ccRow({ id: "1", first: "Ada", last: "Tester", email: "ada@example.com;ada.work@example.com" })].join("\n")),
      roster,
    );
    expect(plan.unchanged).toHaveLength(1);
  });

  test("simple-format re-import matches by email instead of adding twice", () => {
    const roster = [entry({ id: "a", displayName: "Pat Example", contactEmail: "pat@example.com", contactPhone: "555-0100", capacity: 2 })];
    const plan = planSponsorImport(parse("name,email,phone,capacity\nPat Example,PAT@example.com,555-0100,2\n"), roster);
    expect(plan.newRows).toHaveLength(0);
    expect(plan.unchanged).toHaveLength(1);
  });
});

test.describe("Hand edits survive re-imports", () => {
  const ADA = ccRow({ id: "1", first: "Ada", last: "Tester", email: "ada@example.com", count: "2" });
  const parsedAda = (count: string) =>
    parse([CC_HEADER, ccRow({ id: "1", first: "Ada", last: "Tester", email: "ada@example.com", count })].join("\n"));
  const lastImported = snapshotOf(parse([CC_HEADER, ADA].join("\n")).rows[0]);

  test("a count staff raised by hand isn't reverted while Church Center still says the same", () => {
    // Ada registered twice (2 + 2); staff merged her into one entry with 4.
    const roster = [
      entry({ id: "a", displayName: "Ada Tester", contactEmail: "ada@example.com", contactPhone: "(555) 010-0000", capacity: 4, churchCenterRegistrationId: "1", signedUpAt: "2026-11-14T23:00:00.000Z", churchCenterSnapshot: lastImported }),
    ];
    const plan = planSponsorImport(parsedAda("2"), roster);
    expect(plan.updates).toHaveLength(0);
    expect(plan.unchanged).toHaveLength(1);
    expect(buildImportPayload(plan, defaultSelection(plan)).p_updates).toHaveLength(0);
  });

  test("a real Church Center change is still proposed, and unticking it is remembered", () => {
    const roster = [
      entry({ id: "a", displayName: "Ada Tester", contactEmail: "ada@example.com", contactPhone: "(555) 010-0000", capacity: 4, churchCenterRegistrationId: "1", signedUpAt: "2026-11-14T23:00:00.000Z", churchCenterSnapshot: lastImported }),
    ];
    const plan = planSponsorImport(parsedAda("3"), roster);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].patch).toEqual({ capacity: 3 });

    const sel = defaultSelection(plan);
    sel.updateLines.clear(); // staff keep 4
    const payload = buildImportPayload(plan, sel);
    expect(payload.p_updates).toEqual([{ id: "a", church_center_snapshot: snapshotOf(parsedAda("3").rows[0]) }]);
    expect(payload.p_counts.unchanged).toBe(1);
  });

  test("new entries carry their snapshot; the simple format never writes one", () => {
    const cc = planSponsorImport(parse([CC_HEADER, ADA].join("\n")), []);
    expect(buildImportPayload(cc, defaultSelection(cc)).p_new[0].church_center_snapshot).toEqual(lastImported);
    const simple = planSponsorImport(parse("name,email\nPat Example,pat@example.com\n"), []);
    expect(buildImportPayload(simple, defaultSelection(simple)).p_new[0].church_center_snapshot).toBeNull();
  });
});
