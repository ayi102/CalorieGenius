/**
 * Assert the environment is complete for the current AUTH_MODE and provider.
 * Exits non-zero with actionable messages. Never prints secret values.
 *
 *   npm run check:env
 */

import "dotenv/config";

interface Requirement {
  name: string;
  required: boolean;
  hint: string;
  /** Optional extra validation of the value's shape. */
  validate?: (v: string) => string | null;
}

const mode = process.env.AUTH_MODE ?? "dev";
const provider = process.env.PARSER_PROVIDER ?? "anthropic";

const requirements: Requirement[] = [
  {
    name: "DATABASE_URL",
    required: true,
    hint: "postgresql://<your-macos-user>@localhost:5432/caloriegenius",
    validate: (v) =>
      v.startsWith("postgres://") || v.startsWith("postgresql://")
        ? null
        : "must be a postgres:// or postgresql:// URL",
  },
  {
    name: "DIRECT_URL",
    required: false,
    hint: "Supabase direct/session connection (port 5432) — migrations only. MIGRATION_DATABASE_URL is an accepted alias.",
    validate: (v) =>
      v.includes(":6543")
        ? "points at the TRANSACTION pooler (6543); migrations need the 5432 connection"
        : null,
  },
  {
    name: "AUTH_MODE",
    required: false,
    hint: 'dev | supabase (defaults to "dev")',
    validate: (v) =>
      v === "dev" || v === "supabase" ? null : 'must be "dev" or "supabase"',
  },
  {
    name: "PARSER_PROVIDER",
    required: false,
    hint: 'anthropic | ollama (defaults to "anthropic")',
    validate: (v) =>
      v === "anthropic" || v === "ollama"
        ? null
        : 'must be "anthropic" or "ollama"',
  },
  {
    name: "ANTHROPIC_API_KEY",
    required: provider === "anthropic",
    hint: "Create at https://platform.claude.com/settings/keys — it is shown only once.",
    validate: (v) =>
      v.startsWith("sk-ant-")
        ? null
        : 'does not look like an Anthropic key (expected it to start with "sk-ant-")',
  },
  {
    name: "ANTHROPIC_MODEL",
    required: false,
    hint: 'defaults to "claude-opus-5"',
  },
  {
    name: "DAILY_PARSE_LIMIT",
    required: false,
    hint: "positive integer; defaults to 30",
    validate: (v) =>
      Number.isFinite(Number(v)) && Number(v) > 0
        ? null
        : "must be a positive number",
  },
  {
    name: "USDA_FDC_API_KEY",
    required: true,
    hint: "Free key: https://api.data.gov/signup",
  },
  {
    name: "OFF_USER_AGENT",
    required: true,
    hint: 'Open Food Facts requires "AppName/1.0 (contact@email)" — use a personal address.',
    validate: (v) =>
      /\(.+@.+\..+\)/.test(v)
        ? v.includes("your-personal@email.com")
          ? "still the placeholder address — put a real contact email in it"
          : null
        : "must include a contact email in parentheses",
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_URL",
    required: mode === "supabase",
    hint: "Only needed once AUTH_MODE=supabase (the deploy step).",
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    required: mode === "supabase",
    hint: "Only needed once AUTH_MODE=supabase (the deploy step).",
  },
];

let errors = 0;
let warnings = 0;

console.log(`AUTH_MODE=${mode}  PARSER_PROVIDER=${provider}\n`);

for (const r of requirements) {
  const raw = process.env[r.name];
  const value = raw && raw.length > 0 ? raw : undefined;

  if (!value) {
    if (r.required) {
      errors++;
      console.error(`  MISSING  ${r.name}\n           ${r.hint}`);
    } else {
      console.log(`  default  ${r.name}  (${r.hint})`);
    }
    continue;
  }

  const problem = r.validate?.(value);
  if (problem) {
    // A malformed *optional* value is still a real problem, so it errors too;
    // only the placeholder contact email is a warning.
    const isPlaceholder = problem.includes("placeholder");
    if (isPlaceholder) {
      warnings++;
      console.warn(`  WARN     ${r.name}  ${problem}`);
    } else {
      errors++;
      console.error(`  INVALID  ${r.name}  ${problem}\n           ${r.hint}`);
    }
    continue;
  }

  // Never echo secrets. Show only enough to confirm which value is loaded.
  const isSecret = /KEY|SECRET|TOKEN|PASSWORD|URL/i.test(r.name);
  const shown = isSecret ? `set (${value.length} chars)` : value;
  console.log(`  ok       ${r.name}  ${shown}`);
}

console.log("");
if (errors > 0) {
  console.error(`${errors} problem(s) to fix. See .env.example.`);
  process.exit(1);
}
if (warnings > 0) {
  console.warn(`Environment usable, with ${warnings} warning(s).`);
} else {
  console.log("Environment looks good.");
}
