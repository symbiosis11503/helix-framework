// Generate Helix visual identity using OpenAI gpt-image-1.
// Reads OPENAI_API_KEY from env (source symbiosis-agent/config/.env before running).
// Outputs PNGs to design/raw/.
//
// Run: node design/generate.mjs [name]?
//   name omitted → generates all items in PLAN
//   name given  → only that one

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = __dirname;
mkdirSync(join(OUT, 'raw'), { recursive: true });

const API = 'https://api.openai.com/v1/images/generations';
const KEY = process.env.OPENAI_API_KEY;
if (!KEY) { console.error('Need OPENAI_API_KEY. Source symbiosis-agent/config/.env first.'); process.exit(1); }

const BRAND = `Helix is a local-first AI agent framework. Brand palette: deep forest green #4a7c59 (primary), muted sky blue #5b8fa8 (accent), warm cream #f8f6f1 (light bg), near-black #0d1117 (dark bg). Style: nature meets technology, minimal geometric, precise linework, NO text, NO words, NO letters in the image unless explicitly requested. Avoid: cheesy AI-generated look, over-detailed, busy, photo-realistic, glossy 3D render, cartoon mascot.`;

const PLAN = [
  {
    name: 'logo-primary',
    size: '1024x1024',
    quality: 'medium',
    prompt: `Primary logo symbol for a product called "Helix". Abstract double-helix / twisted strand motif rendered in fine geometric line-art, suggesting DNA and computational flow simultaneously. Deep forest green #4a7c59 on warm cream #f8f6f1 background. Centered, symmetric, plenty of negative space. The mark must be legible at small sizes (32x32). No text, no letters. ${BRAND}`,
  },
  {
    name: 'icon-512',
    size: '1024x1024',
    quality: 'medium',
    prompt: `Macos-style app icon. The ENTIRE 1024x1024 canvas is filled with a solid very dark charcoal gradient background (#0d1117 center, #161b22 edges — near-black, almost like OLED-off). No white anywhere except subtle highlight on the mark. Rounded-square shape fills the full canvas (the dark shape IS the icon bounds, not a badge on white). In the exact center: an abstract geometric double-helix strand in luminous sky blue (#58a6ff) with a faint cyan glow. Minimal line-art, 2px stroke equivalent. Absolutely NO white background, NO letters, NO text, NO wordmark. If you imagine Sparkle or Craft or Linear app icons — that dark-on-dark aesthetic. ${BRAND}`,
  },
  {
    name: 'icon-192',
    size: '1024x1024',
    quality: 'medium',
    prompt: `Ultra-simplified macOS app icon. FULL 1024x1024 canvas covered in solid near-black #0d1117 (the dark color fills edge-to-edge — this is NOT a light page with a dark square on it). Rounded-corner square that occupies the entire canvas. Centered mark: just 2-3 simple geometric curves suggesting a twisted double strand, in sky blue #58a6ff. Extreme minimalism for 32x32 legibility. Dark background is mandatory. No white. No text. ${BRAND}`,
  },
  {
    name: 'og-image',
    size: '1536x1024',
    quality: 'medium',
    prompt: `Social share / Open Graph image for Helix, a local-first AI agent framework. Landscape 1536x1024 composition. Left third: the helix symbol (deep forest green #4a7c59 geometric double-strand) on warm cream #f8f6f1. Right two-thirds: generous negative space suggesting "local, calm, on-your-machine". Subtle texture like fine grain paper. No text rendered in image — design assumes text will be overlaid in CSS later. ${BRAND}`,
  },
  {
    name: 'hero-illustration',
    size: '1536x1024',
    quality: 'medium',
    prompt: `Hero illustration for a software product landing page titled "Helix". An abstract visualization of AI agents as interconnected light nodes on a minimal geometric network, reminiscent of a constellation or neural web but rendered as precise linework (not glowy AI-art). Nature tones: forest green nodes, earth brown connectors, sky blue accents, on warm cream #f8f6f1 background. Feels calm and trustworthy, not chaotic. Landscape composition, substantial breathing room. No text. ${BRAND}`,
  },
  {
    name: 'logo-dark',
    size: '1024x1024',
    quality: 'medium',
    prompt: `1024x1024 canvas ENTIRELY filled with solid dark #0d1117 background (picture a piece of deep charcoal paper). On top of this dark surface, centered, is a double-helix symbol drawn in soft cream color #e6edf3 with visible contrast (like chalk on a blackboard). Same helix shape as a Watson-Crick double strand. The dark background MUST fill the full canvas edge-to-edge. Do NOT place the dark square on a white page. No text, no letters. ${BRAND}`,
  },
];

async function generate(item) {
  console.log(`→ ${item.name} (${item.size}, ${item.quality})`);
  const body = {
    model: 'gpt-image-1',
    prompt: item.prompt,
    size: item.size,
    quality: item.quality,
    n: 1,
  };
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error(`✗ ${item.name}: ${res.status} ${txt.slice(0, 300)}`);
    return false;
  }
  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) {
    console.error(`✗ ${item.name}: no b64 in response`, JSON.stringify(data).slice(0, 300));
    return false;
  }
  const file = join(OUT, 'raw', `${item.name}.png`);
  writeFileSync(file, Buffer.from(b64, 'base64'));
  const kb = Math.round(Buffer.from(b64, 'base64').length / 1024);
  console.log(`  saved: ${file} (${kb} KB)`);
  return true;
}

const target = process.argv[2];
const queue = target ? PLAN.filter(p => p.name === target) : PLAN;
if (!queue.length) { console.error(`No matching item: ${target}`); process.exit(1); }

const results = [];
for (const item of queue) {
  const ok = await generate(item);
  results.push({ name: item.name, ok });
}

const passed = results.filter(r => r.ok).length;
console.log(`\n${passed}/${results.length} generated. Output: ${join(OUT, 'raw')}/`);
