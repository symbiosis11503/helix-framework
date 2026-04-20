/**
 * Skill Loader — Auto-discover and load SKILL.md definitions
 *
 * Inspired by Firecrawl's skills-as-markdown pattern.
 * Scans a skills/ directory for .md files, parses frontmatter + content,
 * and registers them as tools in the tool-registry.
 *
 * SKILL.md format:
 * ---
 * name: web-search
 * description: Search the web for information
 * parameters:
 *   - name: query
 *     type: string
 *     required: true
 *     description: Search query
 *   - name: limit
 *     type: number
 *     required: false
 *     description: Max results
 * capabilities: [web, search]
 * ---
 * ## Instructions
 * You are a web search agent. Given a query, search the web and return results...
 *
 * Shared core: works with both A and B versions.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, basename } from 'path';

// ========== Frontmatter Parser ==========

/**
 * Parse YAML-like frontmatter from markdown
 * Supports: name, description, parameters (array), capabilities (array)
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const raw = match[1];
  const body = match[2].trim();
  const meta = {};

  // Simple YAML parser (no dependency)
  const lines = raw.split('\n');
  let currentKey = null;
  let currentArray = null;
  let currentObj = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Top-level key: value
    const kvMatch = trimmed.match(/^(\w+):\s*(.*)$/);
    if (kvMatch && !line.startsWith('  ') && !line.startsWith('\t')) {
      currentKey = kvMatch[1];
      let value = kvMatch[2].trim();

      // Inline array: [a, b, c]
      if (value.startsWith('[') && value.endsWith(']')) {
        meta[currentKey] = value.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
        currentArray = null;
        currentObj = null;
        continue;
      }

      if (value) {
        meta[currentKey] = value;
        currentArray = null;
        currentObj = null;
      } else {
        // Start of array or nested object
        meta[currentKey] = [];
        currentArray = meta[currentKey];
        currentObj = null;
      }
      continue;
    }

    // Array item: - name: value  or  - value
    if (trimmed.startsWith('- ') && currentArray) {
      const itemKv = trimmed.slice(2).match(/^(\w+):\s*(.*)$/);
      if (itemKv) {
        // Start new object in array
        currentObj = { [itemKv[1]]: itemKv[2].trim() };
        currentArray.push(currentObj);
      } else {
        currentArray.push(trimmed.slice(2).trim());
        currentObj = null;
      }
      continue;
    }

    // Nested key in current object:   key: value
    if ((line.startsWith('    ') || line.startsWith('\t\t')) && currentObj) {
      const nestedKv = trimmed.match(/^(\w+):\s*(.*)$/);
      if (nestedKv) {
        let val = nestedKv[2].trim();
        // Boolean conversion
        if (val === 'true') val = true;
        else if (val === 'false') val = false;
        currentObj[nestedKv[1]] = val;
      }
    }
  }

  return { meta, body };
}

// ========== Skill Loading ==========

/**
 * Load all skills from a directory
 * @param {string} skillsDir - path to skills/ directory
 * @returns {Array<{name, description, parameters, capabilities, instructions}>}
 */
export function loadSkills(skillsDir) {
  if (!existsSync(skillsDir)) return [];

  const files = readdirSync(skillsDir).filter(f => f.endsWith('.md'));
  const skills = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(skillsDir, file), 'utf-8');
      const { meta, body } = parseFrontmatter(content);

      const skill = {
        name: meta.name || basename(file, '.md'),
        description: meta.description || '',
        parameters: Array.isArray(meta.parameters) ? meta.parameters : [],
        capabilities: Array.isArray(meta.capabilities) ? meta.capabilities : [],
        instructions: body,
        source: file,
      };

      skills.push(skill);
    } catch (e) {
      console.warn(`[skill-loader] Failed to load ${file}: ${e.message}`);
    }
  }

  return skills;
}

/**
 * Register loaded skills into tool-registry
 * @param {Array} skills - from loadSkills()
 * @param {object} registry - tool-registry module
 * @param {object} [opts]
 * @param {function} [opts.executeFn] - custom executor: async (skillName, params, instructions) => result
 */
export function registerSkills(skills, registry, opts = {}) {
  const registered = [];

  for (const skill of skills) {
    // Build parameter schema for tool-registry
    const paramSchema = {};
    for (const p of skill.parameters) {
      paramSchema[p.name] = {
        type: p.type || 'string',
        required: p.required === true || p.required === 'true',
        description: p.description || '',
      };
    }

    // Default executor: return instructions as prompt template
    const handler = opts.executeFn
      ? async (params) => opts.executeFn(skill.name, params, skill.instructions)
      : async (params) => ({
          skill: skill.name,
          instructions: skill.instructions,
          params,
          note: 'Skill loaded — use instructions as system prompt for LLM execution',
        });

    try {
      registry.register(skill.name, {
        description: skill.description,
        parameters: paramSchema,
        handler,
        metadata: {
          type: 'skill',
          source: skill.source,
          capabilities: skill.capabilities,
        },
      });

      // Bind capabilities if any
      if (skill.capabilities.length > 0) {
        for (const cap of skill.capabilities) {
          try { registry.bindCapabilities(skill.name, [cap]); } catch {}
        }
      }

      registered.push(skill.name);
    } catch (e) {
      console.warn(`[skill-loader] Failed to register ${skill.name}: ${e.message}`);
    }
  }

  return { registered, count: registered.length };
}

/**
 * Auto-load and register skills from a directory
 * Convenience function combining loadSkills + registerSkills
 */
export async function autoLoadSkills(skillsDir, opts = {}) {
  const skills = loadSkills(skillsDir);
  if (skills.length === 0) return { loaded: 0, skills: [] };

  let registry;
  try {
    registry = await import('./tool-registry.js');
  } catch {
    return { loaded: 0, error: 'tool-registry not available' };
  }

  const result = registerSkills(skills, registry, opts);
  console.log(`[skill-loader] Loaded ${result.count} skills from ${skillsDir}`);
  return { loaded: result.count, skills: result.registered };
}

/**
 * List available skill files without loading them
 */
export function listSkillFiles(skillsDir) {
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir)
    .filter(f => f.endsWith('.md'))
    .map(f => ({
      file: f,
      name: basename(f, '.md'),
      path: join(skillsDir, f),
    }));
}

export default {
  parseFrontmatter,
  loadSkills,
  registerSkills,
  autoLoadSkills,
  listSkillFiles,
};
