const fs = require('fs');
const file = 'c:/Users/Mentorus2/OneDrive/Documents/Human Os/backend/src/routes/chat.ts';
let content = fs.readFileSync(file, 'utf8');

// 1. Fix 'situationBrief' redefined.
// Replace 'const situationBrief = situationalAwareness.buildBrief(situationCtx);'
// with 'situationBrief = situationalAwareness.buildBrief(situationCtx);'
content = content.replace(
  "const situationBrief = situationalAwareness.buildBrief(situationCtx);",
  "situationBrief = situationalAwareness.buildBrief(situationCtx);"
);

// 2. Fix PromiseLike .catch error
content = content.replace(
  "upcomingRemindersFullPromise = supabaseAdmin.from('reminders').select('*').eq('user_id', userId).eq('status', 'active').or(`trigger_at.is.null,trigger_at.gte.${new Date().toISOString()}`).order('trigger_at', { ascending: true }).limit(10).then(res => res).catch(() => ({ data: [] }));",
  "upcomingRemindersFullPromise = supabaseAdmin.from('reminders').select('*').eq('user_id', userId).eq('status', 'active').or(`trigger_at.is.null,trigger_at.gte.${new Date().toISOString()}`).order('trigger_at', { ascending: true }).limit(10).then(res => res, err => ({ data: [] }));"
);

// 3. Fix unused sessionResult
content = content.replace(
  "unreadResult, totalMemoriesResult, upcomingReminders, behaviorPatternResult, temporalResult, upcomingDbResult, sessionResult",
  "unreadResult, totalMemoriesResult, upcomingReminders, behaviorPatternResult, temporalResult, upcomingDbResult"
);

// 4. Remove webSearchContext block
content = content.replace(
  "      let memoryContext = '';\n      if (webSearchContext) {\n        memoryContext += webSearchContext;\n      }",
  "      let memoryContext = '';"
);

fs.writeFileSync(file, content);
console.log('Fixed more TypeScript errors');
