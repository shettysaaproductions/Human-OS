import { inferSemanticEntityType } from '../entitySemanticValidator';

describe('inferSemanticEntityType', () => {
  it('correctly classifies pets and dog breeds', () => {
    expect(inferSemanticEntityType('Rottweiler', 'family')).toBe('pet');
    expect(inferSemanticEntityType('Labrador', 'lifestyle')).toBe('pet');
    expect(inferSemanticEntityType('Bruno', 'family', 'pet dog')).toBe('pet');
    expect(inferSemanticEntityType('Simba', 'family', 'cat')).toBe('pet');
    expect(inferSemanticEntityType('Golden Retriever')).toBe('pet');
  });

  it('correctly classifies cultural events and celebrations', () => {
    expect(inferSemanticEntityType('Ganpati Celebrations', 'lifestyle')).toBe('event');
    expect(inferSemanticEntityType('Diwali Party', 'lifestyle')).toBe('event');
    expect(inferSemanticEntityType('Birthday Celebration', 'family')).toBe('event');
    expect(inferSemanticEntityType('Ganesh Chaturthi', 'lifestyle')).toBe('event');
  });

  it('correctly classifies relational roles, attributes, and fragments', () => {
    expect(inferSemanticEntityType('Smoking Partner', 'lifestyle')).toBe('role');
    expect(inferSemanticEntityType('Since College', 'lifestyle')).toBe('concept');
    expect(inferSemanticEntityType('Name Not Specified', 'lifestyle')).toBe('concept');
    expect(inferSemanticEntityType('Friend', 'lifestyle')).toBe('role');
    expect(inferSemanticEntityType('Hr', 'family')).toBe('role');
  });

  it('correctly classifies organizations and companies', () => {
    expect(inferSemanticEntityType('Conviction HR Ltd', 'work')).toBe('organization');
    expect(inferSemanticEntityType('Google LLC', 'work')).toBe('organization');
    expect(inferSemanticEntityType('Shetty Productions', 'work')).toBe('organization');
  });

  it('correctly defaults genuine people to person', () => {
    expect(inferSemanticEntityType('Suresh', 'family', 'Father')).toBe('person');
    expect(inferSemanticEntityType('Rajeshree', 'family', 'Mother')).toBe('person');
    expect(inferSemanticEntityType('Sakshi', 'family', 'Wife')).toBe('person');
    expect(inferSemanticEntityType('साक्षी', 'family', 'Wife')).toBe('person');
    expect(inferSemanticEntityType('Shreshth', 'family', 'Son')).toBe('person');
    expect(inferSemanticEntityType('Sushant', 'family', 'Friend')).toBe('person');
    expect(inferSemanticEntityType('Ijaz', 'family', 'Friend')).toBe('person');
  });
});
