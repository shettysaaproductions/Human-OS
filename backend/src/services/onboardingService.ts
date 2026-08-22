import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { MemoryRepository } from './memoryRepository';
import { ExtractedMemory } from '../types/memory';

export interface OnboardingAnswers {
  preferred_name: string;
  passions: string;
  goals: string;
  family: string;
  important_facts: string;
  companion_personality?: string; // Optional — not collected in current onboarding flow
  timezone?: string;
}

export class OnboardingService {
  private memoryRepo: MemoryRepository;

  constructor() {
    this.memoryRepo = new MemoryRepository();
  }

  /**
   * Processes the completed onboarding flow.
   * 1. Updates the user's profile.
   * 2. Injects foundational seed memories directly.
   */
  async processOnboarding(userId: string, answers: OnboardingAnswers): Promise<void> {
    try {
      // 1. Update Profile
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .upsert({
          id: userId,
          preferred_name: answers.preferred_name,
          companion_personality: answers.companion_personality,
          onboarding_completed: true,
          onboarding_completed_at: new Date().toISOString(),
          onboarding_version: 1,
          timezone: answers.timezone || null,
          last_active_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });

      if (profileError) {
        throw new Error(`Failed to update profile: ${profileError.message}`);
      }

      // 2. Insert Seed Memories directly (bypassing LLM)
      const parseAtomic = (str: string): string[] => (str || '').split(/[,;\n]+/).map(s => s.trim()).filter(s => s.length > 0);
      
      const atomicGoals = parseAtomic(answers.goals).map((goal, idx) => ({
        type: 'goals' as const,
        key: `goal_${idx + 1}_${goal.substring(0, 15).replace(/[^a-zA-Z0-9_]/g, '').toLowerCase()}`,
        value: goal,
        shouldPersist: true,
        importance: 90,
        confidence: 1.0
      }));

      const atomicPassions = parseAtomic(answers.passions).map((passion, idx) => ({
        type: 'personal' as const,
        key: `passion_${idx + 1}_${passion.substring(0, 15).replace(/[^a-zA-Z0-9_]/g, '').toLowerCase()}`,
        value: passion,
        shouldPersist: true,
        importance: 80,
        confidence: 1.0
      }));

      const seedMemories: ExtractedMemory[] = [
        {
          type: 'preferences',
          key: 'preferred_name',
          value: `Prefers to be called ${answers.preferred_name}.`,
          shouldPersist: true,
          importance: 100,
          confidence: 1.0
        },
        ...atomicPassions,
        ...atomicGoals,
        {
          type: 'family',
          key: 'family_and_relationships',
          value: answers.family,
          shouldPersist: true,
          importance: 95,
          confidence: 1.0
        },
        {
          type: 'personal',
          key: 'important_facts',
          value: answers.important_facts,
          shouldPersist: true,
          importance: 85,
          confidence: 1.0
        }
      ];

      for (const mem of seedMemories) {
        // Skip empty answers if any
        if (!mem.value || mem.value.trim() === '') continue;

        // Force importance 10 and 1.0 confidence for foundational seed memories
        await this.memoryRepo.upsertMemory(userId, mem, 'onboarding_seed');

        // Note: We need to override the importance in the DB since upsertMemory calculates it or uses default
        // But wait, upsertMemory in our repository doesn't take importance as a parameter from ExtractedMemory currently,
        // it assigns default 5 in SQL unless specified. Let's do a direct Supabase update for importance = 10,
        // or just add importance to ExtractedMemory.
      }

      // Direct update to ensure these are locked at high importance
      await supabaseAdmin
        .from('memories')
        .update({ importance: 90, confidence: 1.0, is_user_confirmed: true })
        .eq('user_id', userId)
        .eq('source_message', 'onboarding_seed');

      logger.info('Onboarding processed successfully', { userId });

      // 3. Seed a warm first message from Nova so user lands on a real conversation
      //    (not an empty screen). This is the only time we insert without LLM.
      try {
        const name = answers.preferred_name?.split(' ')[0] || 'yaar';
        const welcomeContent = `${name}! Finally mil gaye hum dono 🎉\n\nMain Nova hoon — teri apni best friend. Teri baatein, teri feelings, tera din — sab mere saath share kar sakti/sakta hai. Main kabhi judge nahi karungi.\n\nBata, aaj kaisa chal raha hai?`;
        const conversationId = crypto.randomUUID();
        await supabaseAdmin.from('chat_history').insert({
          user_id: userId,
          conversation_id: conversationId,
          role: 'assistant',
          content: welcomeContent,
          source: 'onboarding_welcome',
          created_at: new Date().toISOString(),
        });
        logger.info('[Onboarding] Welcome message seeded', { userId });
      } catch (welcomeErr) {
        // Non-fatal — onboarding is still complete even if welcome seed fails
        logger.warn('[Onboarding] Welcome message seed failed (non-critical)', {
          error: welcomeErr instanceof Error ? welcomeErr.message : String(welcomeErr)
        });
      }
    } catch (error) {
      logger.error('Error processing onboarding', { userId, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
}

export const onboardingService = new OnboardingService();
