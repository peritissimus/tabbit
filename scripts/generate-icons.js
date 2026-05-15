#!/usr/bin/env node
// Generate Chrome extension icons using OpenAI's image API.
//
// Usage:
//   OPENAI_API_KEY=sk-... node scripts/generate-icons.js           # both variants
//   OPENAI_API_KEY=sk-... ICON_VARIANT=light node scripts/generate-icons.js
//   OPENAI_API_KEY=sk-... ICON_VARIANT=dark  node scripts/generate-icons.js
//
// Variants follow Chrome's `theme_icons` semantics:
//   light = icon shown on LIGHT toolbars → dark silhouette on transparent
//   dark  = icon shown on DARK toolbars  → light silhouette on transparent
//
// Output: icons/icon-{variant}-{16,32,48,128,1024}.png
// Requires macOS for `sips` resize. Replace with sharp/imagemagick elsewhere.

const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileP = promisify(execFile);

const API_KEY = process.env.OPENAI_API_KEY;
const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(PROJECT_ROOT, "icons");
const MASTER_SIZE = 1024;
const TARGET_SIZES = [16, 32, 48, 128];
const MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";

const PROMPTS = {
  light: [
    "A premium Chrome extension app icon for 'Tabbit', a tab manager.",
    "Subject: a clean iconic silhouette of a rabbit's head in side profile (Playboy bunny silhouette aesthetic — modernized and minimal).",
    "Two tall vertical ears pointing straight up with softly rounded tips.",
    "A tiny refined bowtie under the chin as a nod to the original.",
    "Render as a pure solid silhouette in deep near-black (#0d0d0d).",
    "No outlines, no shading, no gradients, no text, no extra elements.",
    "Background: fully transparent. NO tile, NO rounded rectangle, NO shape behind the rabbit — only the silhouette itself, floating on transparency.",
    "Centered, with generous padding (about 16% of canvas on each side) so it reads at 16x16.",
    "Aesthetic reference: Linear, Raycast, Vercel app-icon marks — sharp geometry, ultra-clean.",
    "Square 1:1 composition, 1024x1024."
  ].join(" "),
  dark: [
    "A premium Chrome extension app icon for 'Tabbit', a tab manager.",
    "Subject: a clean iconic silhouette of a rabbit's head in side profile (Playboy bunny silhouette aesthetic — modernized and minimal).",
    "Two tall vertical ears pointing straight up with softly rounded tips.",
    "A tiny refined bowtie under the chin as a nod to the original.",
    "Render as a pure solid silhouette in warm off-white (#ededed).",
    "No outlines, no shading, no gradients, no text, no extra elements.",
    "Background: fully transparent. NO tile, NO rounded rectangle, NO shape behind the rabbit — only the silhouette itself, floating on transparency.",
    "Centered, with generous padding (about 16% of canvas on each side) so it reads at 16x16.",
    "Aesthetic reference: Linear, Raycast, Vercel app-icon marks — sharp geometry, ultra-clean.",
    "Square 1:1 composition, 1024x1024."
  ].join(" ")
};

async function requestImage(variant) {
  if (!API_KEY) {
    throw new Error("Missing OPENAI_API_KEY.");
  }

  console.log(`[${variant}] requesting ${MODEL} (1024x1024, transparent)...`);

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      prompt: PROMPTS[variant],
      size: "1024x1024",
      n: 1,
      background: "transparent",
      output_format: "png"
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI image API failed (${response.status}): ${errorText}`);
  }

  const payload = await response.json();
  const entry = payload?.data?.[0];

  if (!entry) {
    throw new Error("OpenAI response had no image data");
  }

  if (entry.b64_json) {
    return Buffer.from(entry.b64_json, "base64");
  }

  if (entry.url) {
    const img = await fetch(entry.url);
    if (!img.ok) {
      throw new Error(`Failed to download image (${img.status})`);
    }
    return Buffer.from(await img.arrayBuffer());
  }

  throw new Error("OpenAI response had neither b64_json nor url");
}

async function resize(source, size, target) {
  await execFileP("sips", ["-Z", String(size), source, "--out", target]);
}

async function generateVariant(variant) {
  const masterPath = path.join(OUT_DIR, `icon-${variant}-${MASTER_SIZE}.png`);
  const buffer = await requestImage(variant);
  await fs.writeFile(masterPath, buffer);
  console.log(`[${variant}] master → ${path.relative(PROJECT_ROOT, masterPath)}`);

  for (const size of TARGET_SIZES) {
    const target = path.join(OUT_DIR, `icon-${variant}-${size}.png`);
    await resize(masterPath, size, target);
    console.log(`[${variant}] ${size}x${size} → ${path.relative(PROJECT_ROOT, target)}`);
  }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const requested = process.env.ICON_VARIANT;
  const variants = requested
    ? [requested]
    : ["light", "dark"];

  for (const variant of variants) {
    if (!PROMPTS[variant]) {
      throw new Error(`Unknown ICON_VARIANT='${variant}'. Use 'light' or 'dark'.`);
    }
    await generateVariant(variant);
  }

  const manifestSnippet = {
    icons: Object.fromEntries(TARGET_SIZES.map((size) => [size, `icons/icon-light-${size}.png`])),
    action: {
      default_icon: Object.fromEntries(TARGET_SIZES.map((size) => [size, `icons/icon-light-${size}.png`])),
      theme_icons: TARGET_SIZES.map((size) => ({
        light: `icons/icon-light-${size}.png`,
        dark: `icons/icon-dark-${size}.png`,
        size
      }))
    }
  };

  console.log("\nDone. Merge into manifest.json:");
  console.log(JSON.stringify(manifestSnippet, null, 2));
}

main().catch((error) => {
  console.error("\n✗ Icon generation failed:");
  console.error(error.message);
  process.exit(1);
});
