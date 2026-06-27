import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

function getGitInfo() {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
    const commit = execSync('git log -1 --oneline').toString().trim();
    return { branch, commit };
  } catch (err) {
    return { branch: 'unknown', commit: 'unknown' };
  }
}

async function bootSession() {
  console.log('--- Waking up Nova Workstation (Session Boot Automation) ---');
  
  const gitInfo = getGitInfo();
  let dbHealth = 'OK';
  let doctorOutput = '';
  let isHealthy = true;

  // 1. Run doctor script to check health
  try {
    const output = execSync('npx ts-node scripts/doctor.ts', { stdio: 'pipe' });
    doctorOutput = output.toString();
  } catch (err: any) {
    isHealthy = false;
    dbHealth = 'DEGRADED / UNHEALTHY';
    doctorOutput = err.stdout ? err.stdout.toString() : err.message;
  }

  // Parse details for status report
  const missingMigrations = doctorOutput.includes('Missing tables') ? 'YES' : 'NONE';
  const currentMilestone = 'Milestone 3: Cognitive Subsystems (Nova Refactor)';
  const blockers = !isHealthy ? 'Database is degraded or tables are missing. Resolve this blocker first!' : 'None';

  // 2. Generate SESSION_STATUS.md
  const statusContent = `# Current Session Status

- **Current Branch:** \`${gitInfo.branch}\`
- **Latest Commit:** \`${gitInfo.commit}\`
- **Database Health:** \`${dbHealth}\`
- **Missing Migrations:** \`${missingMigrations}\`
- **Current Milestone:** \`${currentMilestone}\`
- **Pending Blockers:** \`${blockers}\`

---

## Doctor Diagnostics Run Logs
\`\`\`text
${doctorOutput.trim()}
\`\`\`
`;

  const statusPath = path.join(__dirname, '../../SESSION_STATUS.md');
  fs.writeFileSync(statusPath, statusContent, 'utf8');
  console.log(`[PASS] Generated SESSION_STATUS.md`);

  // 3. Write rolling session history logs
  const today = new Date().toISOString().split('T')[0];
  const logsDir = path.join(__dirname, '../brain/SESSION_LOGS');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  
  const logFile = path.join(logsDir, `${today}.md`);
  const logHeader = `# Session Log: ${today}\n\n`;
  const logEntry = `### Wake-up Status (Time: ${new Date().toISOString()})
- Branch: \`${gitInfo.branch}\`
- Commit: \`${gitInfo.commit}\`
- Health: \`${dbHealth}\`
- Action: ${isHealthy ? 'Continuing with Milestone 3 refactoring.' : 'STOPPED - Database or API is unhealthy. Focus on recovery.'}

---
`;

  if (!fs.existsSync(logFile)) {
    fs.writeFileSync(logFile, logHeader + logEntry, 'utf8');
  } else {
    fs.appendFileSync(logFile, logEntry, 'utf8');
  }
  console.log(`[PASS] Appended session wake-up log to: ${logFile}`);

  console.log('\n==================================================');
  if (!isHealthy) {
    console.warn('❌ SYSTEM IS UNHEALTHY: Stop feature development and run migrations/recovery steps!');
    process.exit(1);
  } else {
    console.log('✅ SYSTEM IS HEALTHY: Ready for autonomous milestone progress.');
    process.exit(0);
  }
}

bootSession();
