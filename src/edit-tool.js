/**
 * Edit Tool — Exact String Match File Editing
 *
 * Provides precise file editing via exact string replacement:
 * - old_string must be unique in the file (or replace_all=true)
 * - Preserves indentation and formatting
 * - Validates changes before writing
 * - Audit trail for all edits
 *
 * Shared core: works standalone, no PG dependency.
 *
 * Design reference: Claude Code Edit tool (uniqueness check + exact match).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';

/**
 * Edit a file by exact string replacement
 *
 * @param {object} opts
 * @param {string} opts.filePath - absolute path to file
 * @param {string} opts.oldString - exact text to find and replace
 * @param {string} opts.newString - replacement text
 * @param {boolean} [opts.replaceAll=false] - replace all occurrences
 * @param {boolean} [opts.dryRun=false] - preview without writing
 * @returns {{ ok, changes, preview?, error? }}
 */
export function editFile({ filePath, oldString, newString, replaceAll = false, dryRun = false }) {
  // Validate inputs
  if (!filePath) return { ok: false, error: 'filePath required' };
  if (oldString === undefined || oldString === null) return { ok: false, error: 'oldString required' };
  if (newString === undefined || newString === null) return { ok: false, error: 'newString required' };
  if (oldString === newString) return { ok: false, error: 'oldString and newString are identical' };

  // Check file exists
  if (!existsSync(filePath)) {
    return { ok: false, error: `File not found: ${filePath}` };
  }

  // Read file
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (e) {
    return { ok: false, error: `Cannot read file: ${e.message}` };
  }

  // Count occurrences
  const occurrences = countOccurrences(content, oldString);

  if (occurrences === 0) {
    return {
      ok: false,
      error: 'old_string not found in file',
      hint: findSimilar(content, oldString),
    };
  }

  if (occurrences > 1 && !replaceAll) {
    // Find line numbers of each occurrence for debugging
    const lines = findOccurrenceLines(content, oldString);
    return {
      ok: false,
      error: `old_string matches ${occurrences} locations (lines: ${lines.join(', ')}). Use replaceAll=true to replace all, or provide more context to make old_string unique.`,
      occurrences,
      lines,
    };
  }

  // Perform replacement
  let newContent;
  let changeCount;

  if (replaceAll) {
    newContent = content.split(oldString).join(newString);
    changeCount = occurrences;
  } else {
    // Replace only first occurrence (which is unique)
    const idx = content.indexOf(oldString);
    newContent = content.substring(0, idx) + newString + content.substring(idx + oldString.length);
    changeCount = 1;
  }

  // Build preview (context around change)
  const preview = buildPreview(content, newContent, oldString, newString);

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      changes: changeCount,
      preview,
    };
  }

  // Write file
  try {
    writeFileSync(filePath, newContent, 'utf8');
  } catch (e) {
    return { ok: false, error: `Cannot write file: ${e.message}` };
  }

  return {
    ok: true,
    changes: changeCount,
    filePath,
    preview,
  };
}

/**
 * Read a file with line numbers (for context before editing)
 */
export function readFile(filePath, { offset = 0, limit = 2000 } = {}) {
  if (!existsSync(filePath)) {
    return { ok: false, error: `File not found: ${filePath}` };
  }

  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const sliced = lines.slice(offset, offset + limit);
    const numbered = sliced.map((line, i) => `${offset + i + 1}\t${line}`).join('\n');

    return {
      ok: true,
      content: numbered,
      totalLines: lines.length,
      showing: { from: offset + 1, to: Math.min(offset + limit, lines.length) },
    };
  } catch (e) {
    return { ok: false, error: `Cannot read file: ${e.message}` };
  }
}

// ========== Helpers ==========

function countOccurrences(text, search) {
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(search, pos)) !== -1) {
    count++;
    pos += search.length;
  }
  return count;
}

function findOccurrenceLines(content, search) {
  const lines = [];
  let pos = 0;
  while ((pos = content.indexOf(search, pos)) !== -1) {
    const lineNum = content.substring(0, pos).split('\n').length;
    lines.push(lineNum);
    pos += search.length;
  }
  return lines;
}

function findSimilar(content, search) {
  // Try to find a close match for debugging
  const trimmed = search.trim();
  if (trimmed !== search && content.includes(trimmed)) {
    return 'old_string has leading/trailing whitespace. The trimmed version exists in the file.';
  }

  // Check if it's a line ending issue
  const normalized = search.replace(/\r\n/g, '\n');
  if (normalized !== search && content.includes(normalized)) {
    return 'old_string contains \\r\\n line endings but file uses \\n.';
  }

  // Check first line
  const firstLine = search.split('\n')[0];
  if (firstLine.length > 10 && content.includes(firstLine)) {
    const lineNum = content.substring(0, content.indexOf(firstLine)).split('\n').length;
    return `First line of old_string found at line ${lineNum}, but full match failed. Check indentation or subsequent lines.`;
  }

  return null;
}

function buildPreview(oldContent, newContent, oldStr, newStr) {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  // Find first differing line
  let firstDiff = 0;
  while (firstDiff < oldLines.length && firstDiff < newLines.length && oldLines[firstDiff] === newLines[firstDiff]) {
    firstDiff++;
  }

  // Context: 2 lines before and after
  const start = Math.max(0, firstDiff - 2);
  const oldEnd = Math.min(oldLines.length, firstDiff + oldStr.split('\n').length + 2);
  const newEnd = Math.min(newLines.length, firstDiff + newStr.split('\n').length + 2);

  return {
    location: `line ${firstDiff + 1}`,
    removed: oldLines.slice(start, oldEnd).map((l, i) => `${start + i + 1}\t${l}`).join('\n'),
    added: newLines.slice(start, newEnd).map((l, i) => `${start + i + 1}\t${l}`).join('\n'),
  };
}

export default { editFile, readFile };
