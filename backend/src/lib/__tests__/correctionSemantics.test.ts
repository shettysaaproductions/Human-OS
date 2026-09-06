import {
  isValueDerivedKey,
  isValueGroundedInSource,
  selectAuthoritativeCorrections,
  validateSemanticCorrection,
} from '../correctionSemantics';

describe('correctionSemantics validation', () => {
  const productionSentence = 'Ek correction hai mera favourite color green hai ab';

  it('classifies the production sentence as a correction without requiring a value-derived key', () => {
    const { TurnAnalyzer } = require('../../services/TurnAnalyzer');
    const analysis = TurnAnalyzer.analyze([{
      role: 'user',
      message: productionSentence,
      created_at: new Date().toISOString(),
    }]);
    expect(analysis.hasCorrections).toBe(true);
  });

  it('accepts favourite_color / green from the production sentence meaning', () => {
    const validated = validateSemanticCorrection(
      { key: 'favourite color', value: 'green', shouldPersist: true },
      productionSentence
    );
    expect(validated).toEqual({ key: 'favourite_color', value: 'green' });
  });

  it('requires the LLM to explicitly mark a correction as persistable', () => {
    expect(validateSemanticCorrection(
      { key: 'favourite_color', value: 'green', shouldPersist: false },
      productionSentence
    )).toBeNull();
    expect(validateSemanticCorrection(
      { key: 'favourite_color', value: 'green' },
      productionSentence
    )).toBeNull();
  });

  it('never persists a value-derived key such as favourite_color_green', () => {
    expect(isValueDerivedKey('favourite_color_green', 'green')).toBe(true);
    expect(isValueDerivedKey('favourite_color_blue', 'blue')).toBe(true);
    expect(isValueDerivedKey('favourite_color_red', 'red')).toBe(true);
    expect(isValueDerivedKey('favourite_color', 'green')).toBe(false);

    expect(validateSemanticCorrection(
      { key: 'favourite_color_green', value: 'ab', shouldPersist: true },
      productionSentence
    )).toBeNull();

    expect(validateSemanticCorrection(
      { key: 'favourite_color_green', value: 'green', shouldPersist: true },
      productionSentence
    )).toBeNull();
  });

  it('rejects values not grounded in the source message', () => {
    expect(isValueGroundedInSource('purple', productionSentence)).toBe(false);
    expect(validateSemanticCorrection(
      { key: 'favourite_color', value: 'purple', shouldPersist: true },
      productionSentence
    )).toBeNull();
  });

  it('rejects invented / unknown targets', () => {
    expect(validateSemanticCorrection(
      { key: 'spaceship_model', value: 'green', shouldPersist: true },
      productionSentence
    )).toBeNull();
  });

  it('fails closed on missing target or value', () => {
    expect(validateSemanticCorrection({ key: 'favourite_color', value: '', shouldPersist: true }, productionSentence)).toBeNull();
    expect(validateSemanticCorrection({ key: '', value: 'green', shouldPersist: true }, productionSentence)).toBeNull();
    expect(validateSemanticCorrection(null, productionSentence)).toBeNull();
  });

  it.each([
    ['Mera favourite color green hai ab', 'green'],
    ['Actually mera favourite color blue hai', 'blue'],
    ['Ek correction hai mera favourite colour red hai abhi', 'red'],
    ['Correction: mera favourite color green hai', 'green'],
    ['Ab mera favourite color green hai', 'green'],
    ['Mera favourite colour ab green hai', 'green'],
    ['Mera favourite color green hi hai', 'green'],
  ])('resolves semantic value from sentence: %s', (source, expectedValue) => {
    const validated = validateSemanticCorrection(
      { key: 'favourite_color', value: expectedValue, shouldPersist: true },
      source
    );
    expect(validated).toEqual({ key: 'favourite_color', value: expectedValue });
    expect(validated?.key).not.toMatch(/favourite_color_(green|blue|red)$/);
  });

  it('Make that blue is fail-closed without contextual concept evidence', () => {
    const validated = validateSemanticCorrection(
      { key: 'favourite_color', value: 'blue', shouldPersist: true },
      'Make that blue'
    );
    expect(validated).toBeNull();
  });

  it('Make that blue can resolve when context grounds the concept', () => {
    const validated = validateSemanticCorrection(
      { key: 'favourite_color', value: 'blue', shouldPersist: true },
      'Make that blue',
      'My favourite color is red'
    );
    expect(validated).toEqual({ key: 'favourite_color', value: 'blue' });
  });

  it('persists ALL distinct valid corrections from one turn independently', () => {
    // THE FIX: two clear corrections → both should be saved, not dropped
    const selected = selectAuthoritativeCorrections(
      [
        { key: 'favourite_color', value: 'green', shouldPersist: true },
        { key: 'brother_name', value: 'Amit', shouldPersist: true },
      ],
      'My favourite color is green and my brother name is Amit'
    );
    // Both corrections are clear, grounded, and attributed — both must persist
    expect(selected).toHaveLength(2);
    const keys = selected.map((s: any) => s.key);
    expect(keys).toContain('favourite_color');
    expect(keys).toContain('brother_name');
    expect(selected.every((s: any) => s.correction_intent === true)).toBe(true);
  });

  it('still rejects corrections where value is not grounded in source', () => {
    // purple is NOT in the source — should be rejected even in multi-field context
    const selected = selectAuthoritativeCorrections(
      [
        { key: 'favourite_color', value: 'green', shouldPersist: true },
        { key: 'favourite_color', value: 'purple', shouldPersist: true }, // NOT in source
      ],
      productionSentence // contains 'green', not 'purple'
    );
    // Only green is grounded — purple rejected, green persists
    expect(selected).toHaveLength(1);
    expect(selected[0].value).toBe('green');
  });

  it('deduplicates identical valid corrections deterministically', () => {
    const selected = selectAuthoritativeCorrections(
      [
        { key: 'favourite_color', value: 'green', shouldPersist: true },
        { key: 'favourite_color', value: 'GREEN', shouldPersist: true },
      ],
      productionSentence
    );
    expect(selected).toHaveLength(1);
    expect(selected[0].key).toBe('favourite_color');
    expect(selected[0].value).toBe('green');
  });

  it('ignores malformed candidates but persists exactly one valid candidate', () => {
    const selected = selectAuthoritativeCorrections(
      [
        { key: 'favourite_color_green', value: 'ab', shouldPersist: true },
        { key: 'favourite_color', value: 'green', shouldPersist: true },
      ],
      productionSentence
    );
    expect(selected).toHaveLength(1);
    expect(selected[0].key).toBe('favourite_color');
    expect(selected[0].value).toBe('green');
    expect(selected[0].correction_intent).toBe(true);
  });

  it('Hinglish multi-field: wife + son corrections both persist', () => {
    const source = 'Actually meri wife Sakshi hai nahi Priya, aur my son Shreshth hai not Aryan';
    const selected = selectAuthoritativeCorrections(
      [
        { key: 'wife_name', value: 'Sakshi', shouldPersist: true },
        { key: 'son_name', value: 'Shreshth', shouldPersist: true },
      ],
      source
    );
    expect(selected).toHaveLength(2);
    const keys = selected.map((s: any) => s.key);
    expect(keys).toContain('wife_name');
    expect(keys).toContain('son_name');
  });

  it('returns empty array when NO corrections pass validation', () => {
    const selected = selectAuthoritativeCorrections(
      [
        { key: 'spaceship_model', value: 'green', shouldPersist: true }, // unknown key
        { key: 'favourite_color', value: 'purple', shouldPersist: true }, // not in source
      ],
      productionSentence
    );
    expect(selected).toHaveLength(0);
  });
});
