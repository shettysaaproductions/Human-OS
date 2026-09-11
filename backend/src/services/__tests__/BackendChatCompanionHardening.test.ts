import { sanitizeReply, isPromptLeak, validateAndRepairGrounding, NOVA_EMPTY_REPLY } from '../NovaBrainService';
import { reminderIntentDetector } from '../ReminderIntentDetector';

describe('BackendChatCompanionHardening — Autonomous Living Companion Invariants', () => {
  describe('1. Degraded Mode & Leak Fallbacks', () => {
    it('detects prompt instruction leaks emitted by small/fallback models', () => {
      expect(isPromptLeak('No Formalities: Use "tu/tum/"')).toBe(true);
      expect(isPromptLeak('*No Formalities: Use "tu/tum/"*')).toBe(true);
      expect(isPromptLeak('Use casual "tu/tum", never formal "Aap". Plain conversational text only.')).toBe(true);
      expect(isPromptLeak('Output ONLY spoken conversational dialogue.')).toBe(true);
      expect(isPromptLeak('Reply in 1-2 SHORT sentences.')).toBe(true);
      expect(isPromptLeak('Nova is female: use "Main samajh gayi"')).toBe(true);
    });

    it('sanitizeReply completely suppresses prompt leaks', () => {
      expect(sanitizeReply('No Formalities: Use "tu/tum/"')).toBe('');
      expect(sanitizeReply('Use casual "tu/tum", never formal "Aap". Plain conversational text only.')).toBe('');
    });

    it('cleans multiline swipe-to-reply tag echoes without breaking dialogue', () => {
      const input = '[Replying to: "Usne ye sab khud se sekha\nno course but beautiful art"]\nSakshi ne sach mein kamaal kiya hai!';
      expect(sanitizeReply(input)).toBe('Sakshi ne sach mein kamaal kiya hai!');
    });
  });

  describe('2. Temporal "Kal" Future Reminder vs Past Hallucination', () => {
    it('detects future reminder intent for tomorrow when user says "Kal muje afternoon me 1 bJe yaad dilao na"', () => {
      const userMsg = 'Kal muje afternoon me 1 bJe yaad dilao na PF ke lie bank details update karna hai';
      const parsed = reminderIntentDetector.parseReminderDetails(userMsg);
      expect(parsed.triggerAt).not.toBeNull();
      expect(parsed.formattedTime).toContain('Tomorrow');
    });

    it('repairs LLM hallucination asserting user already gave the reminder in the past', () => {
      const hallucinated = 'Acha, toh tumne kal afternoon mein bank details update karne ka reminder diya tha!';
      const userMsg = 'Kal muje afternoon me 1 bJe yaad dilao na PF ke lie bank details update karna hai';
      const repaired = validateAndRepairGrounding(hallucinated, userMsg, {});
      expect(repaired).toContain('Samajh gayi! Main kal 1 bJe pe tumhe yaad dila dungi');
      expect(repaired).not.toContain('reminder diya tha');
    });

    it('repairs correction turn when user clarifies "Diya tha nai muje kal sube remind karo"', () => {
      const hallucinated = 'tumne mujhe kal subah reminder diya tha... abhi main tumhare reminder ko yaad kar raha hoon';
      const userMsg = 'Diya tha nai muje kal sube remind karo yaad se';
      const repaired = validateAndRepairGrounding(hallucinated, userMsg, {});
      expect(repaired).toContain('Samajh gayi! Main kal sube pe tumhe yaad dila dungi');
    });
  });

  describe('3. Circadian Sanity & Midnight Chores Ban', () => {
    it('repairs midnight cooking suggestion at 12:20 AM into wind-down rest', () => {
      const hallucinated = 'Arey sun, kal sube khana banane ka plan tha na? Abhi free hai toh start kar de!';
      const userMsg = 'Abhi raat ke 12:19 hue hai, ye koi exercise karne ka time thodi na hai';
      const repaired = validateAndRepairGrounding(hallucinated, userMsg, {});
      expect(repaired).toContain('Abhi raat ko aaram kar aur so ja!');
      expect(repaired).not.toContain('start kar de');
    });
  });

  describe('4. Entity Attribution & Plausibility (Adult Wife vs 6-Month Infant)', () => {
    it('repairs attribution of self-taught nail art from baby son Shreshth to wife Sakshi', () => {
      const hallucinated = 'Shreshth khud se seekhne ke liye bahut jaldi uth raha hai, aur apni kalaa ko badhane ke liye kitne mehnat karta hai';
      const userMsg = 'Usne ye sab khud se sekha no course but beautiful art';
      const repaired = validateAndRepairGrounding(hallucinated, userMsg, {});
      expect(repaired).toContain('Sakshi ne bina kisi course ke khud se itna sundar nail art seekh liya?');
      expect(repaired).not.toContain('Shreshth');
    });
  });

  describe('5. 1-Word Habit Dead Nod Transformation', () => {
    it('transforms dead nod "Sahi" into proactive companion habit offer', () => {
      const deadReply = 'Sahi';
      const userMsg = 'Sube muje roz workout start karna hai 8 baje uth ke';
      const repaired = validateAndRepairGrounding(deadReply, userMsg, {});
      expect(repaired).toContain('Mast plan hai yaar! 💪');
      expect(repaired).toContain('workout reminder set kar doon');
    });
  });

  describe('6. Female Hinglish Grammatical Gender Agreement', () => {
    it('enforces feminine verb conjugations for Nova', () => {
      expect(sanitizeReply('abhi main tumhare reminder ko yaad kar raha hoon')).toBe('abhi main tumhare reminder ko yaad kar rahi hoon');
      expect(sanitizeReply('main kal subah reminder karunga')).toBe('main kal subah remind karungi');
      expect(sanitizeReply('main samajh mein aata hoon')).toBe('main samajh gayi');
      expect(sanitizeReply('main kal subah bataunga')).toBe('main kal subah bataungi');
      expect(sanitizeReply('main dilaunga')).toBe('main dilaungi');
    });
  });
});
