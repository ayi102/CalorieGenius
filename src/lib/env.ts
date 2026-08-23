/**
 * Validated environment access.
 *
 * Every read goes through here so a missing variable fails loudly at the point
 * of use with a message that says what to do, rather than surfacing later as
 * `undefined` inside an HTTP call.
 */

export type AuthMode = "dev" | "supabase";
export type ParserProvider = "anthropic" | "ollama";

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

export function authMode(): AuthMode {
  const mode = optional("AUTH_MODE", "dev");
  if (mode !== "dev" && mode !== "supabase") {
    throw new Error(`AUTH_MODE must be "dev" or "supabase", got "${mode}".`);
  }
  // A cookie-trusting auth provider must never *serve* production traffic.
  //
  // The guard deliberately exempts the build: `next build` runs with
  // NODE_ENV=production and prerenders pages, so keying only on NODE_ENV would
  // make `npm run build` — which is also this project's typecheck — impossible
  // to run locally. NEXT_PHASE distinguishes building from serving.
  //
  // Note this protects a deployment mistake, not an attacker: someone who can
  // set AUTH_MODE can set anything. Its job is to make "shipped the pilot's
  // auth by accident" fail loudly at boot instead of silently.
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";
  if (mode === "dev" && process.env.NODE_ENV === "production" && !isBuild) {
    throw new Error(
      'AUTH_MODE="dev" trusts a cookie and is refused when serving production traffic. Set AUTH_MODE="supabase".',
    );
  }
  return mode;
}

export function parserProvider(): ParserProvider {
  const p = optional("PARSER_PROVIDER", "anthropic");
  if (p !== "anthropic" && p !== "ollama") {
    throw new Error(
      `PARSER_PROVIDER must be "anthropic" or "ollama", got "${p}".`,
    );
  }
  return p;
}

export const env = {
  databaseUrl: () => required("DATABASE_URL"),
  anthropicApiKey: () => required("ANTHROPIC_API_KEY"),
  anthropicModel: () => optional("ANTHROPIC_MODEL", "claude-opus-5"),
  usdaApiKey: () => required("USDA_FDC_API_KEY"),
  offUserAgent: () =>
    optional("OFF_USER_AGENT", "CalorieGenius/1.0 (unset@example.com)"),
  dailyParseLimit: () => {
    const n = Number(optional("DAILY_PARSE_LIMIT", "30"));
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error("DAILY_PARSE_LIMIT must be a positive number.");
    }
    return Math.floor(n);
  },
};
