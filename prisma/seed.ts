/**
 * Seed two local users.
 *
 * Two, not one, on purpose: the bug class that actually matters in this app is a
 * query that forgets `where: { userId }`, and you cannot see that with a single
 * account. scripts/check-isolation.ts asserts against these two.
 *
 * Idempotent — safe to re-run.
 */

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set — copy .env.example to .env.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

/**
 * Stable, obviously-fake ids. Under Supabase these become real `sub` UUIDs; the
 * `dev-` prefix makes it unmistakable which rows came from the pilot.
 */
const USERS = [
  {
    userId: "dev-alice",
    email: "alice@example.com",
    name: "Alice",
    timezone: "America/New_York",
    sex: "female" as const,
    birthDate: new Date(Date.UTC(1991, 3, 12)),
    heightCm: 165,
    weightKg: 62,
    activityLevel: "moderate" as const,
    goal: "lose" as const,
    bedtimeMinutes: 1380, // 23:00
  },
  {
    userId: "dev-bob",
    email: "bob@example.com",
    name: "Bob",
    timezone: "America/Los_Angeles",
    sex: "male" as const,
    birthDate: new Date(Date.UTC(1986, 9, 2)),
    heightCm: 182,
    weightKg: 88,
    activityLevel: "light" as const,
    goal: "maintain" as const,
    bedtimeMinutes: 1410, // 23:30
  },
];

async function main() {
  for (const u of USERS) {
    const profile = await prisma.profile.upsert({
      where: { userId: u.userId },
      update: {
        email: u.email,
        name: u.name,
        timezone: u.timezone,
        sex: u.sex,
        birthDate: u.birthDate,
        heightCm: u.heightCm,
        weightKg: u.weightKg,
        activityLevel: u.activityLevel,
        goal: u.goal,
        bedtimeMinutes: u.bedtimeMinutes,
      },
      create: u,
    });
    console.log(`  profile  ${profile.userId.padEnd(10)} ${profile.email} (${profile.timezone})`);
  }

  const count = await prisma.profile.count();
  console.log(`\n${USERS.length} profiles seeded; ${count} total in the database.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
