/**
 * Rasterise public/icon.svg into the PNG sizes the manifest declares.
 *
 *   npx tsx scripts/generate-icons.ts
 *
 * The maskable variant is inset ~20% because Android crops maskable icons to a
 * circle or squircle; a full-bleed wordmark would lose its edges.
 */
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const svg = readFileSync("public/icon.svg");

async function main() {
  for (const size of [192, 512]) {
    const png = await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();
    writeFileSync(`public/icon-${size}.png`, png);
    console.log(`  public/icon-${size}.png`);
  }

  const inner = Math.round(512 * 0.62);
  const pad = Math.round((512 - inner) / 2);
  const maskable = await sharp({
    create: {
      width: 512, height: 512, channels: 4,
      background: { r: 0xb4, g: 0x55, b: 0x2e, alpha: 1 },
    },
  })
    .composite([
      { input: await sharp(svg, { density: 384 }).resize(inner, inner).png().toBuffer(), top: pad, left: pad },
    ])
    .png()
    .toBuffer();
  writeFileSync("public/icon-maskable-512.png", maskable);
  console.log("  public/icon-maskable-512.png");

  const apple = await sharp(svg, { density: 384 }).resize(180, 180).png().toBuffer();
  writeFileSync("public/apple-touch-icon.png", apple);
  console.log("  public/apple-touch-icon.png");
}
main().catch((e) => { console.error(e); process.exit(1); });
