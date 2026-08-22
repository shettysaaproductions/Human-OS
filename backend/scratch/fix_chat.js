const fs = require('fs');
const file = 'c:/Users/Mentorus2/OneDrive/Documents/Human Os/backend/src/routes/chat.ts';
let content = fs.readFileSync(file, 'utf8');

// 1. Remove unused SituationContext
content = content.replace(
  "import { situationalAwareness, SituationContext } from '../services/SituationalAwareness';",
  "import { situationalAwareness } from '../services/SituationalAwareness';"
);

// 2. Fix the .catch() on Supabase queries by adding .then(res => res) before it
// There are several! Let's just fix the specific ones I added.
content = content.replace(
  /\.catch\(\(\) => \(\{ data: null \}\)\)/g,
  ".then(res => res).catch(() => ({ data: null }))"
);
content = content.replace(
  /\.catch\(\(\) => \(\{ data: \[\] \}\)\)/g,
  ".then(res => res).catch(() => ({ data: [] }))"
);
content = content.replace(
  /\.catch\(\(\) => \(\{ count: 0 \}\)\)/g,
  ".then(res => res).catch(() => ({ count: 0 }))"
);
content = content.replace(
  /\.catch\(\(\) => \(\{ data: null, error: null \}\)\)/g,
  ".then(res => res).catch(() => ({ data: null, error: null }))"
);
content = content.replace(
  /\.catch\(\(\) => null\)/g,
  ".then(res => res).catch(() => null)"
);
content = content.replace(
  "supabaseAdmin.from('conversation_sessions').insert({ user_id: userId, session_date: today, message_count: 1 }).then()",
  "supabaseAdmin.from('conversation_sessions').insert({ user_id: userId, session_date: today, message_count: 1 }).then(res => res)"
);
content = content.replace(
  "supabaseAdmin.from('conversation_sessions').update({ message_count: (session.message_count || 0) + 1, updated_at: new Date().toISOString() }).eq('id', session.id).then()",
  "supabaseAdmin.from('conversation_sessions').update({ message_count: (session.message_count || 0) + 1, updated_at: new Date().toISOString() }).eq('id', session.id).then(res => res)"
);
content = content.replace(
  "supabaseAdmin.from('chat_history').update({ conversation_id: activeConversationId }).eq('id', userMessageId).then()",
  "supabaseAdmin.from('chat_history').update({ conversation_id: activeConversationId }).eq('id', userMessageId).then(res => res)"
);

// 3. Fix unused sessionPromise
// Just add an await for it in the Promise.all
content = content.replace(
  "unreadPromise, totalMemoriesPromise, remindersPromise, behaviorPatternPromise, temporalPromise, upcomingRemindersFullPromise",
  "unreadPromise, totalMemoriesPromise, remindersPromise, behaviorPatternPromise, temporalPromise, upcomingRemindersFullPromise, sessionPromise"
);
content = content.replace(
  "unreadResult, totalMemoriesResult, upcomingReminders, behaviorPatternResult, temporalResult, upcomingDbResult",
  "unreadResult, totalMemoriesResult, upcomingReminders, behaviorPatternResult, temporalResult, upcomingDbResult, sessionResult"
);

// 4. oldConversationId is unused
content = content.replace(
  "const oldConversationId = activeConversationId;\n          activeConversationId = crypto.randomUUID();",
  "activeConversationId = crypto.randomUUID();"
);

// 5. Add responseConfig back
const brainContextStr = "const brainContext = {";
const responseConfigStr = "const responseConfig = classifyIntent(effectiveMessage, recentMessages.map(m => m.content));\n\n      " + brainContextStr;
content = content.replace(brainContextStr, responseConfigStr);

fs.writeFileSync(file, content);
console.log('Fixed TypeScript errors');
