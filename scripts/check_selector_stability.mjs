#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'src');
const TARGET_EXTENSIONS = new Set(['.ts', '.tsx']);
const USE_STORE_CALL_RE = /\buse[A-Za-z0-9_]*Store\s*\(/g;
const FORBIDDEN_PATTERNS = [
  { re: /\?\?\s*\[\s*\]/g, label: 'nullish empty array fallback (?? [])' },
  { re: /\?\?\s*\{\s*\}/g, label: 'nullish empty object fallback (?? {})' },
  { re: /:\s*\[\s*\]/g, label: 'ternary empty array fallback (: [])' },
  { re: /:\s*\{\s*\}/g, label: 'ternary empty object fallback (: {})' },
];

function listFilesRecursively(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursively(fullPath));
      continue;
    }
    if (!TARGET_EXTENSIONS.has(path.extname(entry.name))) continue;
    out.push(fullPath);
  }
  return out;
}

function findMatchingParen(source, openIndex) {
  let depth = 0;
  let quote = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (quote) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }

    if (ch === '(') {
      depth += 1;
      continue;
    }

    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function stripStringsAndComments(source) {
  let out = '';
  let quote = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        out += '\n';
      } else {
        out += ' ';
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        out += '  ';
        i += 1;
      } else {
        out += ch === '\n' ? '\n' : ' ';
      }
      continue;
    }

    if (quote) {
      if (ch === '\\') {
        out += '  ';
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      out += ch === '\n' ? '\n' : ' ';
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      out += '  ';
      i += 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true;
      out += '  ';
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ' ';
      continue;
    }

    out += ch;
  }

  return out;
}

function lineOfIndex(source, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source[i] === '\n') line += 1;
  }
  return line;
}

function scanFile(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const findings = [];

  for (const match of source.matchAll(USE_STORE_CALL_RE)) {
    const callStart = match.index;
    const openParenIndex = source.indexOf('(', callStart);
    if (openParenIndex < 0) continue;

    const closeParenIndex = findMatchingParen(source, openParenIndex);
    if (closeParenIndex < 0) continue;

    const callText = source.slice(callStart, closeParenIndex + 1);
    if (!/=>/.test(callText)) continue;

    const stripped = stripStringsAndComments(callText);
    for (const rule of FORBIDDEN_PATTERNS) {
      rule.re.lastIndex = 0;
      const bad = rule.re.exec(stripped);
      if (!bad) continue;

      const absoluteIndex = callStart + bad.index;
      findings.push({
        filePath,
        line: lineOfIndex(source, absoluteIndex),
        label: rule.label,
      });
    }
  }

  return findings;
}

if (!fs.existsSync(SRC_DIR)) {
  console.error('Selector stability check failed: src directory not found.');
  process.exit(1);
}

const files = listFilesRecursively(SRC_DIR);
const findings = files.flatMap(scanFile);

if (findings.length === 0) {
  console.log('Selector stability check passed: no inline empty fallback literals in store selectors.');
  process.exit(0);
}

console.error('Selector stability check failed. Found unstable fallback literals in store selectors:');
for (const finding of findings) {
  const rel = path.relative(ROOT, finding.filePath);
  console.error(`- ${rel}:${finding.line} — ${finding.label}`);
}
console.error('\nUse stable constants or memoized fallbacks instead of inline []/{} inside selector callbacks.');
process.exit(1);
