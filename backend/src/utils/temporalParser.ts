/**
 * temporalParser.ts — Deterministic Temporal Extraction and Parsing Utility (Phase 2F-D)
 *
 * Core Principles:
 * 1. TIME IS PART OF FACT MEANING.
 * 2. NEVER INVENT DATES OR FALSE PRECISION:
 *    - "2025" -> year_only ('2025')
 *    - "June 2025" -> month_year ('2025-06') without fabricating '2025-06-01'
 *    - "August 15, 2025" -> exact_date ('2025-08-15')
 *    - "next month" -> relative
 * 3. FUTURE ≠ CURRENT: Future intent must never be stored as an active current fact.
 * 4. DETERMINISTIC EXTRACTION: 0 LLM calls for standard temporal markers.
 */

import { TemporalMetadata, TemporalPrecision, TemporalStatus } from '../types/memory';

const MONTH_MAP: Record<string, string> = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', sept: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12',
};

export interface TemporalParseResult {
  temporalStatus: TemporalStatus;
  validFrom?: string | null;
  validUntil?: string | null;
  precision: TemporalPrecision;
  rawStated?: string;
  isFutureIntent: boolean;
  isSupersession: boolean;
  supersededConcept?: string;
}

export class TemporalParser {
  /**
   * Deterministically extracts temporal metadata, precision, and state from natural language.
   */
  static extractTemporalMetadata(text: string, _referenceDate?: Date): TemporalParseResult {
    if (!text || typeof text !== 'string') {
      return {
        temporalStatus: 'UNKNOWN',
        precision: 'unknown',
        isFutureIntent: false,
        isSupersession: false,
      };
    }

    const lower = text.toLowerCase().trim();

    // ── 1. FUTURE INTENT DETECTION ───────────────────────────────────────────
    const futurePatterns = [
      /\b(next month|tomorrow|soon|kal se|agle mahine|next year|next week)\b/i,
      /\b(will start|will join|planning to|gonna start|shuru karunga|start karunga|start.*next month)\b/i,
      /\b(i'll start|i will start|i'll join|i will join|going to start|going to join)\b/i,
    ];
    const isFutureIntent = futurePatterns.some(p => p.test(lower));

    // ── 2. SUPERSESSION MARKERS ──────────────────────────────────────────────
    const supersessionPatterns = [
      /\b(now i work at|currently moved to|switched to|switched from|left|stopped working|stopped|ab nahi|ab .* kar raha hu|resigned from|quit)\b/i,
    ];
    const isSupersession = supersessionPatterns.some(p => p.test(lower));

    // ── 3. DATE AND PRECISION EXTRACTION ─────────────────────────────────────
    let validFrom: string | null = null;
    let validUntil: string | null = null;
    let precision: TemporalPrecision = 'unknown';
    let rawStated: string | undefined;

    // A. Exact ISO date (e.g. 2025-08-15)
    const isoMatch = lower.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (isoMatch) {
      validFrom = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
      precision = 'exact_date';
      rawStated = isoMatch[0];
    }

    // B. Exact text date (e.g. "August 15, 2025" or "15 August 2025" or "15th August 2025")
    if (!validFrom) {
      const textDateMatch1 = lower.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?[,\s]+(\d{4})\b/i);
      const textDateMatch2 = lower.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[,\s]+(\d{4})\b/i);

      if (textDateMatch1) {
        const monthNum = MONTH_MAP[textDateMatch1[1].toLowerCase()] || '01';
        const dayNum = textDateMatch1[2].padStart(2, '0');
        const year = textDateMatch1[3];
        validFrom = `${year}-${monthNum}-${dayNum}`;
        precision = 'exact_date';
        rawStated = textDateMatch1[0];
      } else if (textDateMatch2) {
        const dayNum = textDateMatch2[1].padStart(2, '0');
        const monthNum = MONTH_MAP[textDateMatch2[2].toLowerCase()] || '01';
        const year = textDateMatch2[3];
        validFrom = `${year}-${monthNum}-${dayNum}`;
        precision = 'exact_date';
        rawStated = textDateMatch2[0];
      }
    }

    // C. Month + Year (e.g. "June 2025", "in August 2024") -> ZERO DAY FABRICATION
    if (!validFrom) {
      const monthYearMatch = lower.match(/\b(?:in\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})\b/i);
      if (monthYearMatch) {
        const monthNum = MONTH_MAP[monthYearMatch[1].toLowerCase()] || '01';
        const monthName = monthYearMatch[1].charAt(0).toUpperCase() + monthYearMatch[1].slice(1).toLowerCase();
        const year = monthYearMatch[2];
        validFrom = `${year}-${monthNum}`; // '2025-06' — strictly NO fabricated day!
        precision = 'month_year';
        rawStated = `${monthName} ${year}`;
      }
    }

    // D. Year Only (e.g. "in 2023", "2022 mein") -> ZERO MONTH/DAY FABRICATION
    if (!validFrom) {
      const yearMatch = lower.match(/\b(?:in\s+)?(19\d\d|20[0-3]\d)\b/);
      if (yearMatch) {
        validFrom = yearMatch[1]; // '2023' — strictly NO fabricated month or day!
        precision = 'year_only';
        rawStated = yearMatch[1];
      }
    }

    // E. Month only relative statement (e.g. "in June", "in August")
    if (!validFrom) {
      const monthOnlyMatch = lower.match(/\b(?:in\s+)(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i);
      if (monthOnlyMatch) {
        precision = 'relative';
        rawStated = monthOnlyMatch[0];
      }
    }

    // F. Range extraction (e.g. "from 2023 to 2025" or "left in June")
    const rangeMatch = lower.match(/\bfrom\s+(\d{4})\s+to\s+(\d{4})\b/i);
    if (rangeMatch) {
      validFrom = rangeMatch[1];
      validUntil = rangeMatch[2];
      precision = 'year_only';
      if (!rawStated) rawStated = rangeMatch[0];
    }

    const leftMatch = lower.match(/\bleft(?:\s+\w+)?\s+in\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(\d{4}))?\b/i);
    if (leftMatch) {
      const m = MONTH_MAP[leftMatch[1].toLowerCase()] || '01';
      validUntil = leftMatch[2] ? `${leftMatch[2]}-${m}` : leftMatch[1];
      if (!rawStated) rawStated = leftMatch[0];
      if (precision === 'unknown') precision = leftMatch[2] ? 'month_year' : 'relative';
    }

    // ── 4. STATUS CLASSIFICATION ─────────────────────────────────────────────
    let temporalStatus: TemporalStatus = 'UNKNOWN';

    if (isFutureIntent) {
      temporalStatus = 'UNKNOWN'; // Future intent is NOT a current fact!
    } else {
      const pastPatterns = [
        /\b(used to|previously|earlier|last year|before|pehle|pehle kaam karta tha|purana|purani|ex-|formerly|worked at.*in\s+\d{4}|worked at|left in|joined in\s+(?:19\d\d|20[0-2]\d))\b/i,
        /\b(left|resigned|stopped working|finished|graduated in)\b/i,
      ];
      const isPast = pastPatterns.some(p => p.test(lower)) || (precision === 'year_only' && parseInt(validFrom || '0', 10) < new Date().getFullYear());

      const currentPatterns = [
        /\b(now\b|currently\b|abhi\b|aajkal\b|right now\b|presently\b|as of now\b|at present\b|now work|currently work)\b/i,
      ];
      const isCurrentExplicit = currentPatterns.some(p => p.test(lower));
      const hasGeneralWork = /\b(work at|working at|job at|employed at)\b/i.test(lower) && !/\b(used to|previously|pehle|earlier|left|stopped)\b/i.test(lower);

      if (isPast && !isCurrentExplicit) {
        temporalStatus = 'HISTORICAL';
      } else if (isCurrentExplicit && !isPast) {
        temporalStatus = 'CURRENT';
      } else if (isPast && isCurrentExplicit) {
        // e.g. "Worked at A before, now work at B"
        temporalStatus = 'CURRENT';
      } else if (hasGeneralWork && !isPast) {
        temporalStatus = 'CURRENT';
      } else if (precision !== 'unknown') {
        if (precision === 'year_only' && validFrom && parseInt(validFrom, 10) < new Date().getFullYear()) {
          temporalStatus = 'HISTORICAL';
        } else {
          temporalStatus = 'UNKNOWN';
        }
      } else {
        temporalStatus = 'UNKNOWN';
      }
    }

    return {
      temporalStatus,
      validFrom,
      validUntil,
      precision,
      rawStated,
      isFutureIntent,
      isSupersession,
    };
  }

  /**
   * Helper to format structured temporal metadata object for persistence.
   */
  static toMetadata(result: TemporalParseResult): TemporalMetadata {
    return {
      temporal_status: result.temporalStatus,
      valid_from: result.validFrom,
      valid_until: result.validUntil,
      precision: result.precision,
      raw_stated: result.rawStated,
      is_future_intent: result.isFutureIntent,
    };
  }
}
