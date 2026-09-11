import { extractKeywords, CONCEPT_SYNONYM_EXPANSIONS } from '../utils/nlp';
import { MessageFormatter } from '../services/MessageFormatter';
import { sanitizeReply } from '../services/NovaBrainService';

describe('Chat Ingress, Formatting & Concept Expansion Integrity', () => {
  describe('Hinglish-to-English Concept Expansion in extractKeywords', () => {
    it('expands biwi/patni to wife', () => {
      const keywords = extractKeywords('meri biwi ka birthday kab hai');
      expect(keywords).toContain('biwi');
      expect(keywords).toContain('birthday');
      expect(keywords).toContain('wife');
    });

    it('expands beta/bete to son and child', () => {
      const keywords = extractKeywords('mere bete ka naam yaad hai');
      expect(keywords).toContain('bete');
      expect(keywords).toContain('son');
      expect(keywords).toContain('child');
    });

    it('expands maa/mummy to mother and mom', () => {
      const keywords = extractKeywords('meri mummy ka phone number');
      expect(keywords).toContain('mummy');
      expect(keywords).toContain('mother');
      expect(keywords).toContain('mom');
    });

    it('expands naukri/kaam to job/work', () => {
      const keywords = extractKeywords('meri naukri ke baare mein');
      expect(keywords).toContain('naukri');
      expect(keywords).toContain('job');
      expect(keywords).toContain('work');
    });

    it('expands kasrat to workout/gym', () => {
      const keywords = extractKeywords('aaj kasrat karni hai');
      expect(keywords).toContain('kasrat');
      expect(keywords).toContain('workout');
      expect(keywords).toContain('gym');
    });
  });

  describe('MessageFormatter.addEmoji Code & Table Protection', () => {
    it('does not inject emoji into code blocks', () => {
      const code = '```python\ndef get_user(id):\n    return db.query("SELECT * FROM users WHERE id = ?", id)\n```';
      const formatted = MessageFormatter.addEmoji(code, 'joy');
      expect(formatted).toBe(code);
    });

    it('does not inject emoji into markdown tables', () => {
      const table = '| Exercise | Sets | Reps |\n| --- | --- | --- |\n| Bench Press | 3 | 10 |';
      const formatted = MessageFormatter.addEmoji(table, 'motivation');
      expect(formatted).toBe(table);
    });

    it('does not corrupt URLs with query parameters', () => {
      const urlMsg = 'Check out this link: https://example.com/search?q=fitness&page=1 for more details!';
      const formatted = MessageFormatter.addEmoji(urlMsg, 'excitement');
      expect(formatted).toBe(urlMsg);
    });
  });

  describe('NovaBrainService sanitizeReply List Preservation', () => {
    it('preserves multi-item workout plans without truncating to 1 sentence', () => {
      const workoutPlan = 'Here is your leg day routine:\n1. Barbell Squats: 3 sets of 8 reps\n2. Romanian Deadlifts: 3 sets of 10 reps\n3. Walking Lunges: 3 sets of 12 reps\n4. Standing Calf Raises: 4 sets of 15 reps\nGo crush it!';
      const sanitized = sanitizeReply(workoutPlan);
      expect(sanitized).toContain('Barbell Squats');
      expect(sanitized).toContain('Romanian Deadlifts');
      expect(sanitized).toContain('Walking Lunges');
      expect(sanitized).toContain('Standing Calf Raises');
    });

    it('preserves multi-item study steps without truncating to 1 sentence', () => {
      const studyPlan = 'Follow these steps for exam prep:\n1. Review lecture notes\n2. Solve 3 past papers\n3. Practice formula derivations\n4. Take a 15-minute break';
      const sanitized = sanitizeReply(studyPlan);
      expect(sanitized).toContain('Review lecture notes');
      expect(sanitized).toContain('Solve 3 past papers');
      expect(sanitized).toContain('Practice formula derivations');
    });

    it('cleans out hallucinated multiple-choice options (A) B) C) D)', () => {
      const quizReply = 'What do you want to talk about next?\nA) Workout routine\nB) Career goals\nC) Weekend plans\nD) Nothing';
      const sanitized = sanitizeReply(quizReply);
      expect(sanitized).toContain('What do you want to talk about next?');
      expect(sanitized).not.toContain('A) Workout routine');
      expect(sanitized).not.toContain('D) Nothing');
    });
  });
});
