#!/usr/bin/env node
// Generate Chrome extension icons using OpenAI's image API.
//
// Usage:
//   OPENAI_API_KEY=sk-... node scripts/generate-icons.js
//
// Output: icons/icon-1024.png (master) + icon-{16,32,48,128}.png
// Requires macOS for `sips` resize (preinstalled). If you're elsewhere,
// replace the resize step with sharp/imagemagick.

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

const PROMPT = [
  "A premium Chrome extension icon for an app called 'Tabbit', a minimal tab organizer.",
  "Show a single bold letter 'T' centered in a softly-rounded square tile.",
  "Letter style: geometric sans-serif similar to Inter or Söhne, weight ~600, slightly modern.",
  "Letter color: warm off-white (#ededed).",
  "Background: deep near-black (#0d0d0d), perfectly flat, no gradient or texture.",
  "Generous padding (about 18% of canvas) around the letter so it reads clearly at 16x16.",
  "No shadow, no glow, no stroke, no extra ornamentation — purely minimal.",
  "Aesthetic reference: Linear app icon, Raycast app icon, Vercel logo mark.",
  "Square 1:1 composition, sharp edges, ultra-clean, high contrast, dark mode."
].join(" ");

async function generateMaster() {
  if (!API_KEY) {
    throw new Error("Missing OPENAI_API_KEY. Export it in your shell and rerun.");
  }

  console.log(`Requesting ${MODEL} image (1024x1024)...`);

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      prompt: PROMPT,
      size: "1024x1024",
      n: 1
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
      throw new Error(`Failed to download image from URL (${img.status})`);
    }
    return Buffer.from(await img.arrayBuffer());
  }

  throw new Error("OpenAI response had neither b64_json nor url");
}

async function resize(source, size, target) {
  await execFileP("sips", [
    "-Z",
    String(size),
    source,
    "--out",
    target
  ]);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const masterPath = path.join(OUT_DIR, `icon-${MASTER_SIZE}.png`);
  const buffer = await generateMaster();
  await fs.writeFile(masterPath, buffer);
  console.log(`✓ Master saved: ${path.relative(PROJECT_ROOT, masterPath)}`);

  for (const size of TARGET_SIZES) {
    const target = path.join(OUT_DIR, `icon-${size}.png`);
    await resize(masterPath, size, target);
    console.log(`✓ ${size}x${size}: ${path.relative(PROJECT_ROOT, target)}`);
  }

  const manifestSnippet = {
    icons: Object.fromEntries(TARGET_SIZES.map((size) => [size, `icons/icon-${size}.png`])),
    action: {
      default_icon: Object.fromEntries(TARGET_SIZES.map((size) => [size, `icons/icon-${size}.png`]))
    }
  };

  console.log("\nDone. Merge this into manifest.json:");
  console.log(JSON.stringify(manifestSnippet, null, 2));
}

main().catch((error) => {
  console.error("\n✗ Icon generation failed:");
  console.error(error.message);
  process.exit(1);
});
