/**
 * HumanOS Codebase & Database Architecture Map Generator (MAM)
 *
 * Scans the workspace to generate a token-efficient, high-level architectural tree
 * that enables Gemini 3.8 Flash (and any agent) to navigate the codebase instantly
 * without wasting context tokens.
 *
 * Usage:
 *   node .agents/skills/codebase-architect/scripts/generate_architecture_map.js
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const OUTPUT_FILE = path.resolve(__dirname, '../references/ARCHITECTURE_TREE.md');

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.expo',
  'dist',
  'build',
  '.next',
  'coverage',
  '.system_generated',
  'artifacts'
]);

const FILE_DESCRIPTIONS = {
  // Backend Core
  'backend/src/index.ts': 'Express server bootstrap, middleware, and route mounting',
  'backend/src/config/index.ts': 'Central configuration (Gemini, NVIDIA, Supabase, timeouts, routing flags)',
  'backend/src/routes/chat.ts': 'Core chat router: turns, bursts, intent handling, fallbacks, reflection',
  'backend/src/routes/health.ts': 'Health endpoints: DB, Redis, NVIDIA NIM, and Gemini cognitive pool status',
  'backend/src/routes/memories.ts': 'Memory and Knowledge Graph API endpoints',
  'backend/src/routes/profile.ts': 'User profile, persona settings, and grammatical gender preferences',
  'backend/src/routes/analytics.ts': 'User analytics, cognitive telemetry, and emotion telemetry',
  'backend/src/lib/gemini.ts': '20-slot Gemini pool, model cascades, rate-limit classification, timeout budgeting',
  'backend/src/lib/nvidia.ts': 'NVIDIA NIM provider, 49B/11B/8B model clients, BrainKeyRouter',
  'backend/src/lib/cognitiveRouter.ts': 'Unified Cognitive Model Router (Gemini primary -> NVIDIA failover)',
  'backend/src/lib/supabase.ts': 'Supabase client and admin client initialized with service role key',
  'backend/src/services/NovaBrainService.ts': 'Turn processing pipeline, prompt assembly, subconscious action extraction',
  'backend/src/services/promptBuilder.ts': 'Prompt engineering, persona voice rules, grammatical agreements, memory grounding',
  'backend/src/services/WatchtowerInspector.ts': 'Automated response filter: strips parental words ("Beta"), repairs verbs, fixes leaks',
  'backend/src/services/SituationalAwareness.ts': 'Temporal, presence, and behavioral context synthesis',
  'backend/src/services/MemoryLayer.ts': 'Multi-tiered memory store (Working, Episodic, Semantic, Declarative)',
  'backend/src/services/InstantFallbackRecoveryService.ts': 'Self-healing background recovery when fallback messages occur',
  'backend/src/services/AutonomousMemoryGraphCuratorService.ts': 'Knowledge Graph continuous curation and entity linking',
  'backend/src/services/MessageFormatter.ts': 'Conversation markdown formatting, clean spacing, context-aware emoji decoration',

  // Mobile Core
  'mobile/App.tsx': 'React Native application root, providers, push notifications, and navigation tree',
  'mobile/src/screens/ChatScreen.tsx': 'Main WhatsApp-style conversational chat UI with voice, photo, and thinking bubbles',
  'mobile/src/screens/analytics/KgExplorerScreen.tsx': 'Neural Galaxy 2D tactical and 3D graph explorer with live synaptic pulses',
  'mobile/src/screens/analytics/LifeTreeScreen.tsx': 'Growth Tree visualization of memories, accomplishments, and habits',
  'mobile/src/screens/analytics/EmotionLandscapeScreen.tsx': 'Emotional trajectory and mood landscape explorer',
  'mobile/src/screens/analytics/GoalsHabitsScreen.tsx': 'Life goals, ambitions, habits, and streak tracker',
  'mobile/src/store/useChatStore.ts': 'Zustand chat state: messages, turn coalescing, human-paced 5-10s text intervals',
  'mobile/src/store/useAuthStore.ts': 'Authentication state and Supabase session management',
  'mobile/src/config/updateHistory.json': 'Changelog records and automated in-app update announcement modals',
};

function scanDir(dirPath, relDir = '') {
  if (!fs.existsSync(dirPath)) return [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const nodes = [];

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith('.') && entry.name !== '.env.example' && entry.name !== '.agents') continue;

    const fullPath = path.join(dirPath, entry.name);
    const relPath = path.join(relDir, entry.name).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      const children = scanDir(fullPath, relPath);
      nodes.push({
        name: entry.name,
        relPath,
        isDirectory: true,
        children
      });
    } else {
      const stats = fs.statSync(fullPath);
      nodes.push({
        name: entry.name,
        relPath,
        isDirectory: false,
        sizeBytes: stats.size,
        description: FILE_DESCRIPTIONS[relPath]
      });
    }
  }

  return nodes.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });
}

function renderTreeMarkdown(nodes, indent = '') {
  let out = '';
  for (const node of nodes) {
    if (node.isDirectory) {
      out += `${indent}- 📁 **${node.name}/**\n`;
      if (node.children && node.children.length > 0) {
        out += renderTreeMarkdown(node.children, indent + '  ');
      }
    } else {
      const desc = node.description ? ` — *${node.description}*` : '';
      out += `${indent}- 📄 \`${node.name}\`${desc}\n`;
    }
  }
  return out;
}

function generateArchitectureTree() {
  console.log('[Architect] Scanning HumanOS repository at:', REPO_ROOT);
  const treeNodes = scanDir(REPO_ROOT);

  const markdown = `# HumanOS Module Architecture Map (MAM) & Codebase Tree

> **Optimized for Gemini 3.8 Flash & Antigravity Architects**
> This map provides a zero-waste, token-efficient roadmap of the entire HumanOS ecosystem.
> Use it to immediately target files and understand architectural boundaries without bloated directory scans.

---

## 1. High-Level Architectural Layers

\`\`\`
┌────────────────────────────────────────────────────────────────────────┐
│                        MOBILE CLIENT (React Native)                     │
│  ChatScreen (WhatsApp style) │ KgExplorerScreen (2D/3D Neural Galaxy)   │
│  LifeTree │ EmotionLandscape │ GoalsHabits │ Zustand useChatStore      │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │  HTTP / SSE Streaming / OTA Updates
┌────────────────────────────────────▼───────────────────────────────────┐
│                        BACKEND SERVICE (Node / Express)                │
│  routes/chat.ts (Turn Ingress, Debounce, Coalescing, Fallback Guard)   │
│  services/NovaBrainService.ts (Prompt Assembly, Grounding, Reflection) │
│  services/WatchtowerInspector.ts (Anti-Parental, Verb Repairs)         │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
           ┌─────────────────────────┴─────────────────────────┐
           ▼                                                   ▼
┌───────────────────────────────┐               ┌───────────────────────────────┐
│     COGNITIVE ROUTER (LLM)    │               │     SUPABASE POSTGRES DB      │
│  Gemini 3.8 Flash (Primary)   │               │  chat_history (coalesced rows)│
│  20-Key Credential Pool       │               │  profiles (push_tokens, voice)│
│  NVIDIA NIM (Failover Backup) │               │  knowledge_nodes / edges      │
│  Auto-Model Fallback Cascade  │               │  reminders / life_threads     │
└───────────────────────────────┘               └───────────────────────────────┘
\`\`\`

---

## 2. Fast Route & File Lookup

| Subsystem | Critical File Path | Purpose / Responsibilities |
|---|---|---|
| **Chat & Routing** | \`backend/src/routes/chat.ts\` | Turn debouncing, burst aggregation, message coalescing, fallback safety-net. |
| **Cognitive Router** | \`backend/src/lib/cognitiveRouter.ts\` | Workload dispatch (Gemini primary ↔ NVIDIA failover), deadline budgeting. |
| **Gemini Pool** | \`backend/src/lib/gemini.ts\` | 20-slot key pool, Gemini 3.8 Flash primary, 404 fast-fail, strict rate-limit regex. |
| **Voice & Persona** | \`backend/src/services/WatchtowerInspector.ts\` | Strips "Beta", repairs Hindi verbs, prevents model instruction leaks. |
| **Prompt Builder** | \`backend/src/services/promptBuilder.ts\` | Feminine peer friendship tone, WhatsApp formatting rules, memory grounding. |
| **Neural Galaxy** | \`mobile/src/screens/analytics/KgExplorerScreen.tsx\` | Default 2D tactical view, auto-fit scale for outer bubbles, 36 live synaptic pulses. |
| **Mobile Chat Store** | \`mobile/src/store/useChatStore.ts\` | 5–10s human-paced texting intervals, multi-bubble delivery, optimistic cache. |
| **Update History** | \`mobile/src/config/updateHistory.json\` | Release notes index, in-app update notification modal triggers. |

---

## 3. Database Schema Blueprint (Supabase Postgres)

| Table | Key Columns | Purpose |
|---|---|---|
| \`chat_history\` | \`id, user_id, conversation_id, role, content, meta, created_at, reply_to_id\` | Coalesced turns with \`<NOVA_MESSAGE_BREAK>\`, prevents bubble spam. |
| \`profiles\` | \`id, preferred_name, companion_personality, grammatical_gender, push_token\` | User identity, preferences, and push notification tokens. |
| \`knowledge_nodes\` | \`id, user_id, label, department, confidence, stability, last_synapsed_at\` | Neural Galaxy hubs, entity branches, and leaf attribute stems. |
| \`knowledge_edges\` | \`id, user_id, source_id, target_id, relation_type, weight\` | Department trunks, hierarchical branches, and cross-domain bridges. |
| \`reminders\` | \`id, user_id, title, due_at, status, recurrence\` | Scheduled and active reminders (deterministic query < 200ms). |
| \`life_threads\` | \`id, user_id, title, status, category, last_updated_at\` | Ongoing user projects, relationships, and emotional threads. |

---

## 4. Complete Project Directory Hierarchy

${renderTreeMarkdown(treeNodes)}

---
*Generated automatically by \`.agents/skills/codebase-architect/scripts/generate_architecture_map.js\`*
`;

  const outDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_FILE, markdown, 'utf8');
  console.log('[Architect] Architecture tree successfully written to:', OUTPUT_FILE);
}

if (require.main === module) {
  generateArchitectureTree();
}

module.exports = { generateArchitectureTree };
