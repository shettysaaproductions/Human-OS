/**
 * indicTransliteration.ts
 *
 * Deterministic Indic / Devanagari to Latin Transliteration & Multilingual Slug Normalizer.
 *
 * Invariants:
 * 1. ZERO EMPTY SLUGS: Unicode names never produce an empty canonical identifier.
 * 2. MULTI-SCRIPT CONVERGENCE: "साक्षी" and "Sakshi" normalize to the same canonical semantic stem "sakshi".
 * 3. SCRIPT-AGNOSTIC REUSABILITY: No hardcoded person names.
 */

import { createHash } from 'crypto';

const DEVANAGARI_MAP: Record<string, string> = {
  // Consonants
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
  'क़': 'q', 'ख़': 'kh', 'ग़': 'gh', 'ज़': 'z', 'ड़': 'r', 'ढ़': 'rh', 'फ़': 'f',

  // Compound ligatures
  'क्ष': 'ksh', 'त्र': 'tr', 'ज्ञ': 'gy', 'श्र': 'shr',

  // Independent Vowels
  'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ऋ': 'ri',
  'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'अं': 'an', 'अः': 'ah',

  // Dependent Matras (Vowel signs)
  'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'ृ': 'ri',
  'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ं': 'n', 'ँ': 'n', 'ः': 'h',

  // Digits
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9'
};

const CONSONANTS = new Set('कखगघङचछजझञटठडढणतथदधनपफबभमयरलवशषसहक़ख़ग़ज़ड़ढ़फ़'.split(''));
const MATRAS_OR_VIRAMA = new Set('ािीुूृेैोौूंँः्'.split(''));

/**
 * Transliterates Devanagari script text into a Latin phonetic string.
 * e.g. "साक्षी" -> "sakshi", "सुरेश" -> "suresh", "टीकू" -> "tiku"
 */
export function transliterateIndic(text: string): string {
  if (!text) return '';
  const trimmed = text.trim();
  if (!/[\u0900-\u097F]/.test(trimmed)) {
    return trimmed;
  }

  let result = '';
  const chars = Array.from(trimmed);
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === '्') { // Virama (halant) cancels inherent 'a'
      if (result.endsWith('a')) {
        result = result.slice(0, -1);
      }
      continue;
    }

    const mapped = DEVANAGARI_MAP[c];
    if (mapped !== undefined) {
      if (CONSONANTS.has(c)) {
        // Lookahead: if followed by matra/virama, or if word-final (modern Hindi schwa deletion), no 'a'
        const next = chars[i + 1];
        const isEndOrSpace = !next || /[\s.,!?;:_\-]/.test(next);
        const hasNextMatra = next && MATRAS_OR_VIRAMA.has(next);
        result += mapped + (hasNextMatra || isEndOrSpace ? '' : 'a');
      } else {
        // Vowel Matra replaces inherent 'a'
        if ('ािीुूृेैोौ'.includes(c) && result.endsWith('a')) {
          result = result.slice(0, -1);
        }
        result += mapped;
      }
    } else {
      result += c;
    }
  }

  return result;
}

/**
 * Robust multilingual slug generator:
 * 1. Transliterates Devanagari to Latin if present.
 * 2. Normalizes to lowercase ASCII slug if possible.
 * 3. If non-Latin Unicode remains (e.g. Cyrillic, Greek, Hanzi), preserves Unicode alphanumeric letters with `\p{L}\p{N}`.
 * 4. Fallback hash ensures a slug is NEVER empty.
 */
export function generateCanonicalSlug(rawName: string): string {
  const trimmed = (rawName || '').trim();
  if (!trimmed) {
    return 'unnamed_' + Date.now().toString(36);
  }

  // 1. Transliterate Devanagari if present
  const transliterated = transliterateIndic(trimmed);

  // 2. Try standard ASCII alphanumeric
  const asciiSlug = transliterated
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (asciiSlug.length > 0) {
    return asciiSlug;
  }

  // 3. Fallback to Unicode alphanumeric letters
  const unicodeSlug = trimmed
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '');

  if (unicodeSlug.length > 0) {
    return unicodeSlug;
  }

  // 4. Ultimate fallback: deterministic hash
  const hash = createHash('md5').update(trimmed).digest('hex').slice(0, 8);
  return `entity_${hash}`;
}
