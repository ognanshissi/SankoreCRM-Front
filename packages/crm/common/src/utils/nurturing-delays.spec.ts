import { describe, expect, it } from 'vitest';
import { nurturingDelay, nurturingDelayDays, nurturingSummary } from './nurturing-delays';

describe('délais de nurturing', () => {
  it('lit le TimeSpan du serveur en jours', () => {
    expect(nurturingDelayDays('3.00:00:00')).toBe(3);
    expect(nurturingDelayDays('00:00:00')).toBe(0);
    expect(nurturingDelayDays('12:00:00')).toBe(1);
    expect(nurturingDelayDays(null)).toBe(0);
  });

  it('écrit des jours en TimeSpan, et relit la même valeur', () => {
    expect(nurturingDelay(0)).toBe('00:00:00');
    expect(nurturingDelayDays(nurturingDelay(21))).toBe(21);
  });

  it('résume une séquence', () => {
    expect(nurturingSummary([{ delayFromPrevious: '00:00:00' }])).toBe("1 e-mail dès l'inscription");
    expect(nurturingSummary([
      { delayFromPrevious: '00:00:00' },
      { delayFromPrevious: '7.00:00:00' },
      { delayFromPrevious: '14.00:00:00' },
    ])).toBe('3 e-mails sur 21 jours');
  });
});
