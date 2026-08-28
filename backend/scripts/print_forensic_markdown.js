const fs = require('fs');

const data = JSON.parse(fs.readFileSync('scripts/forensic_snapshot_full.json', 'utf8'));

function toIST(utcStr) {
  if (!utcStr) return 'N/A';
  const d = new Date(utcStr);
  if (isNaN(d.getTime())) return utcStr;
  const istOffset = 5.5 * 3600 * 1000;
  const istDate = new Date(d.getTime() + istOffset);
  const Y = istDate.getUTCFullYear();
  const M = String(istDate.getUTCMonth() + 1).padStart(2, '0');
  const D = String(istDate.getUTCDate()).padStart(2, '0');
  const h = String(istDate.getUTCHours()).padStart(2, '0');
  const m = String(istDate.getUTCMinutes()).padStart(2, '0');
  const s = String(istDate.getUTCSeconds()).padStart(2, '0');
  return `${Y}-${M}-${D} ${h}:${m}:${s} IST`;
}

let out = [];

out.push('# NOVA — FULL REAL-WORLD COGNITIVE FORENSIC SNAPSHOT');
out.push('**READ-ONLY AUDIT**\n');
out.push(`FORENSIC SNAPSHOT TIMESTAMP:`);
out.push(`UTC: ${new Date().toISOString()}`);
out.push(`USER LOCAL TIME: ${toIST(new Date().toISOString())}\n`);
out.push('---\n');

// 1. USER PROFILE
out.push('## 1. USER PROFILE\n');
const p = data.profile || {};
out.push(`- **User ID**: \`${data.user_id}\``);
out.push(`- **Preferred / Display Name**: \`${p.preferred_name || 'N/A'}\``);
out.push(`- **Country**: \`${p.country || 'IN (Inferred/Default)'}\``);
out.push(`- **Timezone**: \`${p.timezone || 'Asia/Kolkata (IST)'}\``);
out.push(`- **Timezone Offset**: \`+5.5 hours (+05:30)\``);
out.push(`- **Grammatical Gender**: \`${p.grammatical_gender || 'neutral / male'}\``);
out.push(`- **Companion Personality**: \`${p.companion_personality || 'Friend'}\``);
out.push(`- **Onboarding Completed**: \`${p.onboarding_completed}\` (at ${toIST(p.onboarding_completed_at)})`);
out.push(`- **Preferences**: \`${JSON.stringify(p.preferences || {})}\``);
out.push(`- **Push Token**: \`${p.push_token ? '[CONFIGURED / ACTIVE EXPO TOKEN]' : '[NONE]'}\``);
out.push(`- **Online Status**: \`${p.is_online ? 'ONLINE' : 'OFFLINE'}\` (last active: ${toIST(p.last_active_at)})\n`);

// 2. COMPLETE RECENT CHAT HISTORY
out.push('## 2. COMPLETE RECENT CHAT HISTORY\n');
out.push(`Total conversational rows recorded: **${data.chatHistory.length}**\n`);

data.chatHistory.forEach((msg, idx) => {
  const isFallback = msg.content.includes('Yaar, kuch technical issue') || msg.content.includes('SystemFallback');
  const isProactive = msg.content.startsWith('[SYSTEM:') || msg.id.startsWith('proactive_') || (msg.meta && msg.meta.is_proactive);
  let msgType = 'normal chat';
  if (isFallback) msgType = 'fallback';
  else if (isProactive) msgType = 'proactive';
  else if (msg.role === 'system') msgType = 'system-generated';

  out.push(`### Message #${idx + 1}`);
  out.push(`- **Message ID**: \`${msg.id}\``);
  out.push(`- **Conversation ID**: \`${msg.conversation_id}\``);
  out.push(`- **Role**: \`${msg.role.toUpperCase()}\``);
  out.push(`- **Timestamp UTC**: \`${msg.created_at}\``);
  out.push(`- **Timestamp IST (Local)**: \`${toIST(msg.created_at)}\``);
  out.push(`- **Reply To ID**: \`${msg.reply_to_id || 'none'}\``);
  out.push(`- **Message Classification**: \`${msgType}\``);
  if (msg.meta && Object.keys(msg.meta).length > 0) {
    out.push(`- **Metadata**: \`${JSON.stringify(msg.meta)}\``);
  }
  out.push(`\n**Exact Content**:\n> ${msg.content.replace(/\n/g, '\n> ')}\n`);
});

// 3. PROACTIVE OUTREACH HISTORY
out.push('## 3. PROACTIVE OUTREACH HISTORY (`nova_outreach_log`)\n');
out.push(`Total outreach records: **${data.outreachLog.length}**\n`);

if (data.outreachLog.length === 0) {
  out.push('_No proactive outreach records found in database._\n');
} else {
  data.outreachLog.forEach((o, idx) => {
    out.push(`### Outreach #${idx + 1}`);
    out.push(`- **ID**: \`${o.id}\``);
    out.push(`- **Created At (UTC)**: \`${o.created_at}\``);
    out.push(`- **Created At (Local IST)**: \`${toIST(o.created_at)}\``);
    out.push(`- **Outreach Type**: \`${o.outreach_type}\``);
    out.push(`- **Logical Key**: \`${o.logical_key}\``);
    out.push(`- **Was Replied**: \`${o.replied_at ? 'YES' : 'NO'}\``);
    out.push(`- **Replied At**: \`${o.replied_at ? toIST(o.replied_at) : 'Not Replied'}\``);
    out.push(`\n**Message Text**:\n> ${o.message ? o.message.replace(/\n/g, '\n> ') : 'N/A'}\n`);
  });
}

// 4. FOLLOW-UP STATE
out.push('## 4. FOLLOW-UP STATE (`nova_followups`)\n');
out.push(`Total followups: **${data.followups.length}**\n`);

if (data.followups.length === 0) {
  out.push('_No followup records found._\n');
} else {
  data.followups.forEach((f, idx) => {
    out.push(`### Followup #${idx + 1}`);
    out.push(`- **ID**: \`${f.id}\``);
    out.push(`- **Message**: "${f.message}"`);
    out.push(`- **Status**: \`[${f.status ? f.status.toUpperCase() : 'UNKNOWN'}]\``);
    out.push(`- **Fire At (UTC / IST)**: \`${f.fire_at || 'N/A'}\` (${toIST(f.fire_at)})`);
    out.push(`- **Created At**: \`${toIST(f.created_at)}\`\n`);
  });
}

// 5. ACTIVE REMINDERS
out.push('## 5. ACTIVE REMINDERS (`reminders`)\n');
out.push(`Total reminders: **${data.reminders.length}**\n`);

if (data.reminders.length === 0) {
  out.push('_No reminders found in the database for this user._\n');
} else {
  data.reminders.forEach((r, idx) => {
    out.push(`### Reminder #${idx + 1}`);
    out.push(`- **ID**: \`${r.id}\``);
    out.push(`- **Title / Content**: \`${r.title || r.text || 'N/A'}\``);
    out.push(`- **Status**: \`${r.status}\``);
    out.push(`- **Due / Trigger At**: \`${r.trigger_at}\` (${toIST(r.trigger_at)})`);
    out.push(`- **Recurrence**: \`${r.recurrence_interval ? `${r.recurrence_interval} ${r.recurrence_type}` : 'One-off'}\``);
    out.push(`- **Created At**: \`${toIST(r.created_at)}\``);
    out.push(`- **Cancelled At**: \`${r.cancelled_at ? toIST(r.cancelled_at) : 'N/A'}\`\n`);
  });
}

// 6. LIFE THREADS
out.push('## 6. LIFE THREADS (`life_threads`)\n');
out.push(`Total life threads: **${data.lifeThreads.length}**\n`);

data.lifeThreads.forEach((t, idx) => {
  out.push(`### Thread #${idx + 1}: ${t.topic}`);
  out.push(`- **ID**: \`${t.id}\``);
  out.push(`- **State**: \`${t.state}\``);
  out.push(`- **Priority**: \`${t.priority}\``);
  out.push(`- **Provenance**: \`${JSON.stringify(t.provenance || {})}\``);
  out.push(`- **Last Relevant At**: \`${t.last_relevant_at}\` (${toIST(t.last_relevant_at)})`);
  out.push(`- **Next Relevant Time**: \`${t.next_relevant_time ? toIST(t.next_relevant_time) : 'N/A'}\``);
  out.push(`- **Related Memories**: \`${JSON.stringify(t.related_memory_ids || [])}\``);
  out.push(`- **Related Goals**: \`${JSON.stringify(t.related_goal_ids || [])}\``);
  out.push(`- **Created At**: \`${toIST(t.created_at)}\``);
  out.push(`- **Updated At**: \`${toIST(t.updated_at)}\`\n`);
});

// 7. ACTIONS
out.push('## 7. ACTIONS (`nova_actions`)\n');
out.push(`Total actions: **${data.actions.length}**\n`);

data.actions.forEach((a, idx) => {
  out.push(`### Action #${idx + 1}: ${a.title || a.logical_key}`);
  out.push(`- **ID**: \`${a.id}\``);
  out.push(`- **Logical Key**: \`${a.logical_key}\``);
  out.push(`- **State**: \`[${a.state.toUpperCase()}]\``);
  out.push(`- **Priority**: \`${a.priority}\``);
  out.push(`- **Execution Class**: \`${a.execution_class || 'N/A'}\``);
  out.push(`- **Due At**: \`${a.due_at ? toIST(a.due_at) : 'N/A'}\``);
  out.push(`- **Description**: \`${a.description || 'N/A'}\``);
  out.push(`- **Source Thread ID**: \`${a.source_thread_id || 'none'}\``);
  out.push(`- **Source Message ID**: \`${a.source_message_id || 'none'}\``);
  out.push(`- **Provenance**: \`${JSON.stringify(a.provenance || {})}\``);
  out.push(`- **Created At**: \`${toIST(a.created_at)}\``);
  out.push(`- **Updated At**: \`${toIST(a.updated_at)}\`\n`);
});

// 8. MEMORIES
out.push('## 8. MEMORIES — FULL CURRENT STATE\n');
out.push(`### 8.1 Long-Term & Durable Memories (\`memories\`: ${data.memories.length} records)\n`);

data.memories.forEach((m, idx) => {
  out.push(`- **[#${idx + 1}]** \`${m.key || 'unknown_key'}\` (${m.memory_type || 'general'}) | Imp: \`${m.importance}\` | Conf: \`${m.confidence}\` | Protected: \`${m.is_protected ? 'YES' : 'NO'}\` | Created: \`${toIST(m.created_at)}\``);
  out.push(`  - **Value/Content**: "${m.value}"`);
});

out.push(`\n### 8.2 Short-Term Memories (\`short_term_memories\`: ${data.short_term_memories.length} records)\n`);
data.short_term_memories.forEach((s, idx) => {
  out.push(`- **[#${idx + 1}]** Imp: \`${s.importance}\` | Conf: \`${s.confidence}\` | Emotion: \`${s.emotion || 'neutral'}\` | Mentions: \`${s.mention_count || 1}\` | Created: \`${toIST(s.created_at)}\``);
  out.push(`  - **Memory Statement**: "${s.memory}"`);
});

out.push(`\n### 8.3 Episodic Memories (\`episodic_memories\`: ${data.episodic_memories?.length || 0} records)\n`);
(data.episodic_memories || []).forEach((e, idx) => {
  out.push(`- **[#${idx + 1}]** Emotion: \`${e.emotion}\` | Created: \`${toIST(e.created_at)}\``);
  out.push(`  - **Summary**: "${e.summary}"`);
});

// 9. MEMORY CONFLICTS
out.push('\n## 9. MEMORY CONFLICTS\n');
out.push('Detailed inspection of duplicated or contradicting keys in persisted storage:\n');
const keyMap = new Map();
data.memories.forEach(m => {
  const k = m.key;
  if (k) {
    if (!keyMap.has(k)) keyMap.set(k, []);
    keyMap.get(k).push(m);
  }
});

let conflictFound = false;
for (const [k, rows] of keyMap.entries()) {
  if (rows.length > 1) {
    conflictFound = true;
    out.push(`### Conflict on Key: \`${k}\``);
    rows.forEach((r, i) => {
      out.push(`- **Version ${i + 1}** (ID: \`${r.id}\`, Created: \`${toIST(r.created_at)}\`): "${r.value}" (Protected: ${r.is_protected})`);
    });
    out.push('');
  }
}
if (!conflictFound) {
  out.push('_No direct key collisions detected in `memories` table._\n');
}

// 10. WORKING MEMORY
out.push('## 10. WORKING MEMORY (`working_memory`)\n');
out.push(`Total active working memory rows: **${data.working_memory.length}**\n`);
if (data.working_memory.length === 0) {
  out.push('_Table is currently empty or expired._\n');
} else {
  data.working_memory.forEach((w, idx) => {
    out.push(`- **Key**: \`${w.key}\` | **Value**: "${w.value}" | **Updated**: \`${toIST(w.updated_at)}\` | **Expires**: \`${toIST(w.expires_at)}\``);
  });
}

// 11. PRESENCE / SESSION
out.push('\n## 11. PRESENCE / SESSION STATE\n');
out.push(`- **Presence**: \`${JSON.stringify(data.presence || {})}\``);
out.push(`- **Sessions**: ${data.sessions?.length || 0} recorded sessions\n`);
(data.sessions || []).forEach(s => {
  out.push(`  - Date: \`${s.session_date}\` | Msg Count: \`${s.message_count}\` | Updated: \`${toIST(s.updated_at)}\``);
});

// 12. AGENDA / GOALS / NUDGES
out.push('\n## 12. AGENDA / GOALS / NUDGES\n');
out.push(`- **Agenda Items**: ${data.agenda?.length || 0}`);
(data.agenda || []).forEach(a => out.push(`  - [${a.status}] ${a.title || a.task_description}`));
out.push(`- **Goals**: ${data.goals?.length || 0}`);
(data.goals || []).forEach(g => out.push(`  - [${g.status}] ${g.title || g.goal}`));
out.push(`- **Habits**: ${data.habits?.length || 0}`);
out.push(`- **Nudges**: ${data.nudges?.length || 0}`);
out.push(`- **Proactive Triggers**: ${data.proactiveTriggers?.length || 0}\n`);

// 13. QUEUE / JOB STATE
out.push('## 13. QUEUE / BACKGROUND JOB STATE\n');
out.push(`- **Recent Background Jobs** (${data.bgJobs?.length || 0}):`);
(data.bgJobs || []).slice(0, 15).forEach(j => {
  out.push(`  - Job: \`${j.job_type}\` | Status: \`[${j.status}]\` | Attempts: \`${j.attempts}/${j.max_attempts}\` | Created: \`${toIST(j.created_at)}\``);
});
out.push(`- **Failed Jobs** (${data.failedJobs?.length || 0}):`);
(data.failedJobs || []).slice(0, 10).forEach(f => {
  out.push(`  - Failed Job: \`${f.job_type}\` | Error: \`${f.error}\` | Created: \`${toIST(f.created_at)}\``);
});

// 14. COGNITIVE CONTEXT
out.push('\n## 14. COGNITIVE CONTEXT (Canonical read-only assembly)\n');
out.push('```json');
out.push(JSON.stringify(data.cognitive_context, null, 2));
out.push('```\n');

fs.writeFileSync('scripts/FORENSIC_SNAPSHOT_REPORT.md', out.join('\n'));
console.log('Updated FORENSIC_SNAPSHOT_REPORT.md');
