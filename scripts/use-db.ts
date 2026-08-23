/**
 * Switch .env between the local Postgres database and the Supabase one.
 *
 *   npm run db:local   # develop against localhost — safe to seed and wipe
 *   npm run db:cloud   # point at Supabase — this is PRODUCTION data
 *
 * Exists because pointing local dev at production is an easy way to write test
 * meals into someone's real food diary. The cloud strings are preserved under
 * CLOUD_* so switching is lossless.
 */

import { readFileSync, writeFileSync } from "node:fs";

const target = process.argv[2];
if (target !== "local" && target !== "cloud") {
  console.error("Usage: tsx scripts/use-db.ts <local|cloud>");
  process.exit(1);
}

const LOCAL_URL = "postgresql://ayi102@localhost:5432/caloriegenius";

const path = ".env";
const lines = readFileSync(path, "utf8").split("\n");

const read = (name: string): string | null => {
  for (const l of lines) {
    const m = new RegExp(`^${name}=(.*)$`).exec(l.trim());
    if (m) return m[1];
  }
  return null;
};

const cloudUrl = read("CLOUD_DATABASE_URL");
const cloudDirect = read("CLOUD_DIRECT_URL");

if (target === "cloud" && (!cloudUrl || !cloudDirect)) {
  console.error(
    "No CLOUD_DATABASE_URL / CLOUD_DIRECT_URL saved in .env — cannot switch to cloud.",
  );
  process.exit(1);
}

const set = (name: string, value: string) => {
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith(`${name}=`)) {
      lines[i] = `${name}=${value}`;
      found = true;
      break;
    }
  }
  if (!found) lines.push(`${name}=${value}`);
};

if (target === "local") {
  set("DATABASE_URL", `"${LOCAL_URL}"`);
  set("DIRECT_URL", `"${LOCAL_URL}"`);
  // Local Postgres has no Supabase auth, so dev auth is the only workable mode.
  set("AUTH_MODE", '"dev"');
} else {
  set("DATABASE_URL", cloudUrl!);
  set("DIRECT_URL", cloudDirect!);
  set("AUTH_MODE", '"supabase"');
}

writeFileSync(path, lines.join("\n"));

console.log(
  target === "local"
    ? "Now pointing at LOCAL Postgres, AUTH_MODE=dev. Restart the dev server."
    : "Now pointing at SUPABASE (production data), AUTH_MODE=supabase. Restart the dev server.",
);
