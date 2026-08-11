// Step 0: confirm which project we're pointed at, and whether the dev test
// accounts can actually sign in (database-engineer reported "Email not
// confirmed"). Read-only.
import { projectRef, assertDevProject, anonClient } from "./env.mjs";

console.log("resolved project ref:", projectRef());
console.log("assertDevProject():", assertDevProject());

for (const role of ["admin", "volunteer"]) {
  const email = role === "admin" ? process.env.TEST_ADMIN_EMAIL : process.env.TEST_VOLUNTEER_EMAIL;
  const password = role === "admin" ? process.env.TEST_ADMIN_PASSWORD : process.env.TEST_VOLUNTEER_PASSWORD;
  if (!email || !password) {
    console.log(`${role}: NO CREDENTIALS in .env.test.local`);
    continue;
  }
  const c = anonClient();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  console.log(
    `${role} (${email}):`,
    error ? `FAIL — ${error.status} ${error.code ?? ""} ${error.message}` : `OK — user ${data.user?.id}`
  );
}

// What can anon read? Should be public_available_cards only.
const anon = anonClient();
const fam = await anon.from("families").select("id").limit(1);
console.log("anon select families:", fam.error ? `blocked (${fam.error.message})` : `${fam.data.length} rows`);
const cards = await anon.from("public_available_cards").select("*").limit(1);
console.log(
  "anon select public_available_cards:",
  cards.error ? `blocked (${cards.error.message})` : `${cards.data.length} rows; cols=${Object.keys(cards.data[0] ?? {}).join(",")}`
);
