/**
 * Text (or photo) -> structured meal.
 *
 * Behind a provider interface so the app is never locked to one vendor: the
 * Anthropic provider is the default because parse quality *is* the product, but
 * swapping in a local model is a config change, not a refactor.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { env, parserProvider } from "@/lib/env";
import { PARSE_SYSTEM_PROMPT, PHOTO_INSTRUCTION } from "./prompt";
import {
  ParsedMealSchema,
  type ParseContext,
  type ParseResult,
  type ParserProvider,
} from "./types";

/** Per-million-token rates, for the cost estimate stored on ParseUsage. */
const PRICING: Record<string, { input: number; cachedInput: number; output: number }> = {
  "claude-opus-5": { input: 5, cachedInput: 0.5, output: 25 },
  "claude-sonnet-5": { input: 3, cachedInput: 0.3, output: 15 },
  "claude-haiku-4-5": { input: 1, cachedInput: 0.1, output: 5 },
};

export function estimateCostCents(
  model: string,
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number },
): number {
  const p = PRICING[model];
  if (!p) return 0;
  const dollars =
    (usage.cachedInputTokens / 1e6) * p.cachedInput +
    (usage.inputTokens / 1e6) * p.input +
    (usage.outputTokens / 1e6) * p.output;
  return dollars * 100;
}

class AnthropicParser implements ParserProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor() {
    // Throws early with an actionable message if the key is absent.
    env.anthropicApiKey();
    this.client = new Anthropic();
  }

  async parse(text: string, context: ParseContext): Promise<ParseResult> {
    const model = env.anthropicModel();
    const isPhoto = Boolean(context.imageBase64);

    // The system prompt is long and byte-stable, so it caches. The breakpoint
    // goes at its end; everything request-specific lives in the user message
    // AFTER it, or the cache would be invalidated on every call.
    const system: Anthropic.TextBlockParam[] = [
      {
        type: "text",
        text: PARSE_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ];

    const userContent: Anthropic.ContentBlockParam[] = [];

    if (isPhoto) {
      userContent.push({
        type: "image",
        source: {
          type: "base64",
          media_type: context.imageMediaType ?? "image/jpeg",
          data: context.imageBase64!,
        },
      });
      userContent.push({ type: "text", text: PHOTO_INSTRUCTION });
    }

    const restaurantHint = context.restaurantName
      ? `\n\nThis was eaten at: ${context.restaurantName}. Use restaurant-sized portions.`
      : "";

    userContent.push({
      type: "text",
      text: `Parse this into structured nutrition data:\n\n${text}${restaurantHint}`,
    });

    const response = await this.client.messages.parse({
      model,
      max_tokens: 8000,
      system,
      messages: [{ role: "user", content: userContent }],
      thinking: { type: "adaptive" },
      output_config: {
        // A photo is a materially harder task than a sentence, and it is the one
        // place extra reasoning clearly pays for itself.
        effort: isPhoto ? "high" : "medium",
        format: zodOutputFormat(ParsedMealSchema),
      },
    });

    // parsed_output is null when validation fails. Never assert it.
    if (!response.parsed_output) {
      throw new Error(
        `The parser returned no valid structured output (stop_reason: ${response.stop_reason}).`,
      );
    }

    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cachedInputTokens: response.usage.cache_read_input_tokens ?? 0,
    };

    return { meal: response.parsed_output, usage, model, cached: false };
  }
}

class OllamaParser implements ParserProvider {
  readonly name = "ollama";
  async parse(): Promise<ParseResult> {
    throw new Error(
      "PARSER_PROVIDER=ollama is a documented escape hatch but is not implemented. " +
        'Set PARSER_PROVIDER="anthropic".',
    );
  }
}

let cached: ParserProvider | null = null;

/** The configured provider. Constructed once, lazily. */
export function getParser(): ParserProvider {
  if (cached) return cached;
  cached = parserProvider() === "ollama" ? new OllamaParser() : new AnthropicParser();
  return cached;
}
