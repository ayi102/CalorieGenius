import "dotenv/config";
import { defineConfig } from "prisma/config";

// CLI-only configuration. The runtime client does NOT read this — it connects
// through the pg driver adapter in src/lib/prisma.ts.
//
// Migrations need a connection that supports session state; Supabase's
// transaction pooler (port 6543) does not, and `prisma migrate` will fail or hang
// on it. So the CLI takes a separate URL when one is provided.
//
// DIRECT_URL is accepted because that is the name Supabase's own "Connect -> ORM
// -> Prisma" tab emits — following their instructions verbatim should just work,
// rather than requiring a rename. MIGRATION_DATABASE_URL is the explicit
// alternative. Locally, neither is set and DATABASE_URL is the same database.
//
// Read via process.env rather than prisma/config's env() helper, which throws on
// a missing variable and so cannot express an optional override.
const migrationUrl =
  process.env.MIGRATION_DATABASE_URL ??
  process.env.DIRECT_URL ??
  process.env.DATABASE_URL;

if (!migrationUrl) {
  throw new Error(
    "Set DATABASE_URL (or MIGRATION_DATABASE_URL) in .env — see .env.example.",
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: migrationUrl,
  },
});
