import { classifyIntent, synthesizeContextualOptions } from '../ResponseIntelligence';

describe('ResponseIntelligence', () => {
  describe('synthesizeContextualOptions', () => {
    it('synthesizes study-oriented quick reply options for academic queries in Hindi and English', () => {
      const optionsHi = synthesizeContextualOptions({
        message: 'Exam ki taiyari shuru karni hai',
        replyText: 'Main help karti hu, syllabus dekhte hain.',
        language: 'hi'
      });
      expect(optionsHi).toContain('Daily study plan bana do');
      expect(optionsHi.length).toBeGreaterThanOrEqual(2);

      const optionsEn = synthesizeContextualOptions({
        message: 'I need to prepare for my semester exam',
        replyText: 'I can help you make a solid study plan.',
        language: 'en'
      });
      expect(optionsEn).toContain('Make a daily study plan');
      expect(optionsEn.length).toBeGreaterThanOrEqual(2);
    });

    it('synthesizes reminder and task options when task intent is detected', () => {
      const optionsEn = synthesizeContextualOptions({
        message: 'Remind me to call the dentist tomorrow',
        replyText: 'Sure, I will remind you.',
        language: 'en'
      });
      expect(optionsEn).toContain('When should I remind you?');
      expect(optionsEn).toContain('Show my tasks');

      const optionsHi = synthesizeContextualOptions({
        message: 'Kal subah call karna yaad dilana',
        replyText: 'Main reminder set kar deti hu.',
        language: 'hi'
      });
      expect(optionsHi).toContain('Kab remind karu?');
      expect(optionsHi).toContain('Show my tasks');
    });

    it('synthesizes fitness and routine options for workout queries', () => {
      const optionsEn = synthesizeContextualOptions({
        message: 'Just hit the gym, did leg day today',
        replyText: 'Great work! Rest well.',
        language: 'en'
      });
      expect(optionsEn).toContain('Log this workout');
      expect(optionsEn).toContain('Remind me to hydrate');
    });

    it('synthesizes conversational progression when questions are present', () => {
      const optionsEn = synthesizeContextualOptions({
        message: 'What do you think about that?',
        replyText: 'It sounds like a promising idea!',
        language: 'en'
      });
      expect(optionsEn).toContain('Yes, definitely');
      expect(optionsEn).toContain('Tell me more');
    });
  });

  describe('classifyIntent', () => {
    it('classifies casual short messages as HUMAN_CHAT with low token cap', () => {
      const config = classifyIntent('theek hai');
      expect(config.mode).toBe('HUMAN_CHAT');
      expect(config.maxTokens).toBe(300);
      expect(config.shouldOfferTable).toBe(false);
    });

    it('classifies explain requests as LONG_CONTEXT with table offer', () => {
      const config = classifyIntent('Explain the difference between SQL and NoSQL in detail');
      expect(config.mode).toBe('LONG_CONTEXT');
      expect(config.shouldOfferTable).toBe(true);
    });
  });
});
