/**
 * Live check of the barcode path: Open Food Facts lookup + serving parsing.
 *
 * Makes real requests (OFF allows 15/min), so keep the fixture list short.
 *
 *   npx tsx scripts/check-barcode.ts
 */

import "dotenv/config";
import { lookupBarcode, parseServingGrams } from "../src/lib/nutrition/off";

let failures = 0;
let checks = 0;

function check(label: string, actual: unknown, expected: unknown) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.error(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ok    ${label}`);
  }
}

// --- Pure: serving-size parsing. OFF's field is free text and inconsistent. ---
console.log("parseServingGrams");
check("takes the parenthesised grams", parseServingGrams("3/4 cup (28 g) (28 g)"), 28);
check("plain grams", parseServingGrams("30 g"), 30);
check("millilitres", parseServingGrams("330 ml"), 330);
check("prefers the last parenthesised value", parseServingGrams("1 cup (240 ml) (245 g)"), 245);
check("null when absent", parseServingGrams(null), null);
check("null when unparseable", parseServingGrams("1 portion"), null);
check("rejects an implausible weight", parseServingGrams("(5000 g)"), null);

// --- Live lookups ---
async function main() {
  console.log("\nlive lookups");

  const nutella = await lookupBarcode("3017624010701");
  check("Nutella is found", nutella !== null, true);
  if (nutella) {
    check("  name", nutella.name, "Nutella");
    check("  brand", nutella.brand, "Ferrero");
    check("  kcal/100g", Math.round(nutella.per100g.kcal), 539);
    // OFF reports sodium in GRAMS; we store milligrams. 0.043 g -> 43 mg.
    check("  sodium converted g -> mg", Math.round(nutella.per100g.sodium), 43);
    check("  sweet-spread maps to 'sweet'", nutella.foodGroup, "sweet");
    check("  missing NOVA is flagged as inferred", nutella.processedLevelInferred, true);
  }

  const coke = await lookupBarcode("5449000000996");
  check("Coca-Cola is found", coke !== null, true);
  if (coke) {
    check("  maps to beverage", coke.foodGroup, "beverage");
    check("  declared NOVA 4 is used", coke.processedLevel, 4);
    check("  declared NOVA is not flagged inferred", coke.processedLevelInferred, false);
    check("  serving weight from label", coke.defaultGrams, 330);
  }

  check("unknown barcode returns null", await lookupBarcode("0000000000000"), null);
  check("malformed barcode returns null without a request", await lookupBarcode("abc"), null);

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
