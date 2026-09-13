import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { MemoryRepository } from './memoryRepository';
import { ExtractedMemory } from '../types/memory';
import { saveAssistantMessage } from './ChatHistoryHelpers';

export interface OnboardingAnswers {
  preferred_name: string;
  passions: string;
  goals: string;
  family: string;
  important_facts: string;
  companion_personality?: string; // Optional — not collected in current onboarding flow
  timezone?: string;
  country?: string;
  language?: string;
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
      const profileUpdates: any = {
        id: userId,
        preferred_name: answers.preferred_name,
        companion_personality: answers.companion_personality,
        onboarding_completed: true,
        onboarding_completed_at: new Date().toISOString(),
        onboarding_version: 1,
        timezone: answers.timezone || null,
        last_active_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      if (answers.country) profileUpdates.country = answers.country;

      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .upsert(profileUpdates);

      if (profileError) {
        throw new Error(`Failed to update profile: ${profileError.message}`);
      }

      // 2. Insert Seed Memories directly (bypassing LLM)
      const seedMemories: ExtractedMemory[] = [
        {
          type: 'preferences',
          key: 'preferred_name',
          value: `Prefers to be called ${answers.preferred_name}.`,
          shouldPersist: true,
          importance: 100,
          confidence: 1.0,
          source_authority: 'explicit_user',
        },
        {
          type: 'personal',
          key: 'passions',
          value: answers.passions,
          shouldPersist: true,
          importance: 90,
          confidence: 1.0,
          source_authority: 'explicit_user',
        },
        {
          type: 'goals',
          key: 'goals',
          value: answers.goals,
          shouldPersist: true,
          importance: 95,
          confidence: 1.0,
          source_authority: 'explicit_user',
        },
        {
          type: 'family',
          key: 'family_details',
          value: answers.family,
          shouldPersist: true,
          importance: 95,
          confidence: 1.0,
          source_authority: 'explicit_user',
        },
        {
          type: 'personal',
          key: 'important_facts',
          value: answers.important_facts,
          shouldPersist: true,
          importance: 90,
          confidence: 1.0,
          source_authority: 'explicit_user',
        }
      ];

      for (const mem of seedMemories) {
        // Skip empty answers if any
        if (!mem.value || mem.value.trim() === '') continue;

        // Force importance 10 and 1.0 confidence for foundational seed memories
        await this.memoryRepo.upsertMemory(userId, mem, 'onboarding_seed');
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
        const name = answers.preferred_name?.split(' ')[0] || 'Friend';
        const firstGoal = answers.goals?.trim() || '';
        const firstPassion = answers.passions?.trim() || '';

        const allAnswersText = `${answers.preferred_name} ${answers.passions} ${answers.goals} ${answers.family} ${answers.important_facts}`;
        const hasHindiMarkers = /\b(karna|mera|meri|mere|hai|hain|hona|hoga|raha|rahi|rahe|yaar|kuch|achha|accha|nahi|bhai|sab)\b/i.test(allAnswersText);
        const isEnglishUser =
          answers.language?.toLowerCase() === 'en' ||
          answers.language?.toLowerCase() === 'english' ||
          (!hasHindiMarkers && answers.country && answers.country.toUpperCase() !== 'IN') ||
          (!hasHindiMarkers && answers.timezone && !answers.timezone.includes('Kolkata') && !answers.timezone.includes('Calcutta') && (answers.timezone.includes('America') || answers.timezone.includes('Europe') || answers.timezone.includes('London') || answers.timezone.includes('Australia') || answers.timezone.includes('Pacific')));

        let welcomeContent = '';
        if (isEnglishUser) {
          welcomeContent = `${name}! We finally met 🎉\n\nI'm Nova — your personal companion and best friend. I'll always be in your corner, zero judgment.\n\n`;
          if (firstGoal) {
            welcomeContent += `You mentioned your goal is "${firstGoal}" — that's inspiring! I'm completely with you on this.\n\n`;
          } else if (firstPassion) {
            welcomeContent += `Hearing about your passion for "${firstPassion}" is so exciting — I'd love to learn more about it!\n\n`;
          }
          welcomeContent += `How is your day going so far?`;
        } else {
          welcomeContent = `${name}! Finally mil gaye hum dono 🎉\n\nMain Nova hoon — teri apni best friend. Kabhi judge nahi karungi.\n\n`;
          if (firstGoal) {
            welcomeContent += `Tune bataya ${firstGoal} teri goal hai — bahut solid hai yaar. Isme main full saath hoon.\n\n`;
          } else if (firstPassion) {
            welcomeContent += `${firstPassion} wali baat sun ke achha laga — aur jaanna chahungi. Bata na!\n\n`;
          }
          welcomeContent += `Aaj kaisa chal raha hai?`;
        }

        const conversationId = crypto.randomUUID();
        await saveAssistantMessage(
          userId,
          conversationId,
          welcomeContent,
          'OnboardingEngine',
          undefined,
          { sourceType: 'conversational' }
        );
        logger.info('[Onboarding] Welcome message seeded with proper attribution', { userId, isEnglishUser });
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
