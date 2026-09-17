import { transliterateIndic, generateCanonicalSlug } from '../indicTransliteration';

describe('indicTransliteration and generateCanonicalSlug', () => {
  it('correctly transliterates Devanagari Hindi names to Latin', () => {
    expect(transliterateIndic('साक्षी').toLowerCase()).toBe('sakshi');
    expect(transliterateIndic('सुरेश').toLowerCase()).toBe('suresh');
    expect(transliterateIndic('टीकू').toLowerCase()).toBe('tiku');
    expect(transliterateIndic('सुशांत').toLowerCase()).toBe('sushant');
    expect(transliterateIndic('धीरज').toLowerCase()).toBe('dhiraj');
    expect(transliterateIndic('तन्मय').toLowerCase()).toBe('tanmay');
    expect(transliterateIndic('रोहित').toLowerCase()).toBe('rohit');
  });

  it('generates identical slug for Latin and Devanagari versions of same name', () => {
    const latinSlug = generateCanonicalSlug('Sakshi');
    const devanagariSlug = generateCanonicalSlug('साक्षी');
    expect(latinSlug).toBe('sakshi');
    expect(devanagariSlug).toBe('sakshi');
    expect(latinSlug).toBe(devanagariSlug);
  });

  it('never produces empty slug for any Unicode script', () => {
    expect(generateCanonicalSlug('साक्षी')).not.toBe('');
    expect(generateCanonicalSlug('Владимир')).not.toBe('');
    expect(generateCanonicalSlug('田中')).not.toBe('');
    expect(generateCanonicalSlug('!@#$%')).not.toBe('');
    expect(generateCanonicalSlug('')).not.toBe('');
  });
});
