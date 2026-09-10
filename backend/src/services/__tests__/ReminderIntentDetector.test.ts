import { ReminderIntentDetector } from '../ReminderIntentDetector';

describe('ReminderIntentDetector — High-Precision Natural Reminder Parsing', () => {
  const detector = new ReminderIntentDetector();
  const tzOffset = 5.5; // IST

  it('1. Parses "Kal muje afternoon me 1 bJe yaad dilao na PF ke lie bank details update karna hai muje uske portal pe"', () => {
    const text = 'Kal muje afternoon me 1 bJe yaad dilao na PF ke lie bank details update karna hai muje uske portal pe';
    expect(detector.hasReminderIntent(text)).toBe(true);

    const parsed = detector.parseReminderDetails(text, tzOffset);
    expect(parsed.isAmbiguous).toBe(false);
    expect(parsed.triggerAt).not.toBeNull();

    // Check trigger time in IST
    const localTrigger = new Date(parsed.triggerAt!.getTime() + tzOffset * 3600 * 1000);
    expect(localTrigger.getUTCHours()).toBe(13); // 1 PM
    expect(localTrigger.getUTCMinutes()).toBe(0);
    expect(parsed.formattedTime).toContain('Tomorrow at 1:00 PM');
    expect(parsed.title.toLowerCase()).toContain('pf');
  });

  it('2. Parses "Diya tha nai muje kal sube remind karo yaad se"', () => {
    const text = 'Diya tha nai muje kal sube remind karo yaad se';
    expect(detector.hasReminderIntent(text)).toBe(true);

    const parsed = detector.parseReminderDetails(text, tzOffset);
    expect(parsed.isAmbiguous).toBe(false);
    expect(parsed.triggerAt).not.toBeNull();

    const localTrigger = new Date(parsed.triggerAt!.getTime() + tzOffset * 3600 * 1000);
    expect(localTrigger.getUTCHours()).toBe(9); // Morning default = 9 AM
    expect(localTrigger.getUTCMinutes()).toBe(0);
    expect(parsed.formattedTime).toContain('Tomorrow at 9:00 AM');
  });

  it('3. Parses relative minutes "remind me in 15 minutes to take medicine"', () => {
    const text = 'remind me in 15 minutes to take medicine';
    expect(detector.hasReminderIntent(text)).toBe(true);

    const parsed = detector.parseReminderDetails(text, tzOffset);
    expect(parsed.isAmbiguous).toBe(false);
    expect(parsed.triggerAt).not.toBeNull();

    const diffMins = Math.round((parsed.triggerAt!.getTime() - Date.now()) / 60000);
    expect(diffMins).toBe(15);
    expect(parsed.title.toLowerCase()).toContain('take medicine');
  });

  it('4. Parses "parso shaam 6 baje call karna hai yaad dila dena"', () => {
    const text = 'parso shaam 6 baje call karna hai yaad dila dena';
    expect(detector.hasReminderIntent(text)).toBe(true);

    const parsed = detector.parseReminderDetails(text, tzOffset);
    expect(parsed.isAmbiguous).toBe(false);

    const localTrigger = new Date(parsed.triggerAt!.getTime() + tzOffset * 3600 * 1000);
    expect(localTrigger.getUTCHours()).toBe(18); // 6 PM
    expect(parsed.formattedTime).toContain('Day after tomorrow at 6:00 PM');
  });

  it('5. Rejects non-reminder past statements like "kal maine gym me workout kiya tha"', () => {
    const text = 'kal maine gym me workout kiya tha';
    expect(detector.hasReminderIntent(text)).toBe(false);
  });

  it('6. Rejects negative instructions like "don\'t remind me" or "yaad mat dilana"', () => {
    expect(detector.hasReminderIntent("don't remind me about this")).toBe(false);
    expect(detector.hasReminderIntent("mujhe yaad mat dilana")).toBe(false);
  });

  it('7. Parses birthday advance reminder "Meri wife ka date of birth 7/8/2002 ko hai, so muje 15 din pehle har saal gift ke lie yaad karna"', () => {
    const text = 'Meri wife ka date of birth 7/8/2002 ko hai, so muje 15 din pehle har saal gift ke lie yaad karna';
    expect(detector.hasReminderIntent(text)).toBe(true);

    const parsed = detector.parseReminderDetails(text, tzOffset);
    expect(parsed.isAmbiguous).toBe(false);
    expect(parsed.triggerAt).not.toBeNull();
    expect(parsed.isRecurring).toBe(true);
    expect(parsed.recurrenceType).toBe('years');

    // 7/8 is August 7. 15 days before is July 23!
    const localTrigger = new Date(parsed.triggerAt!.getTime() + tzOffset * 3600 * 1000);
    expect(localTrigger.getUTCMonth()).toBe(6); // July (0-indexed)
    expect(localTrigger.getUTCDate()).toBe(23); // 23rd
    expect(parsed.formattedTime).toContain('Every year on July 23');
    // Must be in the future (next year if current year has passed)
    expect(parsed.triggerAt!.getTime()).toBeGreaterThan(Date.now());
  });
});
