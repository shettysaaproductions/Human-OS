#!/usr/bin/env node
/**
 * Human-OS lightweight secret checker
 * Reports file/path and line WITHOUT printing secret contents.
 * Exit 1 if potential secrets found, 0 otherwise.
 *
 * Usage: node scripts/secret-check.js [--staged] [--all]
 *  --staged: check staged files only
 *  --all:    check all tracked files (default)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// Patterns - intentionally broad but with allowlists
const CHECKS = [
  { name: 'JWT-like token', regex: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_\-+/=]{10,}/ },
  { name: 'Private key header', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'NVIDIA API key', regex: /nvapi-[A-Za-z0-9_-]{20,}/ },
  { name: 'Gemini API key (AQ.)', regex: /AQ\.[A-Za-z0-9_-]{10,}/ },
  { name: 'Anthropic API key', regex: /sk-(?:ant-|nqbH|proj-)?[A-Za-z0-9_-]{10,}/ },
  // Generic bearer token (only when paired with eyJ)
  { name: 'Bearer JWT', regex: /Bearer\s+eyJ/ },
  { name: 'Supabase anon/service key literal', regex: /SUPABASE_(?:ANON|SERVICE_ROLE)_KEY\s*=\s*eyJ/ },
];

// Files to skip (never flagged) - placeholders or docs describing env vars
const ALLOWLIST_PATHS = [
  /backend\/\.env\.example$/, // contains eyJ... truncated placeholder
  /docs\//,
  /\.md$/, // allow docs to mention token names without values - but still check if they contain real JWT
];

const ALLOWLIST_LINE = [
  /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.\.\./, // truncated placeholder
  /nvapi-xxx/,
  /sk-.*YOUR_/,
  /AQ\.Ab8.*placeholder/i,
  /your_.*key/i,
  /example/i,
];

function getTrackedFiles() {
  const args = process.argv.includes('--staged') ? 'git diff --cached --name-only --diff-filter=ACM' : 'git ls-files';
  try {
    const out = execSync(args, { cwd: ROOT, encoding: 'utf8' });
    return out.split('\n').filter(Boolean).filter(f => {
      // skip binary / large lock files that legitimately contain those strings as hashes
      if (f.includes('package-lock.json') || f.includes('pnpm-lock.yaml') || f.includes('yarn.lock')) return false;
      if (f.includes('node_modules')) return false;
      if (f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.pdf')) return false;
      return true;
    });
  } catch (e) {
    console.error('Failed to list git files:', e.message);
    return [];
  }
}

function isAllowlistedPath(file) {
  return ALLOWLIST_PATHS.some(rx => rx.test(file));
}

function isAllowlistedLine(line) {
  return ALLOWLIST_LINE.some(rx => rx.test(line));
}

let findings = [];

const files = getTrackedFiles();
for (const rel of files) {
  const abs = path.join(ROOT, rel);
  let content;
  try { content = fs.readFileSync(abs, 'utf8'); } catch { continue; }
  const lines = content.split('\n');
  // special: if path is allowlisted, still scan for non-placeholder secrets (e.g. real JWT not truncated)
  const pathAllowlisted = isAllowlistedPath(rel);
  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    for (const check of CHECKS) {
      if (check.regex.test(line)) {
        if (isAllowlistedLine(line)) continue;
        // For allowlisted paths, only flag if line looks like real secret (long JWT without ... placeholder)
        if (pathAllowlisted) {
          // if line contains truncated placeholder ... we already skipped via ALLOWLIST_LINE
          // extra guard: if line contains "example" or "xxx", skip
          if (/example|xxx|placeholder|your_/i.test(line)) continue;
        }
        // Extra guard: .env.example with eyJ... but truncated is already allowlisted; real long JWT in .env.example should still be flagged
        findings.push({ file: rel, line: lineNo, type: check.name });
        break; // one finding per line to reduce noise
      }
    }
  });
}

if (findings.length === 0) {
  console.log('[secret-check] No potential secrets found in tracked files.');
  process.exit(0);
} else {
  console.error('[secret-check] Potential secrets detected (file:line — type). Secret values NOT shown:');
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line} — ${f.type}`);
  }
  console.error(`\nTotal: ${findings.length} potential secret(s). Review and remove/rotate.`);
  console.error('Hint: ensure real keys are in .env (ignored) or env vars, not committed.');
  process.exit(1);
}
