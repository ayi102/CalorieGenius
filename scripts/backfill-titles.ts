/**
 * Give a title to entries logged before auto-titling existed.
 *
 *   npx tsx scripts/backfill-titles.ts          # dry run
 *   npx tsx scripts/backfill-titles.ts --write  # apply
 *
 * One model call for ALL untitled meals rather than one each: naming is a tiny
 * task and the per-call overhead would dominate. Distinct prompts are titled
 * once and the name applied to every entry that shares it.
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const write = process.argv.includes("--write");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL! }),
});

const TitlesSchema = z.object({
  titles: z.array(
    z.object({
      index: z.number().int().describe("The index given in the input."),
      title: z
        .string()
        .describe(
          'Short human name, 2-4 words, Title Case, under 30 characters. "Homemade Coffee", not an ingredient list.',
        ),
    }),
  ),
});

async function main() {
  const entries = await prisma.entry.findMany({
    where: { title: null },
    include: { items: { select: { name: true, kcal: true } } },
    orderBy: { eatenAt: "asc" },
  });

  if (entries.length === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  // Distinct prompts only — the same meal logged five times needs one title.
  const byText = new Map<string, typeof entries>();
  for (const e of entries) {
    const key = (e.rawText ?? "").trim().toLowerCase();
    const list = byText.get(key);
    if (list) list.push(e);
    else byText.set(key, [e]);
  }
  const distinct = [...byText.entries()];
  console.log(`${entries.length} untitled entries, ${distinct.length} distinct meals.\n`);

  const input = distinct.map(([, group], i) => ({
    index: i,
    typed: group[0].rawText ?? "",
    ingredients: group[0].items
      .slice()
      .sort((a, b) => b.kcal - a.kcal)
      .map((it) => it.name),
  }));

  const client = new Anthropic();
  const response = await client.messages.parse({
    model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5",
    max_tokens: 4000,
    system:
      'Name each meal the way the person would say it out loud: 2-4 words, Title Case, under 30 characters. "Homemade Coffee", "Yogurt Bowl", "Chicken And Rice". Never a comma-separated ingredient list — that is what they typed, and it is exactly what makes a bad title. Return one title per input index.',
    messages: [{ role: "user", content: JSON.stringify(input, null, 2) }],
    output_config: { effort: "low", format: zodOutputFormat(TitlesSchema) },
  });

  if (!response.parsed_output) throw new Error("No titles returned.");

  const titleBy = new Map(response.parsed_output.titles.map((t) => [t.index, t.title]));

  for (const [i, [text, group]] of distinct.entries()) {
    const title = titleBy.get(i)?.trim();
    if (!title) {
      console.log(`  (skipped) ${text.slice(0, 50)}`);
      continue;
    }
    console.log(`  "${title}"  <- ${group.length}x  ${text.slice(0, 44)}`);
    if (write) {
      await prisma.entry.updateMany({
        where: { id: { in: group.map((g) => g.id) } },
        data: { title },
      });
    }
  }

  const usage = response.usage;
  console.log(
    `\n${write ? "Applied." : "Dry run — pass --write to apply."} (${usage.input_tokens} in / ${usage.output_tokens} out)`,
  );
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
