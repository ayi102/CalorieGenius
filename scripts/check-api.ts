/**
 * Live smoke test for the Anthropic API key.
 *
 * Makes ONE minimal real call and reports whether auth, credits, and the model
 * all work — the fastest way to tell a bad key from an empty balance from a
 * typo'd model name. Costs a fraction of a cent.
 *
 *   npx tsx scripts/check-api.ts
 *
 * Never prints the key.
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

const key = process.env.ANTHROPIC_API_KEY;
const model = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";

if (!key) {
  console.error(
    "ANTHROPIC_API_KEY is not set.\n" +
      "  1. https://platform.claude.com/settings/keys -> Create Key\n" +
      "  2. Paste it into .env as ANTHROPIC_API_KEY=\"sk-ant-...\"\n" +
      "  (The key is shown only once. Never paste it into a chat.)",
  );
  process.exit(1);
}

// Priced per million tokens, for the cost estimate below.
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

async function main() {
  const client = new Anthropic();
  console.log(`Calling ${model} with a minimal prompt...\n`);

  const started = Date.now();
  const response = await client.messages.create({
    model,
    max_tokens: 16,
    messages: [
      {
        role: "user",
        content: 'Reply with exactly the word "ok" and nothing else.',
      },
    ],
  });
  const elapsed = Date.now() - started;

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const { input_tokens: inTok, output_tokens: outTok } = response.usage;
  const price = PRICING[model];
  const cost = price
    ? (inTok / 1e6) * price.input + (outTok / 1e6) * price.output
    : null;

  console.log(`  reply         ${JSON.stringify(text)}`);
  console.log(`  model         ${response.model}`);
  console.log(`  stop_reason   ${response.stop_reason}`);
  console.log(`  tokens        ${inTok} in / ${outTok} out`);
  if (cost !== null) {
    console.log(`  cost          ~$${cost.toFixed(6)} (${(cost * 100).toFixed(4)}¢)`);
  }
  console.log(`  latency       ${elapsed} ms`);
  console.log("\nAPI access works. Key, credits, and model are all good.");
}

main().catch((error: unknown) => {
  // Most specific first. APIConnectionError must precede APIError — in the
  // TypeScript SDK it is a subclass of it.
  if (error instanceof Anthropic.AuthenticationError) {
    console.error(
      "AUTHENTICATION FAILED (401) — the key is wrong, revoked, or has a stray\n" +
        "space/newline. Regenerate at https://platform.claude.com/settings/keys",
    );
  } else if (error instanceof Anthropic.PermissionDeniedError) {
    console.error(
      `PERMISSION DENIED (403) — type "${error.type}".\n` +
        'If this says "billing", the account has no credit balance: add credits at\n' +
        "https://platform.claude.com/settings/billing (minimum $5, no subscription).",
    );
  } else if (error instanceof Anthropic.NotFoundError) {
    console.error(
      `MODEL NOT FOUND (404) — "${model}" is not available to this account.\n` +
        "Check ANTHROPIC_MODEL in .env for a typo.",
    );
  } else if (error instanceof Anthropic.BadRequestError) {
    console.error(
      `BAD REQUEST (400) — ${error.message}\n` +
        'A "credit balance is too low" message here means you need to add credits.',
    );
  } else if (error instanceof Anthropic.RateLimitError) {
    console.error("RATE LIMITED (429) — wait a moment and re-run.");
  } else if (error instanceof Anthropic.APIConnectionError) {
    console.error(`CONNECTION FAILED — could not reach the API. ${error.message}`);
  } else if (error instanceof Anthropic.APIError) {
    console.error(`API ERROR ${error.status} (${error.type}) — ${error.message}`);
  } else {
    console.error("UNEXPECTED ERROR", error);
  }
  process.exit(1);
});
