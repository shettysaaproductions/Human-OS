import { watchtowerInspector } from '../WatchtowerInspector';

describe('WatchtowerInspector — Autonomous Quality & Coherence Inspector', () => {
  describe('Feminine First-Person Hindi Invariant', () => {
    it('repairs ungrammatical "Maine samajh gaya" and "main samajh gaya" to female "main samajh gayi"', () => {
      const input = 'Maine samajh gaya ki tumne sahi kaha tha.';
      const res = watchtowerInspector.inspectAndRepair(input);
      expect(res.cleanText).toContain('main samajh gayi');
      expect(res.cleanText).not.toContain('Maine samajh gaya');
      expect(res.hasGrammarError).toBe(true);
    });

    it('repairs male verbs like "wait karta hoon", "sochta hoon", "bolta hoon" to female equivalents', () => {
      const input = 'Main hamesha sochta hoon aur bolta hoon ki tu mast hai.';
      const res = watchtowerInspector.inspectAndRepair(input);
      expect(res.cleanText).toContain('sochti hoon');
      expect(res.cleanText).toContain('bolti hoon');
      expect(res.cleanText).not.toContain('sochta hoon');
      expect(res.cleanText).not.toContain('bolta hoon');
    });
  });

  describe('Awkward & Rude Phrasing Polish', () => {
    it('converts awkward "purn karna" to natural conversational "poora karna"', () => {
      const input = 'Yeh target toh 30th tak purn karna hai!';
      const res = watchtowerInspector.inspectAndRepair(input);
      expect(res.cleanText).toContain('poora karna hai');
      expect(res.cleanText).not.toContain('purn karna');
    });

    it('softens rude blunt phrases like "Ab kya chahiye? 😄"', () => {
      const input = 'Theek hai yaar. Ab kya chahiye? 😄';
      const res = watchtowerInspector.inspectAndRepair(input);
      expect(res.cleanText).not.toContain('Ab kya chahiye');
      expect(res.cleanText).toContain('Aur bata, sab theek chal raha hai?');
    });

    it('converts formal robotic "sakaratmak soch" to natural conversational phrasing', () => {
      const input = 'Aapki sakaratmak soch ke liye thanks.';
      const res = watchtowerInspector.inspectAndRepair(input);
      expect(res.cleanText).not.toContain('sakaratmak soch ke liye');
      expect(res.cleanText).toContain('positive mindset ke sath');
    });
  });

  describe('Work Context Coherence & Anti-Contradiction', () => {
    it('intercepts contradictory advice telling an office user "kuch mat karo" when working on a target', () => {
      const userMsg = 'Kuch nai cahiye yar abhi office me hoon, Mera target pura karna hi hai';
      const candidate = 'Arre yaar, tumhari office timing hai 11 se 8, toh tumhe abhi kuch nai karna chahiye! 😄';
      const res = watchtowerInspector.inspectAndRepair(candidate, userMsg);
      expect(res.isNonsensical).toBe(true);
      expect(res.cleanText).toContain('focus');
      expect(res.cleanText).toContain('target nipta lo');
      expect(res.cleanText).not.toContain('kuch nai karna chahiye');
    });

    it('corrects verbatim parroting of user sentence "Mera target pura karna hi hai"', () => {
      const userMsg = 'Mera target pura karna hi hai';
      const candidate = 'Mera target pura karna hi hai, yeh toh ho hi jayega.';
      const res = watchtowerInspector.inspectAndRepair(candidate, userMsg);
      expect(res.cleanText).toContain('Tera target toh time se pehle zaroor poora hoga');
      expect(res.cleanText).not.toContain('Mera target pura karna hi hai');
    });
  });

  describe('Anti-Meeting & Presence Hallucination Guard', () => {
    it('eliminates physical offline meeting hallucinations', () => {
      const candidate = 'Main aapko subah milne ke liye wait karta hoon.';
      const res = watchtowerInspector.inspectAndRepair(candidate);
      expect(res.hasHallucination).toBe(true);
      expect(res.cleanText).not.toContain('milne ke liye wait karta hoon');
      expect(res.cleanText).toContain('subah baat karte hain');
    });
  });

  describe('Sentence Deduplication', () => {
    it('deduplicates identical repeated sentences in the candidate text', () => {
      const candidate = 'Maine socha hai ki tumne sahi kaha tha. Maine socha hai ki tumne sahi kaha tha.';
      const res = watchtowerInspector.inspectAndRepair(candidate);
      const matches = res.cleanText.match(/Maine socha hai ki tumne sahi kaha tha/g) || [];
      expect(matches.length).toBeLessThanOrEqual(1);
    });
  });

  describe('Ungrounded Birthday Hallucination on Unrelated Work Topic', () => {
    it('intercepts unprompted Tiku birthday speech when user is discussing office targets', () => {
      const userMsg = 'Abhi office me hoon target pura karna hai';
      const candidate = 'Tiku ka birthday 17 February 2026 ko hai aur kal subah uska birthday manana tha.';
      const res = watchtowerInspector.inspectAndRepair(candidate, userMsg);
      expect(res.hasHallucination).toBe(true);
      expect(res.cleanText).not.toContain('17 February 2026');
      expect(res.cleanText).toContain('target nipta le');
    });
  });
});
