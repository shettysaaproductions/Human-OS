import { UniversalBranchRelocationService } from '../UniversalBranchRelocationService';

describe('UniversalBranchRelocationService', () => {
  const service = new UniversalBranchRelocationService();

  test('never guesses a hard-coded entity for an unnamed character revelation', () => {
    const result = service.detectRelocationIntentSync(
      'the one i was talking about was not my friend, he was my character for a short film project',
      []
    );
    expect(result).toBeNull();
  });

  test('recognizes an explicit fictional-character reclassification', () => {
    const result = service.detectRelocationIntentSync(
      'Ramesh was not my friend, he was a character in my short film project'
    );
    expect(result?.entityName).toBe('Ramesh');
    expect(result?.isFictionalOrCharacter).toBe(true);
    expect(result?.newDomain).toBe('work');
    expect(result?.newRelation).toBe('Short Film Character');
  });

  test('recognizes pet reclassification without changing anything yet', () => {
    const result = service.detectRelocationIntentSync(
      'Simba is not a person, he is my pet dog'
    );
    expect(result?.entityName).toBe('Simba');
    expect(result?.isPetRevelation).toBe(true);
    expect(result?.newRelation).toBe('Pet Dog');
  });

  test('supports natural-language move targets', () => {
    const result = service.detectRelocationIntentSync(
      'move Ramesh from family to my short film project'
    );
    expect(result?.entityName).toBe('Ramesh');
    expect(result?.newDomain).toBe('work');
    expect(result?.targetParentLabel).toBe('my short film project');
  });

  test('requires a tight confirmation response', () => {
    expect(service.isAffirmativeResponse('haan')).toBe(true);
    expect(service.isAffirmativeResponse('haan, but I am not sure')).toBe(false);
    expect(service.isNegativeResponse('nahi')).toBe(true);
    expect(service.isNegativeResponse('nahi, actually move it later')).toBe(false);
  });
});
