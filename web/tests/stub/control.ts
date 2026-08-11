// Thin client for the stub server's control plane (see postgrestStub.mjs).
export const STUB_URL = process.env.STUB_URL ?? "http://127.0.0.1:54999";

async function call(path: string, init?: RequestInit) {
  const res = await fetch(`${STUB_URL}${path}`, init);
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

export function resetStub(tables: unknown, viewer: unknown) {
  return call("/__control/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tables, viewer }),
  });
}

export function dumpStub(): Promise<Record<string, Record<string, unknown>[]>> {
  return call("/__control/db");
}

export function stubRequests(): Promise<{ method: string; table: string; query: string; prefer: string | null }[]> {
  return call("/__control/requests");
}

/** Simulates the second volunteer's save landing while our form sits open. */
export function otherUserUpdates(table: string, id: string, patch: Record<string, unknown>) {
  return call("/__control/update", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ table, id, patch }),
  });
}

export async function rowById(table: string, id: string) {
  const db = await dumpStub();
  const row = (db[table] ?? []).find((r) => r.id === id);
  if (!row) throw new Error(`${table}/${id} not found in stub`);
  return row;
}
