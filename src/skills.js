/**
 * Skills — Hermes-pattern (Phase 3 port from tools/skills_tool.py).
 *
 * Procedural-knowledge skills loaded from disk. Each skill is a directory
 * containing a SKILL.md file with YAML frontmatter + markdown body.
 *
 * Skill layout:
 *   data/skills/{category}/{name}/
 *     SKILL.md           required: frontmatter + markdown
 *     references/        optional: lazy-loaded supporting files
 *     scripts/           optional: helper scripts
 *
 * Frontmatter format (subset of agentskills.io standard):
 *   ---
 *   name: arxiv-search
 *   description: Search arXiv via free REST API
 *   version: 1.0.0
 *   author: cc1
 *   license: MIT
 *   prerequisites:
 *     commands: [curl, jq]
 *   tags: [research, papers]
 *   ---
 *   # Markdown body — instructions for the agent
 *
 * Lifecycle (mirrors Hermes):
 *   1. Discover — fs walk for SKILL.md, parse first 4KB for frontmatter
 *   2. List      — return {category, name, description} only (Tier 1, cheap)
 *   3. View      — return full SKILL.md body (Tier 2)
 *   4. View file — lazy-load supporting reference files (Tier 3)
 *   5. Invoke    — return formatted prompt the agent can act on
 *
 * Pattern source: hermes-agent-study/tools/skills_tool.py:521-1000+
 *                 hermes-agent-study/agent/skill_commands.py:200-262
 *
 * NOTE: We deliberately do NOT execute skills (no eval, no spawn). Skills
 * are PROCEDURAL knowledge — text the agent reads and follows, the same
 * way Hermes treats them. Execution happens through the agent's existing
 * tool calls (curl, jq, etc) which it knows how to invoke separately.
 */

import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_ROOT = process.env.HELIX_SKILLS_DIR || join(__dirname, '..', 'data', 'skills');

const FRONTMATTER_LIMIT_BYTES = 4096;
const NAME_MAX = 64;
const DESC_MAX = 1024;

// === Frontmatter parser (zero-dep, YAML subset) ===

/**
 * Parse the YAML frontmatter of a SKILL.md file. Reads only the first 4KB
 * for efficiency, then walks until the closing `---`.
 *
 * Supported YAML subset:
 *   key: value
 *   key: [item1, item2]
 *   parent:
 *     child: value
 *     list: [a, b]
 *
 * Returns null if no frontmatter found.
 */
function parseFrontmatter(filepath) {
  let head;
  try {
    const fd = readFileSync(filepath, { encoding: 'utf8' });
    head = fd.slice(0, FRONTMATTER_LIMIT_BYTES);
  } catch {
    return null;
  }
  if (!head.startsWith('---')) return null;
  const closeIdx = head.indexOf('\n---', 3);
  if (closeIdx === -1) return null;
  const yamlBlock = head.slice(4, closeIdx).trim();

  const out = {};
  const lines = yamlBlock.split('\n');
  let currentParent = null;
  let parentObj = null;
  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const valueRaw = line.slice(colon + 1).trim();

    const value = parseYamlScalar(valueRaw);

    if (indent === 0) {
      out[key] = value;
      currentParent = (value === '' || value === null) ? key : null;
      parentObj = currentParent ? (out[key] = {}) : null;
    } else if (currentParent && parentObj) {
      parentObj[key] = value;
    }
  }
  return out;
}

function parseYamlScalar(raw) {
  if (raw === '' || raw === '~' || raw === 'null') return null;
  // Inline list: [a, b, "c"]
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return raw.slice(1, -1).split(',').map(s => parseYamlScalar(s.trim())).filter(s => s !== null);
  }
  // Quoted string
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  // Number
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return parseFloat(raw);
  // Boolean
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  // Plain string
  return raw;
}

/**
 * Read the markdown body of SKILL.md (everything after the closing ---).
 */
function readSkillBody(filepath) {
  let txt;
  try { txt = readFileSync(filepath, 'utf8'); }
  catch { return ''; }
  if (!txt.startsWith('---')) return txt;
  const closeIdx = txt.indexOf('\n---', 3);
  if (closeIdx === -1) return txt;
  return txt.slice(closeIdx + 4).replace(/^\s*\n/, '');
}

// === Discovery ===

let _cache = null;
let _cacheStamp = 0;
const CACHE_TTL_MS = 60_000;

/**
 * Walk SKILLS_ROOT and discover all SKILL.md files.
 * Returns a map keyed by `category/name` slug.
 *
 * Cached for 60s — pass `force=true` to bypass.
 */
export function discoverSkills(force = false) {
  if (!force && _cache && Date.now() - _cacheStamp < CACHE_TTL_MS) {
    return _cache;
  }
  const skills = {};
  if (!existsSync(SKILLS_ROOT)) {
    _cache = skills;
    _cacheStamp = Date.now();
    return skills;
  }

  for (const category of safeReaddir(SKILLS_ROOT)) {
    const catDir = join(SKILLS_ROOT, category);
    if (!isDir(catDir)) continue;
    if (category.startsWith('.')) continue;

    for (const skillName of safeReaddir(catDir)) {
      const skillDir = join(catDir, skillName);
      if (!isDir(skillDir)) continue;
      const skillFile = join(skillDir, 'SKILL.md');
      if (!existsSync(skillFile)) continue;

      const fm = parseFrontmatter(skillFile);
      if (!fm) continue;

      const name = (fm.name || skillName).slice(0, NAME_MAX);
      const description = (fm.description || '').slice(0, DESC_MAX);
      const slug = `${category}/${name}`;
      skills[slug] = {
        slug,
        category,
        name,
        description,
        version: fm.version || null,
        author: fm.author || null,
        license: fm.license || null,
        tags: Array.isArray(fm.tags) ? fm.tags : (fm.tags ? [fm.tags] : []),
        prerequisites: fm.prerequisites || null,
        path: skillDir,
        file: skillFile,
      };
    }
  }
  _cache = skills;
  _cacheStamp = Date.now();
  return skills;
}

function safeReaddir(p) {
  try { return readdirSync(p); } catch { return []; }
}
function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

// === Tier 1: list ===

/**
 * Return a flat array of {slug, category, name, description, tags}.
 * Filters: by category, by tag, by name substring.
 */
export function listSkills(opts = {}) {
  const all = discoverSkills();
  let rows = Object.values(all);
  if (opts.category) rows = rows.filter(s => s.category === opts.category);
  if (opts.tag) rows = rows.filter(s => s.tags && s.tags.includes(opts.tag));
  if (opts.q) {
    const q = opts.q.toLowerCase();
    rows = rows.filter(s => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
  }
  return rows.map(({ slug, category, name, description, tags, version }) =>
    ({ slug, category, name, description, tags, version }));
}

/**
 * List all distinct categories with skill counts.
 */
export function listCategories() {
  const all = discoverSkills();
  const counts = {};
  for (const s of Object.values(all)) counts[s.category] = (counts[s.category] || 0) + 1;
  return Object.entries(counts).map(([category, count]) => ({ category, count }));
}

// === Tier 2: view full skill ===

/**
 * Get full skill detail (frontmatter + markdown body).
 * Returns null if not found.
 */
export function getSkill(slug) {
  const all = discoverSkills();
  const s = all[slug];
  if (!s) return null;
  return {
    ...s,
    body: readSkillBody(s.file),
    references: listReferences(s.path),
  };
}

function listReferences(skillDir) {
  const refDir = join(skillDir, 'references');
  if (!existsSync(refDir) || !isDir(refDir)) return [];
  const out = [];
  for (const f of safeReaddir(refDir)) {
    const full = join(refDir, f);
    if (!isDir(full)) {
      try {
        const sz = statSync(full).size;
        out.push({ name: f, size: sz, path: `references/${f}` });
      } catch { /* skip */ }
    }
  }
  return out;
}

// === Tier 3: read a referenced supporting file (lazy) ===

/**
 * Read a supporting file inside a skill's directory.
 * Path traversal protection: rejects '..', absolute paths, and anything
 * outside the skill dir.
 */
export function readSkillFile(slug, relPath) {
  const all = discoverSkills();
  const s = all[slug];
  if (!s) return null;
  if (relPath.includes('..') || relPath.startsWith('/')) {
    throw new Error('invalid relPath: traversal blocked');
  }
  const full = join(s.path, relPath);
  if (!full.startsWith(s.path)) {
    throw new Error('invalid relPath: out of skill dir');
  }
  if (!existsSync(full)) return null;
  return readFileSync(full, 'utf8');
}

// === Invocation: format a skill into an agent-ready prompt ===

/**
 * Build the message that gets injected into the agent's context when a skill
 * is invoked. Mirrors Hermes' build_skill_invocation_message in
 * agent/skill_commands.py:121-197.
 *
 * Returns a string ready to prepend to the agent's user turn.
 */
export function buildSkillInvocation(slug, userInstruction = '') {
  const skill = getSkill(slug);
  if (!skill) return null;
  const lines = [];
  lines.push(`---`);
  lines.push(`## 🛠️ Skill 載入：${skill.name}  \`${slug}\``);
  lines.push(`${skill.description}`);
  if (skill.prerequisites && skill.prerequisites.commands) {
    lines.push(`**前置工具**：${skill.prerequisites.commands.join(', ')}`);
  }
  if (skill.references && skill.references.length > 0) {
    lines.push(`**支援檔案**（需要時可讀取）：${skill.references.map(r => r.name).join(', ')}`);
  }
  lines.push('');
  lines.push(skill.body);
  if (userInstruction) {
    lines.push('');
    lines.push(`---`);
    lines.push(`**使用者指示**：${userInstruction}`);
  }
  lines.push(`---`);
  return lines.join('\n');
}

// === Auto-generation: agent creates SKILL.md from completed task ===

/**
 * Generate a SKILL.md file from a task execution trace.
 * Agent distills its workflow into a reusable skill.
 *
 * @param {object} opts
 * @param {string} opts.name - Skill name (slug-friendly)
 * @param {string} opts.category - Category directory
 * @param {string} opts.description - One-line description
 * @param {string} opts.instructions - Markdown body (what agent learned)
 * @param {string[]} [opts.tags]
 * @param {string} [opts.author]
 * @param {object} [opts.prerequisites] - { commands: [] }
 * @returns {{ path, content }} - path where to write, content of SKILL.md
 */
export function generateSkillMd({ name, category = 'generated', description, instructions, tags = [], author = 'helix-agent', prerequisites = null }) {
  const frontmatter = [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    `version: 1.0.0`,
    `author: ${author}`,
  ];
  if (tags.length > 0) frontmatter.push(`tags: [${tags.join(', ')}]`);
  if (prerequisites?.commands) frontmatter.push(`prerequisites:\n  commands: [${prerequisites.commands.join(', ')}]`);
  frontmatter.push('---');

  const content = `${frontmatter.join('\n')}\n\n${instructions}`;
  const dirName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
  const safeCategory = (category || 'generated').replace(/[^a-z0-9_-]/gi, '-').replace(/\.\./g, '');
  const path = join(SKILLS_ROOT, safeCategory, dirName, 'SKILL.md');

  return { path, dirName, content };
}

/**
 * Generate AND write a skill to disk
 * @returns {{ written, path, name }}
 */
export function writeGeneratedSkill(opts) {
  const { path: skillPath, content, dirName } = generateSkillMd(opts);

  // Security: verify path stays within SKILLS_ROOT
  const resolved = join(SKILLS_ROOT, '');
  if (!skillPath.startsWith(resolved)) {
    throw new Error('Path traversal blocked: skill path outside SKILLS_ROOT');
  }

  const dir = dirname(skillPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(skillPath, content, 'utf8');

  // Bust cache so next listSkills() picks it up
  _cache = null;

  return { written: true, path: skillPath, name: opts.name, category: opts.category || 'generated' };
}

/**
 * Auto-generate a skill from a reasoning trace using LLM
 * @param {object} opts
 * @param {Array} opts.steps - Reasoning steps from agent-reasoning.js
 * @param {string} opts.task - Original task description
 * @param {function} opts.summarizeFn - async (prompt) => string
 * @param {string} [opts.category='generated']
 * @returns {{ path, name, content } | null}
 */
export async function autoGenerateSkill({ steps, task, summarizeFn, category = 'generated' }) {
  if (!steps || steps.length === 0 || !summarizeFn) return null;

  const stepsText = steps.map((s, i) =>
    `Step ${i}: ${s.reasoning || s.action || ''} → ${typeof s.result === 'string' ? s.result.slice(0, 200) : JSON.stringify(s.result)?.slice(0, 200)}`
  ).join('\n');

  const prompt = `Based on this completed task and its execution steps, create a reusable skill definition.

Task: ${task}

Steps taken:
${stepsText.slice(0, 4000)}

Generate a JSON object with:
- name: slug-friendly name (lowercase, hyphens)
- description: one-line description
- tags: array of relevant tags
- instructions: markdown instructions that another agent could follow to repeat this task pattern

Respond with JSON only.`;

  try {
    const response = await summarizeFn(prompt);
    const match = response.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);

    if (!parsed.name || !parsed.instructions) return null;

    return writeGeneratedSkill({
      name: parsed.name,
      category,
      description: parsed.description || task.slice(0, 100),
      instructions: parsed.instructions,
      tags: parsed.tags || [],
      author: 'auto-generated',
    });
  } catch (e) {
    console.warn('[skills] autoGenerateSkill failed:', e.message);
    return null;
  }
}

export default {
  discoverSkills,
  listSkills,
  listCategories,
  getSkill,
  readSkillFile,
  buildSkillInvocation,
  generateSkillMd,
  writeGeneratedSkill,
  autoGenerateSkill,
};
