import { MemorySemanticResolver } from '../lib/MemorySemanticResolver';
import { canonicalizeKey, isKnownCanonicalKey } from '../lib/memoryKeySchema';

describe('MemorySemanticResolver & memoryKeySchema Invariants', () => {

  describe('Invariant 1: Canonical Base Identifiers', () => {
    it('should map favourite_colour to favourite_color', () => {
      const res = MemorySemanticResolver.resolveProposedKey('favourite_colour');
      expect(res.action).toBe('PERSIST');
      expect(res.canonicalKey).toBe('favourite_color');
    });

    it('should identify favourite_beverage as canonical', () => {
      expect(isKnownCanonicalKey('favourite_beverage')).toBe(true);
    });
  });

  describe('Invariant 2: Command Disentanglement', () => {
    it('should strip remember_this_my_ and map to favourite_beverage', () => {
      const res = MemorySemanticResolver.resolveProposedKey('remember_this_my_favourite_beverage');
      expect(res.action).toBe('PERSIST');
      expect(res.canonicalKey).toBe('favourite_beverage');
    });

    it('should strip remember_my_ and map to favourite_street_food', () => {
      const res = MemorySemanticResolver.resolveProposedKey('remember_my_favourite_street_food');
      expect(res.action).toBe('PERSIST');
      expect(res.canonicalKey).toBe('favourite_street_food');
    });
  });

  describe('Invariant 3: Strict Command Quarantine', () => {
    it('should quarantine malformed command keys that do not resolve to canonical', () => {
      const res = MemorySemanticResolver.resolveProposedKey('remember_this_my_favourite_snack');
      expect(res.action).toBe('QUARANTINE');
      expect(res.reason).toContain('Malformed command-derived key rejected');
    });

    it('should quarantine actually_my_brother_name if not canonicalized', () => {
      // Actually brother_name IS canonical, so this should resolve to brother_name
      const res = MemorySemanticResolver.resolveProposedKey('actually_my_brother_name');
      expect(res.action).toBe('PERSIST');
      expect(res.canonicalKey).toBe('brother_name');
    });
    
    it('should quarantine command without a known suffix', () => {
      const res = MemorySemanticResolver.resolveProposedKey('ek_correction_hai_my_car_model');
      expect(res.action).toBe('QUARANTINE');
      expect(res.reason).toContain('Malformed command-derived key rejected');
    });
  });

  describe('Invariant 4: Safe Pass-Through', () => {
    it('should pass through non-command unaliased keys unmodified', () => {
      const res = MemorySemanticResolver.resolveProposedKey('user_car_model');
      expect(res.action).toBe('PERSIST');
      expect(res.canonicalKey).toBe('user_car_model');
    });

    it('should pass through complex valid concepts', () => {
      const res = MemorySemanticResolver.resolveProposedKey('likes_wifes_cooking');
      expect(res.action).toBe('PERSIST');
      expect(res.canonicalKey).toBe('likes_wifes_cooking');
    });
  });

  describe('Invariant 5: Normalization Integrity', () => {
    it('should trim and lowercase keys', () => {
      const res = MemorySemanticResolver.resolveProposedKey('  Remember_MY_FaVourite_COlor  ');
      expect(res.action).toBe('PERSIST');
      expect(res.canonicalKey).toBe('favourite_color');
    });
  });

});
