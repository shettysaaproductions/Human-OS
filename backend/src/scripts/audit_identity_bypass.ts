import fs from 'fs';
import path from 'path';

function walkDir(dir: string): string[] {
  const results: string[] = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results.push(...walkDir(fullPath));
    } else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

const allTsFiles = walkDir(path.resolve(__dirname, '..'));

console.log(`Auditing ${allTsFiles.length} TypeScript files in backend/src for identity/bubble/graph mutations...\n`);

const auditResults: Array<{ file: string; line: number; type: string; snippet: string }> = [];

for (const filePath of allTsFiles) {
  const relPath = path.relative(path.resolve(__dirname, '..'), filePath);
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for memory_bubbles insert
    if (line.includes("'memory_bubbles'") || line.includes('"memory_bubbles"')) {
      for (let j = i; j < Math.min(lines.length, i + 6); j++) {
        if (lines[j].includes('.insert(')) {
          auditResults.push({
            file: relPath,
            line: i + 1,
            type: 'memory_bubbles insert',
            snippet: lines.slice(i, j + 2).map(l => l.trim()).join(' ')
          });
        }
      }
    }

    // Check for memories insert
    if (line.includes("'memories'") || line.includes('"memories"')) {
      for (let j = i; j < Math.min(lines.length, i + 6); j++) {
        if (lines[j].includes('.insert(')) {
          auditResults.push({
            file: relPath,
            line: i + 1,
            type: 'memories insert',
            snippet: lines.slice(i, j + 2).map(l => l.trim()).join(' ')
          });
        }
      }
    }

    // Check for kg_nodes insert
    if (line.includes("'kg_nodes'") || line.includes('"kg_nodes"')) {
      for (let j = i; j < Math.min(lines.length, i + 6); j++) {
        if (lines[j].includes('.insert(')) {
          auditResults.push({
            file: relPath,
            line: i + 1,
            type: 'kg_nodes insert',
            snippet: lines.slice(i, j + 2).map(l => l.trim()).join(' ')
          });
        }
      }
    }

    // Check for kg_edges insert
    if (line.includes("'kg_edges'") || line.includes('"kg_edges"')) {
      for (let j = i; j < Math.min(lines.length, i + 6); j++) {
        if (lines[j].includes('.insert(')) {
          auditResults.push({
            file: relPath,
            line: i + 1,
            type: 'kg_edges insert',
            snippet: lines.slice(i, j + 2).map(l => l.trim()).join(' ')
          });
        }
      }
    }
  }
}

console.log(`Found ${auditResults.length} mutation occurrences:`);
for (const res of auditResults) {
  console.log(`[${res.type}] ${res.file}:${res.line}\n  Snippet: ${res.snippet.substring(0, 120)}...\n`);
}
