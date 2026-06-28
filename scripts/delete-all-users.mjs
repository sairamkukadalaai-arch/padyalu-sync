// Deletes ALL non-admin auth users so they can be reimported with new username format.
// Run from project root: node scripts/delete-all-users.mjs
// IMPORTANT: This is destructive. Admin accounts (role = 'admin' in profiles) are preserved.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../.env.local");
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Fetch all admin user IDs from profiles table so we never delete them
const { data: adminProfiles } = await admin.from("profiles").select("id").eq("role", "admin");
const adminIds = new Set((adminProfiles ?? []).map(p => p.id));
console.log(`Admin accounts to preserve: ${adminIds.size}`);

// List all auth users (paginated — Supabase returns max 1000 per page)
let page = 1;
const toDelete = [];
while (true) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) { console.error("listUsers error:", error.message); process.exit(1); }
  const users = data?.users ?? [];
  if (users.length === 0) break;
  for (const u of users) {
    if (!adminIds.has(u.id)) toDelete.push(u);
  }
  if (users.length < 1000) break;
  page++;
}

console.log(`Users to delete: ${toDelete.length}`);
if (toDelete.length === 0) { console.log("Nothing to do."); process.exit(0); }

const BATCH = 10;
let ok = 0, fail = 0;

for (let i = 0; i < toDelete.length; i += BATCH) {
  const batch = toDelete.slice(i, i + BATCH);
  await Promise.all(batch.map(async u => {
    const { error } = await admin.auth.admin.deleteUser(u.id);
    if (error) { console.error(`FAIL ${u.email}: ${error.message}`); fail++; }
    else ok++;
  }));
  if ((i + BATCH) % 100 === 0) console.log(`  ${i + BATCH}/${toDelete.length} processed...`);
}

console.log(`\nDone — ${ok} deleted, ${fail} failed.`);
