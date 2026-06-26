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
  companion_personality: string;
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
      const seedMemories: ExtractedMemory[] = [
        {
          type: 'preference',
          key: 'preferred_name',
          value: `Prefers to be called ${answers.preferred_name}.`,
          shouldPersist: true,
          importance: 10,
          confidence: 1.0
        },
        {
          type: 'interest',
          key: 'passions_and_interests',
          value: answers.passions,
          shouldPersist: true,
          importance: 10,
          confidence: 1.0
        },
        {
          type: 'goal',
          key: 'current_goals',
          value: answers.goals,
          shouldPersist: true,
          importance: 10,
          confidence: 1.0
        },
        {
          type: 'relationship',
          key: 'family_and_relationships',
          value: answers.family,
          shouldPersist: true,
          importance: 10,
          confidence: 1.0
        },
        {
          type: 'fact',
          key: 'important_facts',
          value: answers.important_facts,
          shouldPersist: true,
          importance: 10,
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

      // Direct update to ensure these are locked at importance 10
      await supabaseAdmin
        .from('memories')
        .update({ importance: 10, confidence: 1.0, is_user_confirmed: true })
        .eq('user_id', userId)
        .eq('source_message', 'onboarding_seed');

      logger.info('Onboarding processed successfully', { userId });
    } catch (error) {
      logger.error('Error processing onboarding', { userId, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
}

export const onboardingService = new OnboardingService();
