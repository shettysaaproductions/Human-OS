import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

const CHAR_BUDGET = 150_000;
const TRIM_TARGET = 120_000;
const MAX_MESSAGES = 2_000;
const BATCH_SIZE = 100;

// ─────────────────────────────────────────────────────────────────────────────
// EMOTION CLASSIFIER
// Returns the dominant emotion label from the content.
// Pure keyword heuristics — zero API calls, zero egress impact.
// ─────────────────────────────────────────────────────────────────────────────
const EMOTION_MAP: { emotion: string; keywords: string[] }[] = [
  { emotion: 'grief',     keywords: ['died', 'death', 'funeral', 'passed away', 'lost him', 'lost her', 'missing you', 'miss them', 'loss'] },
  { emotion: 'crisis',    keywords: ['suicidal', 'want to die', 'kill myself', 'end it all', 'no point', 'hopeless', 'give up on life'] },
  { emotion: 'anxiety',   keywords: ['anxious', 'anxiety', 'panic', 'stressed out', 'overthinking', 'can\'t breathe', 'nervous wreck', 'scared', 'fear'] },
  { emotion: 'sadness',   keywords: ['sad', 'crying', 'depressed', 'depression', 'hopeless', 'lonely', 'alone', 'heartbroken', 'devastated', 'upset'] },
  { emotion: 'anger',     keywords: ['angry', 'furious', 'rage', 'mad', 'frustrated', 'hate', 'irritated', 'annoyed', 'fed up', 'pissed'] },
  { emotion: 'joy',       keywords: ['happy', 'excited', 'thrilled', 'overjoyed', 'amazing', 'fantastic', 'wonderful', 'great news', 'love it', 'best day'] },
  { emotion: 'love',      keywords: ['love you', 'love her', 'love him', 'in love', 'romantic', 'relationship', 'girlfriend', 'boyfriend', 'partner', 'crush'] },
  { emotion: 'pride',     keywords: ['promoted', 'got the job', 'passed', 'graduated', 'achieved', 'won', 'succeeded', 'proud', 'milestone'] },
  { emotion: 'worry',     keywords: ['worried', 'concern', 'not sure', 'what if', 'scared about', 'problem', 'issue', 'trouble', 'conflict'] },
  { emotion: 'hope',      keywords: ['hope', 'maybe', 'trying', 'working on', 'planning', 'goal', 'dream', 'future', 'want to', 'will try'] },
  { emotion: 'neutral',   keywords: [] },
];

function classifyEmotion(text: string): string {
  const lower = text.toLowerCase();
  for (const { emotion, keywords } of EMOTION_MAP) {
    if (keywords.some(kw => lower.includes(kw))) return emotion;
  }
  return 'neutral';
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANCE SCORER
// Returns a score 0.0–1.0.  Pure local heuristics — no external calls.
//
// Scoring philosophy:
//   • High-emotion topics are inherently important (grief, crisis, anxiety)
//   • Life events (health, family, career, money, goals) matter more than chit-chat
//   • Longer messages contain more information → slight length boost
//   • Short filler messages ("ok", "haan", "thanks") → low importance
// ─────────────────────────────────────────────────────────────────────────────
const IMPORTANCE_TOPICS = [
  // Critical / life events — weight 1.0
  { weight: 1.0, keywords: ['suicidal', 'want to die', 'died', 'death', 'cancer', 'diagnosed', 'surgery', 'hospital', 'admitted', 'accident', 'abuse', 'assault'] },
  // High-importance personal events — weight 0.85
  { weight: 0.85, keywords: ['breakup', 'divorce', 'fired', 'lost my job', 'got the job', 'promoted', 'pregnant', 'baby', 'marriage', 'engaged', 'heartbroken', 'grief', 'panic attack'] },
  // Health & medical — weight 0.80
  { weight: 0.80, keywords: ['health', 'sick', 'fever', 'doctor', 'medicine', 'therapy', 'therapist', 'mental health', 'anxiety', 'depression', 'pain', 'blood pressure', 'diabetes'] },
  // Relationships & family — weight 0.75
  { weight: 0.75, keywords: ['wife', 'husband', 'mom', 'dad', 'mother', 'father', 'sister', 'brother', 'family', 'friend', 'relationship', 'argument', 'fight with'] },
  // Career & money — weight 0.70
  { weight: 0.70, keywords: ['salary', 'money', 'debt', 'loan', 'investment', 'career', 'exam', 'interview', 'college', 'university', 'marks', 'result', 'business'] },
  // Goals & personal growth — weight 0.65
  { weight: 0.65, keywords: ['goal', 'habit', 'workout', 'gym', 'meditation', 'learning', 'reading', 'project', 'startup', 'plan', 'schedule', 'routine'] },
  // Emotions expressed — weight 0.60
  { weight: 0.60, keywords: ['feel', 'feeling', 'emotion', 'mood', 'stressed', 'excited', 'worried', 'scared', 'confused', 'hurt', 'angry', 'happy', 'sad'] },
];

const FILLER_PATTERNS = /^(ok|okay|haan|ha|hmm|lol|haha|k|thanks|ty|bye|hi|hello|hey|good|nice|wow|yep|yes|no|nah|sure|cool|right|got it|understood|agreed|same|fine|alright|great|noted)[\s!?.]*$/i;

function scoreImportance(content: string, emotion: string): number {
  const lower = content.toLowerCase().trim();

  // Filler messages → near-zero importance
  if (content.length < 15 && FILLER_PATTERNS.test(lower)) return 0.1;

  // Crisis/grief emotion → always maximum importance
  if (emotion === 'crisis' || emotion === 'grief') return 1.0;

  let score = 0.3; // baseline for any non-filler message

  // Topic matching — take the highest matching weight
  for (const { weight, keywords } of IMPORTANCE_TOPICS) {
    if (keywords.some(kw => lower.includes(kw))) {
      score = Math.max(score, weight);
    }
  }

  // Emotion bonus
  const emotionBonus: Record<string, number> = {
    anxiety: 0.15, sadness: 0.12, anger: 0.10, love: 0.10,
    pride: 0.08, worry: 0.08, joy: 0.05, hope: 0.05, neutral: 0,
  };
  score += (emotionBonus[emotion] || 0);

  // Length bonus — longer messages carry more information
  if (content.length > 200) score += 0.08;
  if (content.length > 100) score += 0.04;

  return Math.min(parseFloat(score.toFixed(2)), 1.0);
}

// ─────────────────────────────────────────────────────────────────────────────
// EXTRACTION GATE
// Only extract messages that carry meaningful content worth keeping.
// ─────────────────────────────────────────────────────────────────────────────
function shouldExtractMemory(content: string): boolean {
  if (content.trim().length < 10) return false; // too short
  if (FILLER_PATTERNS.test(content.trim())) return false; // pure filler
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
export interface PruneResult {
  userId: string;
  skipped: boolean;
  charsBefore: number;
  charsAfter: number;
  rowsDeleted: number;
  memoriesExtracted: number;
}

export const chatHistoryPruningService = {

  async pruneUser(userId: string): Promise<PruneResult> {
    const { data: rows, error } = await supabaseAdmin
      .from('chat_history')
      .select('id, role, content, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error || !rows) {
      logger.error('[Pruning] Failed to fetch history', { userId, error: error?.message });
      return { userId, skipped: true, charsBefore: 0, charsAfter: 0, rowsDeleted: 0, memoriesExtracted: 0 };
    }

    const totalChars = rows.reduce((sum, r) => sum + (r.content?.length || 0), 0);
    const totalRows = rows.length;

    if (totalChars <= CHAR_BUDGET && totalRows <= MAX_MESSAGES) {
      return { userId, skipped: true, charsBefore: totalChars, charsAfter: totalChars, rowsDeleted: 0, memoriesExtracted: 0 };
    }

    let runningTotal = totalChars;
    const toDelete: typeof rows = [];

    for (const row of rows) {
      if (runningTotal <= TRIM_TARGET) break;
      toDelete.push(row);
      runningTotal -= (row.content?.length || 0);
    }

    if (toDelete.length === 0) {
      return { userId, skipped: true, charsBefore: totalChars, charsAfter: totalChars, rowsDeleted: 0, memoriesExtracted: 0 };
    }

    let memoriesExtracted = 0;
    const memoriesToInsert: Array<{
      user_id: string;
      memory: string;
      emotion: string;
      importance: number;
      confidence: number;
    }> = [];

    for (let i = 0; i < toDelete.length; i++) {
      const row = toDelete[i];

      // Only archive user messages that carry meaningful content
      if (row.role !== 'user' || !shouldExtractMemory(row.content)) continue;

      // Include Nova's response as context — helps understand the full exchange
      const next = toDelete[i + 1];
      const novaContext = (next && next.role === 'assistant' && next.content.length > 10)
        ? ` | Nova responded: ${next.content.substring(0, 200)}${next.content.length > 200 ? '...' : ''}`
        : '';

      // Classify emotion and score importance based on content + emotion together
      const emotion = classifyEmotion(row.content + ' ' + (next?.content || ''));
      const importance = scoreImportance(row.content, emotion);

      // Skip very low importance messages entirely (pure chit-chat that adds noise)
      if (importance < 0.2) continue;

      const memoryText = `[Archived] User said: ${row.content.substring(0, 300)}${row.content.length > 300 ? '...' : ''}${novaContext}`;

      memoriesToInsert.push({
        user_id: userId,
        memory: memoryText,
        emotion,
        importance,
        confidence: importance >= 0.7 ? 0.9 : 0.75, // high-importance → higher confidence
      });
      memoriesExtracted++;
    }

    if (memoriesToInsert.length > 0) {
      // Sort by importance descending before inserting (helps DB query ordering)
      memoriesToInsert.sort((a, b) => b.importance - a.importance);

      const { error: memError } = await supabaseAdmin
        .from('short_term_memories')
        .insert(memoriesToInsert);
      if (memError) logger.error('[Pruning] Failed to insert memories', { userId, error: memError.message });

      // Log the distribution so you can monitor quality in server logs
      const highImportance = memoriesToInsert.filter(m => m.importance >= 0.75).length;
      const midImportance  = memoriesToInsert.filter(m => m.importance >= 0.5 && m.importance < 0.75).length;
      const lowImportance  = memoriesToInsert.filter(m => m.importance < 0.5).length;
      logger.info('[Pruning] Memory importance distribution', { userId, highImportance, midImportance, lowImportance });
    }

    const deleteIds = toDelete.map(r => r.id);
    let totalDeleted = 0;

    for (let i = 0; i < deleteIds.length; i += BATCH_SIZE) {
      const batch = deleteIds.slice(i, i + BATCH_SIZE);
      const { error: delError } = await supabaseAdmin
        .from('chat_history')
        .delete()
        .in('id', batch);
      if (delError) {
        logger.error('[Pruning] Batch delete failed', { userId, batch: i, error: delError.message });
      } else {
        totalDeleted += batch.length;
      }
    }

    const result: PruneResult = {
      userId, skipped: false,
      charsBefore: totalChars, charsAfter: runningTotal,
      rowsDeleted: totalDeleted, memoriesExtracted,
    };
    logger.info('[Pruning] Completed for user', result);
    return result;
  },

  async runAll(): Promise<void> {
    logger.info('[Pruning] Starting nightly run for all users');
    const { data: users, error } = await supabaseAdmin
      .from('chat_history')
      .select('user_id')
      .order('user_id');

    if (error || !users) {
      logger.error('[Pruning] Failed to get users list', { error: error?.message });
      return;
    }

    const uniqueUserIds = [...new Set(users.map(u => u.user_id))];
    logger.info(`[Pruning] Processing ${uniqueUserIds.length} users`);

    let totalDeleted = 0;
    let totalMemories = 0;

    for (const userId of uniqueUserIds) {
      try {
        const result = await this.pruneUser(userId);
        if (!result.skipped) {
          totalDeleted += result.rowsDeleted;
          totalMemories += result.memoriesExtracted;
        }
      } catch (err) {
        logger.error('[Pruning] Unexpected error for user', {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info('[Pruning] Nightly run complete', {
      usersProcessed: uniqueUserIds.length,
      totalRowsDeleted: totalDeleted,
      totalMemoriesExtracted: totalMemories,
    });
  },
};
