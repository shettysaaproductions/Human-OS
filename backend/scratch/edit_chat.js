const fs = require('fs');
const file = 'c:/Users/Mentorus2/OneDrive/Documents/Human Os/backend/src/routes/chat.ts';
const content = fs.readFileSync(file, 'utf8');

const startMarker = '// ── PARALLEL FETCH: profile, chat history, cross-session,';
const endMarker = '      // === MEMORY RETRIEVAL (REUSE ALREADY-FETCHED DATA) ===';

const startIdx = content.indexOf(startMarker);
const endIdx = content.indexOf(endMarker, startIdx);

if (startIdx === -1 || endIdx === -1) {
  console.error('Markers not found!');
  process.exit(1);
}

const newBlock = `// ── UNIFIED PARALLEL FETCH (Phase 1 Latency Optimization) ──
      const keywords = extractKeywords(effectiveMessage);
      const profileCacheKey = \`profile:\${userId}\`;
      const wmCacheKey = \`working_memory:\${userId}\`;
      const cachedProfile = cache.get<{ preferred_name: string; companion_personality: string; country?: string; push_token?: string; current_visual_context?: string; timezone_offset?: number }>(profileCacheKey);
      const cachedWm = cache.get<{ key: string; value: string }[]>(wmCacheKey);
      const skipMemory = process.env.DISABLE_MEMORY === 'true';
      const today = new Date().toISOString().split('T')[0];

      const dbStartTime = Date.now();

      const profilePromise = (cachedProfile && cachedProfile.push_token)
        ? Promise.resolve({ data: cachedProfile, error: null })
        : qt.track('get_profile', 'profiles', () => supabaseAdmin.from('profiles').select('preferred_name, companion_personality, country, push_token, current_visual_context, timezone_offset').eq('id', userId).maybeSingle());

      const historyPromise = qt.track('get_chat_history', 'chat_history', () => supabaseAdmin.from('chat_history').select('role, content, reply_to_content').eq('user_id', userId).eq('conversation_id', activeConversationId).order('created_at', { ascending: false }).limit(100));

      const crossSessionPromise = qt.track('get_cross_session_context', 'chat_history', () => supabaseAdmin.from('chat_history').select('role, content').eq('user_id', userId).neq('conversation_id', activeConversationId).order('created_at', { ascending: false }).limit(6)).catch(() => ({ data: null, error: null }));

      const wmPromise = cachedWm
        ? Promise.resolve({ data: cachedWm.map(w => ({ key: w.key, value: w.value })), error: null })
        : skipMemory
        ? Promise.resolve({ data: [], error: null })
        : qt.track('get_working_memory', 'working_memory', () => supabaseAdmin.from('working_memory').select('key, value').eq('user_id', userId).gt('expires_at', new Date().toISOString()).limit(10));

      const memoriesPromise = skipMemory ? Promise.resolve([]) : memoryRepository.searchMemories(userId, keywords).catch(() => []);

      const stmPromise = skipMemory
        ? Promise.resolve({ data: [], error: null })
        : qt.track('get_short_term_memories', 'short_term_memories', () => supabaseAdmin.from('short_term_memories').select('memory, emotion, importance, mention_count, expires_at, confidence, created_at').eq('user_id', userId).gte('confidence', 0.6).or(\`expires_at.is.null,expires_at.gt.\${new Date().toISOString()}\`).order('importance', { ascending: false }).order('last_mentioned_at', { ascending: false }).limit(20));

      const searchPromise = import('../services/WebSearchService')
        .then(({ webSearchService }) => webSearchService.evaluateSearchNeed(effectiveMessage)
          .then(need => need ? webSearchService.executeSearch(need) : null))
        .catch(e => { logger.warn('[Chat] Web search failed', { error: e }); return null; });

      const sessionPromise = qt.track('get_session', 'conversation_sessions', () => supabaseAdmin.from('conversation_sessions').select('id, message_count').eq('user_id', userId).eq('session_date', today).maybeSingle())
        .then(({ data: session }) => {
          if (session) supabaseAdmin.from('conversation_sessions').update({ message_count: (session.message_count || 0) + 1, updated_at: new Date().toISOString() }).eq('id', session.id).then();
          else supabaseAdmin.from('conversation_sessions').insert({ user_id: userId, session_date: today, message_count: 1 }).then();
        }).catch(() => null);

      const emotionPromise = qt.track('get_latest_emotion', 'emotional_states', () => supabaseAdmin.from('emotional_states').select('mood, intensity, notes').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle()).catch(() => ({ data: null }));
      const episodicPromise = qt.track('get_recent_episodes', 'episodic_memories', () => supabaseAdmin.from('episodic_memories').select('summary, emotion, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(5)).catch(() => ({ data: [] }));
      const reflectionPromise = qt.track('get_latest_reflection', 'reflections', () => supabaseAdmin.from('reflections').select('summary, key_takeaways').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle()).catch(() => ({ data: null }));
      const lastMsgPromise = qt.track('get_last_msg_time', 'chat_history', () => supabaseAdmin.from('chat_history').select('created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle()).catch(() => ({ data: null }));
      const presencePromise = qt.track('get_user_presence', 'user_presence', () => supabaseAdmin.from('user_presence').select('status, last_active_at, last_typing_at').eq('user_id', userId).maybeSingle()).catch(() => ({ data: null }));
      const unreadPromise = qt.track('get_unread_nova', 'chat_history', () => supabaseAdmin.from('chat_history').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('role', 'assistant').eq('is_read', false)).catch(() => ({ count: 0 }));
      const totalMemoriesPromise = qt.track('get_total_memories_count', 'memories', () => supabaseAdmin.from('memories').select('id', { count: 'exact', head: true }).eq('user_id', userId)).catch(() => ({ count: 0 }));

      const remindersPromise = reminderService.getUpcomingReminders(userId).catch(err => {
        logger.warn('[SituationalAwareness] Reminders fetch failed', { error: err instanceof Error ? err.message : String(err) }); return [];
      });
      const behaviorPatternPromise = presencePatternService.getBehaviorPattern(userId).catch(err => {
        logger.warn('[SituationalAwareness] Behavior pattern fetch failed', { error: err instanceof Error ? err.message : String(err) }); return { pattern: 'UNKNOWN', description: '' };
      });

      const TEMPORAL_KEYWORDS = [
        'yesterday', 'days ago', 'last week', 'last month', 'do you remember',
        'what time', 'what day', 'when did', 'earlier today', 'this morning', 
        'last night', 'tell me what', 'you said', 'i said', 'we talked',
        'kal', 'parso', 'yaad hai', 'yaad karo', 'kab', 'kitne baje', 
        'time kya tha', 'exact time', 'pehle', 'abhi', 'aaj subah',
        'raat ko', 'dopahar', 'shaam ko', 'maine kaha tha', 'tune kaha tha',
        'bataya tha', 'bola tha', 'likha tha'
      ];
      const isTemporalQuery = TEMPORAL_KEYWORDS.some(kw => effectiveMessage.toLowerCase().includes(kw));
      const temporalPromise = isTemporalQuery
        ? qt.track('get_temporal_context', 'chat_history', () => supabaseAdmin.from('chat_history').select('role, content, created_at').eq('user_id', userId).gte('created_at', new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()).order('created_at', { ascending: false }).limit(80)).catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] });

      const upcomingRemindersFullPromise = supabaseAdmin.from('reminders').select('*').eq('user_id', userId).eq('status', 'active').or(\`trigger_at.is.null,trigger_at.gte.\${new Date().toISOString()}\`).order('trigger_at', { ascending: true }).limit(10).catch(() => ({ data: [] }));

      // AWAIT ALL CONTEXT CONCURRENTLY
      const [
        profileResult, historyResult, crossSessionResult, wmResult, memoriesResult, stmResult, searchData,
        emotionResult, episodicResult, reflectionResult, lastMsgResult, presenceResult,
        unreadResult, totalMemoriesResult, upcomingReminders, behaviorPatternResult, temporalResult, upcomingDbResult
      ] = await Promise.all([
        profilePromise, historyPromise, crossSessionPromise, wmPromise, memoriesPromise, stmPromise, searchPromise,
        emotionPromise, episodicPromise, reflectionPromise, lastMsgPromise, presencePromise,
        unreadPromise, totalMemoriesPromise, remindersPromise, behaviorPatternPromise, temporalPromise, upcomingRemindersFullPromise
      ]);

      const dbDuration = Date.now() - dbStartTime;
      logger.info('[Chat] Parallel context fetch completed', { userId, durationMs: dbDuration });

      if (searchData) {
        effectiveMessage = \`\${searchData}\\n\\nUser's question: \${effectiveMessage}\`;
        logger.info('[Chat] Web Search prepended to effectiveMessage');
      }

      // ── Unpack results ─────────────────────────────────────────────────────────
      let profile = profileResult.data as any;
      if (profile && !cachedProfile) cache.set(profileCacheKey, profile, CACHE_TTL.PROFILE_MS, CACHE_NS.PROFILE);

      const FALLBACK_PREFIXES = [ 'Yaar, kuch technical issue', 'Yaar, thoda technical glitch', 'kuch technical issue aa gaya', '[SYSTEM]', 'Thodi der mein phir try karo', 'reminder set nahi kar sakta', 'reminder system thoda busy', 'Nova ka reminder system', 'Sorry yaar, reminder', 'system busy hai', 'set nahi kar sakta' ];
      const isFallback = (content: string) => FALLBACK_PREFIXES.some(p => content.includes(p));

      let recentMessages = ((historyResult.data || []) as any[])
        .filter(msg => msg.role !== 'assistant' || !isFallback(msg.content))
        .reverse()
        .map(msg => ({ role: msg.role as 'user'|'assistant'|'system', content: msg.reply_to_content ? \`[Replying to: "\${msg.reply_to_content}"]\\n\${msg.content}\` : msg.content }));

      let recentCrossSessionContext = '';
      if (crossSessionResult.data && (crossSessionResult.data as any[]).length > 0) {
        recentCrossSessionContext = (crossSessionResult.data as any[]).filter(m => !isFallback(m.content)).reverse().map(m => \`\${m.role === 'assistant' ? 'Nova' : 'User'}: \${m.content.substring(0, 200)}\${m.content.length > 200 ? '...' : ''}\`).join('\\n');
      }

      let workingMemories: { key: string; value: string }[] = [];
      if (!skipMemory) {
        if (cachedWm) workingMemories = cachedWm;
        else if (wmResult.data) {
          workingMemories = (wmResult.data as any[]).map(wm => ({ key: wm.key, value: wm.value }));
          cache.set(wmCacheKey, workingMemories, CACHE_TTL.WORKING_MEMORY_MS, CACHE_NS.WORKING_MEMORY);
        }
      }

      const memories: any[] = Array.isArray(memoriesResult) ? memoriesResult : [];

      let shortTermMemories: any[] = [];
      if (!skipMemory) {
        const allFetched = (stmResult.data as any[]) || [];
        let stmTokens = 0;
        for (const m of allFetched) {
          const memStr = \`\${m.memory} \${m.emotion || ''}\`;
          const tokens = Math.ceil(memStr.length / 4);
          if (stmTokens + tokens > 600) break;
          shortTermMemories.push({ memory: m.memory, emotion: m.emotion, importance: m.importance, timestamp: m.created_at ? timeAgo(m.created_at) : null });
          stmTokens += tokens;
        }
      }

      const userCountry = profile?.country || 'IN';
      const TIMEZONE_OFFSETS: Record<string, number> = { IN: 5.5, US: -5, UK: 0, AU: 10, AE: 4, SA: 3, PK: 5, BD: 6, SG: 8, JP: 9, DE: 1, FR: 1, CA: -5, NZ: 12, ZA: 2, NG: 1, KE: 3, BR: -3 };
      const tzOffset = TIMEZONE_OFFSETS[userCountry] ?? 5.5;
      const tzMs = tzOffset * 3600 * 1000;
      const nowLocal = new Date(Date.now() + tzMs);
      const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const dayIdx = nowLocal.getUTCDay();
      const dateStr = \`\${DAY_NAMES[dayIdx]}, \${MONTH_NAMES[nowLocal.getUTCMonth()]} \${nowLocal.getUTCDate()}, \${nowLocal.getUTCFullYear()}\`;
      const hh = nowLocal.getUTCHours(), mm = nowLocal.getUTCMinutes();
      const timeStr = \`\${hh % 12 || 12}:\${mm.toString().padStart(2,'0')} \${hh >= 12 ? 'PM' : 'AM'}\`;
      const tzLabel = tzOffset === 5.5 ? 'IST' : \`UTC\${tzOffset >= 0 ? '+' : ''}\${tzOffset}\`;
      
      const FRIDAY_SAT_WEEKEND = ['AE', 'SA', 'QA', 'BH', 'KW', 'OM', 'AF', 'IR'];
      let isWeekend = FRIDAY_SAT_WEEKEND.includes(userCountry) ? dayIdx === 5 || dayIdx === 6 : dayIdx === 0 || dayIdx === 6;

      let scheduleOverrideNote: string | undefined;
      if (workingMemories.length > 0) {
        const todayName = DAY_NAMES[dayIdx].toLowerCase();
        for (const wm of workingMemories) {
          const val = wm.value.toLowerCase();
          if (val.includes(todayName) && (val.includes('working') || val.includes('work day') || val.includes('office'))) { isWeekend = false; break; }
          if ((val.includes('weekoff') || val.includes('week off') || val.includes('day off')) && val.includes(todayName)) { isWeekend = true; break; }
          if ((val.includes('weekoff') || val.includes('week off') || val.includes('day off'))) {
            const DAYS_LC = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
            const weekoffDay = DAYS_LC.find(d => val.includes(d));
            if (weekoffDay && weekoffDay !== todayName) { isWeekend = false; break; }
          }
        }
        const calendarIsWeekend = FRIDAY_SAT_WEEKEND.includes(userCountry) ? dayIdx === 5 || dayIdx === 6 : dayIdx === 0 || dayIdx === 6;
        if (calendarIsWeekend !== isWeekend) {
          scheduleOverrideNote = !isWeekend ? \`⚠️ SCHEDULE OVERRIDE: The calendar says today (\${DAY_NAMES[dayIdx]}) is a weekend, BUT the user's actual work schedule says they are WORKING today. Treat today as a NORMAL WORKING DAY.\` : \`⚠️ SCHEDULE OVERRIDE: The user's memory says today (\${DAY_NAMES[dayIdx]}) is their WEEKOFF / day off. Treat today as a rest day.\`;
        }
      }

      let gapMinutes: number | null = null;
      if (lastMsgResult.data?.created_at) gapMinutes = (Date.now() - new Date(lastMsgResult.data.created_at).getTime()) / 60000;

      if (gapMinutes !== null) {
        if (gapMinutes > 1440) {
          const oldConversationId = activeConversationId;
          activeConversationId = crypto.randomUUID();
          if (!is_proactive && userMessageId && !userMessageId.startsWith('msg_')) supabaseAdmin.from('chat_history').update({ conversation_id: activeConversationId }).eq('id', userMessageId).then();
          recentMessages = recentMessages.length > 0 && recentMessages[recentMessages.length - 1].role === 'user' ? [recentMessages[recentMessages.length - 1]] : [];
        } else if (gapMinutes > 360) {
          recentMessages = recentMessages.slice(-3);
        }
      }

      const userPresence = presenceResult.data ? { status: presenceResult.data.status || 'offline', last_active_at: presenceResult.data.last_active_at, last_typing_at: presenceResult.data.last_typing_at } : null;

      const situationCtx = {
        nowLocal, tzLabel, country: userCountry, gapMinutes,
        latestEmotion: emotionResult.data, recentEpisodes: episodicResult.data || [],
        latestReflection: reflectionResult.data, isWeekend, scheduleOverrideNote, dayName: DAY_NAMES[dayIdx],
        dateStr, timeStr, lastUserMessage: effectiveMessage, upcomingReminders,
        currentVisualContext: profile?.current_visual_context, userPresence,
        unreadNovaMessages: unreadResult.count || 0, behaviorPattern: behaviorPatternResult.pattern !== 'UNKNOWN' ? \`\${behaviorPatternResult.pattern} (\${behaviorPatternResult.description})\` : null,
        totalMemoriesCount: totalMemoriesResult.count || 0,
      };
      const situationBrief = situationalAwareness.buildBrief(situationCtx);

      let temporalContextBlock = '';
      if (temporalResult.data && temporalResult.data.length > 0) {
        const lines = temporalResult.data.reverse().map((m: any) => {
          const d = new Date(new Date(m.created_at).getTime() + tzMs);
          const tStr = \`\${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()]}, \${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]} \${d.getUTCDate()} · \${d.getUTCHours().toString().padStart(2,'0')}:\${d.getUTCMinutes().toString().padStart(2,'0')} \${tzLabel}\`;
          return \`[\${tStr}] \${m.role === 'assistant' ? 'Nova' : 'You'}: \${m.content.substring(0, 300)}\${m.content.length > 300 ? '...' : ''}\`;
        });
        temporalContextBlock = '\\n\\n## WHAT WAS SAID RECENTLY (Exact Archive — last 30 days)\\n' + lines.join('\\n') + '\\n\\nCRITICAL TEMPORAL RULE: The user is asking about a past conversation or timestamp. Find the answer in the archive above and tell them the exact time or context. Do NOT bring up unrelated facts from your long-term memory.';
      }

      let remindersContext = '';
      if (upcomingDbResult.data && upcomingDbResult.data.length > 0) {
        remindersContext = '\\n\\n## ACTIVE REMINDERS (SOURCE OF TRUTH)\\nThe user currently has these reminders active:\\n' + upcomingDbResult.data.map((r: any) => {
          const when = r.trigger_at ? (() => { const d = new Date(new Date(r.trigger_at).getTime() + tzMs); return \`at \${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()]}, \${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]} \${d.getUTCDate()} · \${d.getUTCHours().toString().padStart(2,'0')}:\${d.getUTCMinutes().toString().padStart(2,'0')} \${tzLabel}\`; })() : \`on event "\${r.event_trigger || 'unknown event'}"\`;
          return \`- [ID: "\${r.id}"] \${r.text || r.title} \${when}\${r.recurrence_interval ? \` (repeats every \${r.recurrence_interval} \${r.recurrence_type || 'time(s)'})\` : ''}\${r.active_days?.length ? \` [only on: \${r.active_days.join(', ')}]\` : ''}\${r.active_months?.length ? \` [only in: \${r.active_months.join(', ')}\${r.active_year ? ' ' + r.active_year : ''}]\` : ''}\${r.urgency && r.urgency !== 'medium' ? \` [\${r.urgency} urgency]\` : ''}\${r.purpose ? \` — \${r.purpose}\` : ''}\${r.is_auto ? ' [auto-detected]' : ''}\`;
        }).join('\\n') + '\\n\\nCRITICAL ANTI-HALLUCINATION RULE: This list is the absolute source of truth. If past chat history says a reminder was cancelled but it appears here, it is STILL ACTIVE. Do not contradict this list. Do NOT invent or guess about reminders not in this list. If the user asks about a reminder, rely strictly on these IDs and descriptions.';
      } else {
        remindersContext = '\\n\\n## ACTIVE REMINDERS (SOURCE OF TRUTH)\\n[EMPTY LIST] The user currently has NO active reminders.\\nCRITICAL ANTI-HALLUCINATION RULE: If the user asks for their reminders, you MUST tell them they have no active reminders. NEVER invent or hallucinate reminders. Do NOT guess from past conversation. If this list is empty, they have NO reminders.';
      }

\n`;

const finalContent = content.substring(0, startIdx) + newBlock + content.substring(endIdx);
fs.writeFileSync(file, finalContent);
console.log('Successfully parallelized DB fetches!');
